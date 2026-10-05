import { writeFile, readFile, mkdtemp, mkdir, rm, stat, lstat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const localPath = (spec, directory) =>
  spec.startsWith('file://') ? fileURLToPath(spec) : resolve(directory, spec.slice(5));

/** Local dependencies travel as immutable archives; registry versions retain the project's lockfile. */
export async function closeSceneDependencies(source, destination, { signal, runtime } = {}) {
  const destinationRoot = await realpath(destination);
  const file = join(destination, 'package.json');
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  const cache = new Map();
  const temporary = await mkdtemp(join(tmpdir(), 'story-dependencies-'));
  let changed = false,
    next = 0;
  if (runtime && !dependencyFields.some((field) => pkg[field]?.[runtime.name])) {
    (pkg.dependencies ??= {})[runtime.name] = `file:${runtime.root}`;
  }
  async function packed(path, ancestors = []) {
    signal?.throwIfAborted();
    path = await realpath(path);
    if (ancestors.includes(path))
      throw new Error(`Circular local package dependency: ${[...ancestors, path].join(' -> ')}`);
    if (cache.has(path)) return cache.get(path);
    const directory = (await stat(path)).isDirectory();
    const work = join(temporary, String(next++));
    await mkdir(work);
    let archive = path;
    if (directory) {
      const { stdout } = await execute(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', work],
        { cwd: path, signal },
      );
      archive = join(work, JSON.parse(stdout)[0].filename);
    }
    const { stdout } = await execute('tar', ['-xOf', archive, 'package/package.json'], { signal });
    const manifest = JSON.parse(stdout);
    const bundled = new Set(
      manifest.bundleDependencies === true || manifest.bundledDependencies === true
        ? Object.keys(manifest.dependencies ?? {})
        : (manifest.bundleDependencies ?? manifest.bundledDependencies ?? []),
    );
    const locals = ['dependencies', 'optionalDependencies'].flatMap((field) =>
      Object.entries(manifest[field] ?? {})
        .filter(
          ([name, spec]) =>
            typeof spec === 'string' && spec.startsWith('file:') && !bundled.has(name),
        )
        .map(([name, spec]) => ({ field, name, spec })),
    );
    if (locals.length) {
      if (!directory)
        throw new Error(
          `${path}: archive contains unresolved local dependencies (${locals.map((d) => d.name).join(', ')}). Reference the package source directory so delivery can include them.`,
        );
      const content = join(work, 'content');
      await mkdir(content);
      await execute('tar', ['-xzf', archive, '-C', content, '--strip-components=1'], { signal });
      for (const { field, name, spec } of locals) {
        const child = await packed(localPath(spec, path), [...ancestors, path]);
        const childArchive = join(work, `dependency-${next++}.tgz`);
        await writeFile(childArchive, child.bytes);
        const target = join(content, 'node_modules', name);
        await mkdir(target, { recursive: true });
        await execute('tar', ['-xzf', childArchive, '-C', target, '--strip-components=1'], {
          signal,
        });
        manifest[field][name] = child.version;
        bundled.add(name);
      }
      delete manifest.bundledDependencies;
      manifest.bundleDependencies = [...bundled];
      await writeFile(join(content, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
      const result = await execute(
        'npm',
        ['pack', '--ignore-scripts', '--json', '--pack-destination', work],
        { cwd: content, signal },
      );
      archive = join(work, JSON.parse(result.stdout)[0].filename);
    }
    const result = {
      bytes: await readFile(archive),
      name: manifest.name,
      version: manifest.version,
    };
    cache.set(path, result);
    return result;
  }
  try {
    for (const field of dependencyFields)
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        const resolvedRuntime = name === runtime?.name;
        if (!resolvedRuntime && (typeof spec !== 'string' || !spec.startsWith('file:'))) continue;
        const path = resolvedRuntime ? runtime.root : localPath(spec, source);
        const result = await packed(path);
        // The installed runtime is authoritative, but its exact archive may already
        // travel with the authored project. Keep that file instead of adding a second copy.
        const declared =
          typeof spec === 'string' && spec.startsWith('file:') ? localPath(spec, source) : null;
        if (declared) {
          const inside = relative(source, declared);
          const copied =
            !isAbsolute(inside) &&
            inside !== '..' &&
            !inside.startsWith('..' + sep) &&
            (await lstat(join(destination, inside)).then(
              (entry) => entry.isFile(),
              () => false,
            )) &&
            (await realpath(join(destination, inside))) === join(destinationRoot, inside);
          if (copied && (await readFile(join(destination, inside))).equals(result.bytes)) {
            const reference = `file:./${inside.split(sep).join('/')}`;
            if (spec !== reference) {
              pkg[field][name] = reference;
              changed = true;
            }
            continue;
          }
        }
        const hash = createHash('sha256').update(result.bytes).digest('hex').slice(0, 16);
        const archive = `dependencies/${name.replace(/[^a-zA-Z0-9._-]/g, '-')}-${hash}.tgz`;
        const folder = join(destination, 'dependencies');
        const existing = await lstat(folder).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        if (existing && !existing.isDirectory())
          throw new Error(`Dependency output must be a real directory: ${folder}`);
        if (!existing) await mkdir(folder);
        const target = join(destination, archive);
        try {
          await writeFile(target, result.bytes, { flag: 'wx' });
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          if (!(await lstat(target)).isFile() || !(await readFile(target)).equals(result.bytes))
            throw new Error(`Dependency archive has different content or is a link: ${target}`);
        }
        pkg[field][name] = `file:./${archive}`;
        changed = true;
      }
    if (changed) {
      await writeFile(file, JSON.stringify(pkg, null, 2) + '\n');
      await execute(
        'npm',
        ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
        { cwd: destination, signal },
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** New scenes and editable deliveries use the same immutable runtime dependency. */
export async function pinSceneProject(
  destination,
  { signal, build = true, root = fileURLToPath(new URL('../', import.meta.url)) } = {},
) {
  const { packRuntime } = await import('./runtime-package.mjs');
  const receipt = await packRuntime(destination, { root, build, signal });
  const hasVoice = await stat(join(root, 'tools/sketch-audio')).then(
    () => true,
    () => false,
  );
  await writeFile(
    join(destination, 'package.json'),
    JSON.stringify(
      {
        name: 'visual-story-scene',
        private: true,
        type: 'module',
        scripts: {
          build: 'visual-story build .',
          dev: 'visual-story dev .',
          preview: 'visual-story preview dist',
          pack: 'visual-story pack dist --out artifacts/story.html',
          ...(hasVoice ? { audio: 'visual-story audio .' } : {}),
          export: 'visual-story export dist',
          deliver: 'visual-story deliver .',
          review: 'visual-story review dist --out artifacts/review',
        },
        dependencies: { '@visual-storytelling/core': receipt.dependency },
      },
      null,
      2,
    ) + '\n',
  );
  await execute(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: destination, signal },
  );
  return receipt;
}
