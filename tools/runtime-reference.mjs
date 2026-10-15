import { readFile, realpath, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { packageInfo, resolvePackage } from './build-info.mjs';
import { assertPreparedRuntimeRoot } from './prepared-runtime-trust.mjs';

const execute = promisify(execFile);
const name = '@visual-storytelling/core';
export const runtimeDependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const fields = runtimeDependencyFields;
const managed = /^file:(?:\.\/)?dependencies\/visual-storytelling-core-([a-f0-9]{64})\.tgz$/;
const valid = (info) => info && ['current', 'packaged'].includes(info.status);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const command = (cwd, signal) => ({ cwd, signal, maxBuffer: 16 * 1024 * 1024 });
const readOptional = (file) =>
  readFile(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
export const preparedRuntimeFile = 'scene-runtime.json';

export const localFile = (spec, directory) =>
  typeof spec === 'string' && spec.startsWith('file:')
    ? spec.startsWith('file://')
      ? fileURLToPath(spec)
      : resolve(directory, spec.slice(5))
    : undefined;

async function archiveManifest(file, signal) {
  const { stdout } = await execute(
    'tar',
    ['-xOf', file, 'package/package.json'],
    command(undefined, signal),
  );
  return JSON.parse(stdout);
}

/** Read the authored pin, never the installer's current pointer. No npm or compilation. */
export async function readPreparedRuntime(directory) {
  const bytes = await readOptional(join(directory, preparedRuntimeFile));
  if (!bytes) return null;
  const pin = JSON.parse(bytes);
  await assertPreparedRuntimeRoot(pin.root);
  if (
    pin.schemaVersion !== 1 ||
    pin.name !== name ||
    typeof pin.root !== 'string' ||
    !/^[a-f0-9]{64}$/.test(pin.build) ||
    (await realpath(pin.root)) !== pin.root
  )
    throw new Error('Invalid prepared runtime pin. Restore it or explicitly migrate the project.');
  const [receipt, pkg] = await Promise.all([
    readFile(join(pin.root, 'dist/build-info.json'), 'utf8').then(JSON.parse),
    readFile(join(pin.root, 'package.json'), 'utf8').then(JSON.parse),
  ]);
  if (receipt.build !== pin.build || receipt.package !== name || pkg.version !== pin.version)
    throw new Error('The pinned runtime is unavailable or changed. Restore that release.');
  return { ...pin, dependency: `file:${pin.root}` };
}

export async function archivedBuild(spec, directory, signal) {
  const hash = typeof spec === 'string' && managed.exec(spec)?.[1];
  if (!hash) return false;
  const file = localFile(spec, directory);
  try {
    if (!(await lstat(file)).isFile() || digest(await readFile(file)) !== hash) return false;
    const pkg = await archiveManifest(file, signal);
    const { stdout } = await execute(
      'tar',
      ['-xOf', file, 'package/dist/build-info.json'],
      command(undefined, signal),
    );
    return pkg.name === name && JSON.parse(stdout).build;
  } catch (error) {
    signal?.throwIfAborted();
    if (error.code === 'EACCES') throw error;
    return false;
  }
}

export async function installedRuntime(directory) {
  const root = await resolvePackage(name, directory);
  if (!root) return null;
  // An invalid installed receipt is a reason to replace this dependency, not to block repair.
  try {
    return await packageInfo(root);
  } catch {
    return null;
  }
}

/** Resolve only the selected identity. Authoring does not need the API/catalog payload. */
export async function readPinnedRuntime(directory) {
  const prepared = await readPreparedRuntime(directory);
  if (prepared) return { root: prepared.root, runtime: prepared };
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const declarations = fields.flatMap((field) =>
    manifest[field]?.[name] ? [manifest[field][name]] : [],
  );
  if (declarations.length !== 1)
    throw new Error(`Scene must declare ${name} in exactly one dependency field.`);
  const spec = declarations[0];
  if (typeof spec === 'string' && managed.test(spec)) {
    const declaredBuild = await archivedBuild(spec, directory);
    if (!declaredBuild)
      throw new Error(
        'The declared runtime archive is missing or changed. Restore it or explicitly migrate the project.',
      );
    const installed = await installedRuntime(directory);
    if (valid(installed) && installed.build === declaredBuild)
      return {
        root: installed.root,
        runtime: { name, version: installed.version, build: declaredBuild, dependency: spec },
      };
    const archive = localFile(spec, directory);
    const metadata = await archiveManifest(archive);
    return {
      root: archive + '/package',
      archive,
      runtime: { name, version: metadata.version, build: declaredBuild, dependency: spec },
    };
  }
  const installed = await installedRuntime(directory);
  if (!valid(installed))
    throw new Error(
      'The declared runtime archive is missing or changed. Restore it or explicitly migrate the project.',
    );
  return {
    root: installed.root,
    runtime: { name, version: installed.version, build: installed.build, dependency: spec },
  };
}

/** Reference discovery explicitly loads its large declarations; it never installs or builds. */
export async function readPinnedReference(pinned) {
  const read = pinned.archive
    ? async (file) =>
        JSON.parse(
          (await execute('tar', ['-xOf', pinned.archive, 'package/' + file], command())).stdout,
        )
    : async (file) => JSON.parse(await readFile(join(pinned.root, file), 'utf8'));
  const [api, catalog] = await Promise.all([read('dist/api.json'), read('examples/catalog.json')]);
  return { api, catalog };
}
