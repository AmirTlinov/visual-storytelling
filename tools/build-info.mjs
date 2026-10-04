import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { readFile, readdir, writeFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const receiptName = 'build-info.json';
const ignored = (name) => name.startsWith('.') || name === '__pycache__' || name.endsWith('.pyc');
async function json(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Content identity survives copying, packing and installing; timestamps are irrelevant. */
export async function contentDigest(root, paths, exclude = () => false) {
  const files = [];
  async function visit(path) {
    if (exclude(relative(root, path).split(sep).join('/'))) return;
    try {
      for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (ignored(entry.name)) continue;
        const child = join(path, entry.name);
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile()) files.push(child);
      }
    } catch (error) {
      if (error.code === 'ENOTDIR') files.push(path);
      else if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const path of paths) await visit(join(root, path));
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    const name = relative(root, file).split(sep).join('/');
    if (exclude(name)) continue;
    const { size } = await stat(file);
    hash.update(`${name}\0${size}\0`);
    for await (const bytes of createReadStream(file)) hash.update(bytes);
  }
  return hash.digest('hex');
}

export const sourceDigest = (root) =>
  contentDigest(root, [
    'src',
    'tools',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.build.json',
  ]);
const runtimeDigest = (root) => contentDigest(root, ['.'], (name) => name === receiptName);
const packageDigest = async (root, runtime) => {
  const pkg = await json(join(root, 'package.json'));
  const excluded = (pkg.files ?? [])
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1));
  return createHash('sha256')
    .update(runtime)
    .update('\0')
    .update(
      await contentDigest(
        root,
        ['package.json', 'tools', 'examples', 'skill', 'docs', 'PHILOSOPHY.md', 'AGENTS.md'],
        (name) =>
          (name.startsWith('examples/') && name.endsWith('.wav')) ||
          excluded.some((pattern) => matchesGlob(name, pattern)),
      ),
    )
    .digest('hex');
};

/** Written inside the build transaction, alongside the actual emitted declarations. */
export async function writeBuildInfo(root, output, source = undefined) {
  const pkg = await json(join(root, 'package.json'));
  const runtime = await runtimeDigest(output);
  const receipt = {
    schemaVersion: 1,
    package: pkg.name,
    version: pkg.version,
    build: await packageDigest(root, runtime),
    source: source ?? (await sourceDigest(root)),
    runtime,
  };
  await writeFile(join(output, receiptName), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}

export async function packageInfo(root) {
  root = await realpath(root);
  const pkg = await json(join(root, 'package.json'));
  if (!pkg) throw new Error(`No package.json at ${root}`);
  const [receipt, api, sourcePresent] = await Promise.all([
    json(join(root, 'dist', receiptName)),
    json(join(root, 'dist/api.json')),
    readFile(join(root, 'src/index.ts')).then(
      () => true,
      (error) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    ),
  ]);
  const modules = Object.fromEntries(
    Object.entries(api?.modules ?? {}).map(([entry, symbols]) => [entry, Object.keys(symbols)]),
  );
  const runtime = await runtimeDigest(join(root, 'dist'));
  const build = await packageDigest(root, runtime);
  const status = !api
    ? 'unbuilt'
    : !receipt?.runtime
      ? 'unrecorded'
      : runtime !== receipt.runtime
        ? 'modified'
        : sourcePresent && (await sourceDigest(root)) !== receipt.source
          ? 'stale'
          : build !== receipt.build
            ? 'modified'
            : sourcePresent
              ? 'current'
              : 'packaged';
  return {
    name: pkg.name,
    version: pkg.version,
    root,
    build,
    status,
    source: receipt?.source ?? null,
    modules,
  };
}

/** Resolve exactly as code in the consuming scene does, even when this CLI is elsewhere. */
export async function diagnosePackage(cliRoot, directory = process.cwd()) {
  const cli = await packageInfo(cliRoot);
  const scene = resolve(directory);
  const manifest = await json(join(scene, 'package.json'));
  let consumer = null;
  const issues = [];
  let installed;
  try {
    installed = findPackageJSON(cli.name, pathToFileURL(join(scene, 'package.json')));
  } catch (error) {
    if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
  }
  if (installed) {
    const installedRoot = await realpath(dirname(installed));
    consumer = installedRoot === cli.root ? cli : await packageInfo(installedRoot);
  } else if (
    ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(
      (field) => manifest?.[field]?.[cli.name],
    )
  )
    issues.push('Scene dependency is not installed. Run npm install in the scene directory.');
  for (const [label, info] of [
    ['CLI', cli],
    ['Scene', consumer],
  ]) {
    if (!info || (label === 'Scene' && info.root === cli.root)) continue;
    if (info.status === 'unbuilt')
      issues.push(`${label} is not built. Run npm run build in the library directory.`);
    if (info.status === 'stale')
      issues.push(
        `${label} declarations and runtime predate their sources. Rebuild this library before creating a scene or consulting its API.`,
      );
    if (info.status === 'modified')
      issues.push(
        `${label} package differs from its build receipt. Rebuild from source or reinstall the pinned dependency.`,
      );
    if (info.status === 'unrecorded')
      issues.push(
        `${label} has no source/runtime receipt. Its content ID is available; source/build consistency is unknown.`,
      );
  }
  if (consumer && consumer.build !== cli.build)
    issues.push(
      'The scene uses a different package from this CLI. Run npx visual-story inside the scene for its actual API; update its dependency explicitly when intended.',
    );
  return { cli, scene, consumer, issues };
}

export function formatPackageInfo(report) {
  const lines = [];
  for (const [label, info] of [
    ['CLI', report.cli],
    ['Scene dependency', report.consumer],
  ]) {
    if (!info || (label === 'Scene dependency' && info.root === report.cli.root)) continue;
    const symbols = new Set(Object.values(info.modules).flat());
    lines.push(
      `${label}: ${info.name}@${info.version}`,
      `  ${info.root}`,
      `  content ${info.build.slice(0, 16)} · ${info.status}`,
      `  ${symbols.size} public names across ${Object.keys(info.modules).length} modules`,
    );
  }
  return [
    ...lines,
    ...report.issues.map((issue) => `Action: ${issue}`),
    'Inspect public signatures: visual-story api NAME',
  ].join('\n');
}
