import { readFile, writeFile, mkdir, cp, rm, chmod, readdir, open } from 'node:fs/promises';
import { join, dirname, basename, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { buildAPI } from '../tools/api.mjs';
import { sourceDigest, writeBuildInfo } from '../tools/build-info.mjs';
import { playbackTimeline } from '../tools/narration.mjs';
const execute = promisify(execFile);
// The installed plugin, CLI and gallery publish the same versioned catalog.
export const shippedExamples = Object.keys(
  JSON.parse(await readFile(new URL('../examples/catalog.json', import.meta.url), 'utf8')),
);

export const releaseInput = (path) =>
  !path
    .split(sep)
    .some(
      (part) =>
        part.startsWith('.') ||
        ['node_modules', '__pycache__', 'site', 'artifacts', 'review'].includes(part) ||
        part.endsWith('.pyc'),
    );

/** Read the actual deployment targets, including native npm dependencies. */
export async function macosDeployment(root) {
  const binaries = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const handle = await open(file, 'r'),
          header = Buffer.alloc(4);
        try {
          await handle.read(header, 0, 4, 0);
        } finally {
          await handle.close();
        }
        if (!['cffaedfe', 'cefaedfe', 'cafebabe', 'bebafeca'].includes(header.toString('hex')))
          continue;
        const { stdout } = await execute('/usr/bin/otool', ['-l', file]);
        const versions = [
          ...stdout.matchAll(
            /cmd LC_BUILD_VERSION\s+cmdsize \d+\s+platform \d+\s+minos ([\d.]+)|cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([\d.]+)/g,
          ),
        ].map((m) => m[1] ?? m[2]);
        if (!versions.length) throw new Error(`No macOS deployment target: ${file}`);
        binaries.push({
          path: relative(root, file),
          minimumMacOS: versions.sort(compareVersion).at(-1),
        });
      }
    }
  }
  await visit(root);
  return {
    minimumMacOS: binaries
      .map((b) => b.minimumMacOS)
      .sort(compareVersion)
      .at(-1),
    binaries,
  };
}
function compareVersion(a, b) {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

/** A distributable local beta: runtime, authoring tools, docs and licensed assets travel together. */
export async function packagePlugin(root) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('This release profile targets macOS Apple Silicon.');
  const release = join(root, '.plugin-release');
  await rm(release, { recursive: true, force: true });
  await mkdir(release, { recursive: true });
  for (const name of [
    'plugin.json',
    'mcp.json',
    'LICENSE',
    'THIRD_PARTY.md',
    'PHILOSOPHY.md',
    'README.md',
    'AGENTS.md',
    'dist',
    'tools',
    'docs',
    'skills',
    'plugin',
  ]) {
    await cp(join(root, name), join(release, name), {
      recursive: true,
      filter: (path) => releaseInput(relative(root, path)) && !path.includes('/plugin/dist/scene'),
    });
  }
  const catalog = JSON.parse(await readFile(join(root, 'examples/catalog.json'), 'utf8'));
  await mkdir(join(release, 'examples'));
  for (const id of shippedExamples) {
    await cp(join(root, 'examples', id), join(release, 'examples', id), {
      recursive: true,
      filter: (path) =>
        releaseInput(relative(root, path)) &&
        !/\.(wav|mp3|m4a|mp4)$/.test(path) &&
        !['dist', 'node_modules', 'artifacts', 'review'].includes(basename(path)),
    });
    const timeline = join(release, 'examples', id, 'timeline.json');
    const source = await readFile(timeline, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (source)
      await writeFile(
        timeline,
        JSON.stringify(playbackTimeline(JSON.parse(source)), null, 2) + '\n',
      );
  }
  await writeFile(
    join(release, 'examples/catalog.json'),
    JSON.stringify(Object.fromEntries(shippedExamples.map((id) => [id, catalog[id]])), null, 2),
  );
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  delete pkg.devDependencies;
  pkg.scripts = { build: 'visual-story build .', dev: 'visual-story dev .' };
  await writeFile(join(release, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await buildAPI(release, join(release, 'dist'));
  await execute('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: release,
    maxBuffer: 2_000_000,
  });
  await writeBuildInfo(release, join(release, 'dist'), await sourceDigest(release));
  // The user's project owns its runtime archive, while the app starts without a system Node install.
  const runtime = join(release, 'runtime');
  await mkdir(runtime);
  await cp(process.execPath, join(runtime, 'node'));
  await chmod(join(runtime, 'node'), 0o755);
  const installation = dirname(dirname(process.execPath));
  await cp(join(installation, 'LICENSE'), join(runtime, 'NODE-LICENSE'));
  await cp(join(installation, 'lib/node_modules/npm'), join(runtime, 'npm'), { recursive: true });
  // Tools invoking npm inherit the plugin's private, versioned runtime bin directory.
  await mkdir(join(runtime, 'bin'));
  await writeFile(
    join(runtime, 'bin/npm'),
    '#!/bin/sh\nexec "$(dirname "$0")/../node" "$(dirname "$0")/../npm/bin/npm-cli.js" "$@"\n',
    { mode: 0o755 },
  );
  await writeFile(join(runtime, 'bin/node'), '#!/bin/sh\nexec "$(dirname "$0")/../node" "$@"\n', {
    mode: 0o755,
  });
  const deployment = await macosDeployment(release);
  const core = JSON.parse(await readFile(join(release, 'dist/build-info.json'), 'utf8'));
  await writeFile(
    join(release, 'release.json'),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        minimumMacOS: deployment.minimumMacOS,
        nativeBinaries: deployment.binaries,
        core: { version: pkg.version, build: core.build },
        plugin: JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')).version,
        examples: shippedExamples,
        onDemand: ['Python voice environment', 'voice models', 'Chromium', 'FFmpeg', 'music'],
      },
      null,
      2,
    ) + '\n',
  );
  const version = JSON.parse(await readFile(join(release, 'plugin.json'), 'utf8')).version;
  const archive = join(
    root,
    'artifacts/plugin',
    `visual-storytelling-${version}-darwin-arm64.tar.gz`,
  );
  await mkdir(dirname(archive), { recursive: true });
  await execute(
    '/usr/bin/tar',
    [
      '-czf',
      archive,
      '-C',
      root,
      '.agents/plugins/marketplace.json',
      '.plugin-release',
      '-C',
      join(root, 'plugin'),
      'INSTALL.md',
    ],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } },
  );
  await writeFile(
    archive + '.sha256',
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex') +
      '  ' +
      basename(archive) +
      '\n',
  );
  console.log(`Installable archive: ${archive}`);
  return release;
}
