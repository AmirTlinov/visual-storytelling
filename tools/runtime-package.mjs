import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rm, access, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { packageInfo, resolvePackage } from './build-info.mjs';

const execute = promisify(execFile);
const library = fileURLToPath(new URL('../', import.meta.url));
const name = '@visual-storytelling/core';
const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const valid = (info) => info && ['current', 'packaged'].includes(info.status);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const managed = /^file:(?:\.\/)?dependencies\/visual-storytelling-core-([a-f0-9]{64})\.tgz$/;
const readOptional = (file) =>
  readFile(file).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
const command = (cwd, signal) => ({ cwd, signal, maxBuffer: 16 * 1024 * 1024 });

async function preparedRuntime({ root = library, build = true, signal } = {}) {
  signal?.throwIfAborted();
  let info = await packageInfo(root);
  if (info.name !== name) throw new Error(`Expected ${name}, found ${info.name} at ${root}`);
  const source = await access(join(info.root, 'src/index.ts')).then(
    () => true,
    (error) => {
      if (error.code !== 'ENOENT') throw error;
      return false;
    },
  );
  if (source && build && info.status !== 'current') {
    await execute(
      process.execPath,
      [join(info.root, 'tools/build-package.mjs')],
      command(info.root, signal),
    );
    info = await packageInfo(info.root);
  }
  if (!valid(info))
    throw new Error(
      `Cannot pin ${info.status} runtime at ${root}. Rebuild its source package first.`,
    );
  return info;
}

async function archiveManifest(file, signal) {
  const { stdout } = await execute(
    'tar',
    ['-xOf', file, 'package/package.json'],
    command(undefined, signal),
  );
  return JSON.parse(stdout);
}

async function pack(destination, info, { signal } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'story-runtime-'));
  try {
    const { stdout } = await execute(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
      command(info.root, signal),
    );
    const archive = join(temporary, JSON.parse(stdout)[0].filename);
    const after = await packageInfo(info.root);
    if (!valid(after) || after.build !== info.build || after.source !== info.source)
      throw new Error(
        'Runtime sources or package changed during packing. Retry after edits finish.',
      );
    // Validate the bytes npm actually selected, not merely its pre-pack source receipt.
    const extracted = join(temporary, 'package');
    await mkdir(extracted);
    await execute(
      'tar',
      ['-xzf', archive, '-C', extracted, '--strip-components=1'],
      command(undefined, signal),
    );
    const shipped = await packageInfo(extracted);
    if (
      !valid(shipped) ||
      shipped.build !== info.build ||
      shipped.source !== info.source ||
      shipped.name !== name
    )
      throw new Error('Packed runtime differs from the selected build. Rebuild before retrying.');
    signal?.throwIfAborted();
    const bytes = await readFile(archive);
    // A build ID excludes the receipt itself; the archive name identifies every shipped byte.
    const filename = `dependencies/visual-storytelling-core-${digest(bytes)}.tgz`;
    const target = join(destination, filename);
    await mkdir(join(destination, 'dependencies'), { recursive: true });
    let created = true;
    try {
      await writeFile(target, bytes, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      created = false;
      if (!(await lstat(target)).isFile() || !(await readFile(target)).equals(bytes))
        throw new Error(`Pinned runtime archive has different content: ${target}`);
    }
    return { receipt: { ...info, filename, dependency: `file:./${filename}` }, created };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** A source checkout and an installed package use the same immutable scene dependency. */
export async function packRuntime(destination, options = {}) {
  return (await pack(resolve(destination), await preparedRuntime(options), options)).receipt;
}

const localFile = (spec, directory) =>
  typeof spec === 'string' && spec.startsWith('file:')
    ? spec.startsWith('file://')
      ? fileURLToPath(spec)
      : resolve(directory, spec.slice(5))
    : undefined;
const referenced = (manifest, file, directory) =>
  fields.some((field) =>
    Object.values(manifest[field] ?? {}).some((spec) => localFile(spec, directory) === file),
  );

async function archivedBuild(spec, directory, signal) {
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

async function installedRuntime(directory) {
  const root = await resolvePackage(name, directory);
  if (!root) return null;
  // An invalid installed receipt is a reason to replace this dependency, not to block repair.
  try {
    return await packageInfo(root);
  } catch {
    return null;
  }
}

/** Read declared package metadata directly; API discovery never installs or builds a project. */
export async function readPinnedRuntime(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const declarations = fields.flatMap((field) =>
    manifest[field]?.[name] ? [manifest[field][name]] : [],
  );
  if (declarations.length !== 1)
    throw new Error(`Scene must declare ${name} in exactly one dependency field.`);
  const spec = declarations[0];
  if (typeof spec === 'string' && managed.test(spec)) {
    if (!(await archivedBuild(spec, directory)))
      throw new Error(
        'The declared runtime archive is missing or changed. Restore it or explicitly migrate the project.',
      );
    const archive = localFile(spec, directory);
    const read = async (file) =>
      JSON.parse((await execute('tar', ['-xOf', archive, 'package/' + file], command())).stdout);
    const [api, catalog] = await Promise.all([
      read('dist/api.json'),
      read('examples/catalog.json'),
    ]);
    return { root: archive + '/package', api, catalog };
  }
  const installed = await installedRuntime(directory);
  if (!valid(installed))
    throw new Error(
      'The declared runtime archive is missing or changed. Restore it or explicitly migrate the project.',
    );
  return {
    root: installed.root,
    api: JSON.parse(await readFile(join(installed.root, 'dist/api.json'), 'utf8')),
    catalog: JSON.parse(await readFile(join(installed.root, 'examples/catalog.json'), 'utf8')),
  };
}

/** Update only this runtime; authored scripts, assets and other dependency specs survive. */
export async function updateSceneRuntime(destination, options = {}) {
  destination = resolve(destination);
  const manifestFile = join(destination, 'package.json');
  const before = await readFile(manifestFile, 'utf8');
  const lockFile = join(destination, 'package-lock.json');
  const lock = await readOptional(lockFile);
  const manifest = JSON.parse(before);
  const owners = fields.filter((field) => Object.hasOwn(manifest[field] ?? {}, name));
  if (owners.length !== 1)
    throw new Error(`Scene must declare ${name} in exactly one dependency field.`);
  const owner = owners[0],
    previous = manifest[owner][name];
  const info = await preparedRuntime(options);
  const current = await installedRuntime(destination);
  if (
    valid(current) &&
    current.build === info.build &&
    (await archivedBuild(previous, destination, options.signal)) === info.build
  )
    return { scene: destination, changed: false, build: info.build, dependency: previous };
  const { receipt, created } = await pack(destination, info, options);
  const restoreMetadata = async () => {
    await writeFile(manifestFile, before);
    if (lock) await writeFile(lockFile, lock);
    else await rm(lockFile, { force: true });
  };
  const discardNew = async () => {
    if (
      created &&
      !referenced(JSON.parse(before), join(destination, receipt.filename), destination)
    )
      await rm(join(destination, receipt.filename), { force: true });
  };
  const latestLock = await readOptional(lockFile);
  if (
    (await readFile(manifestFile, 'utf8')) !== before ||
    (lock ? !latestLock?.equals(lock) : latestLock !== null)
  ) {
    await discardNew();
    throw new Error(
      'Scene package.json or lockfile changed while preparing its runtime. Retry after edits finish.',
    );
  }
  manifest[owner][name] = receipt.dependency;
  const install = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
  const include = {
    devDependencies: 'dev',
    optionalDependencies: 'optional',
    peerDependencies: 'peer',
  }[owner];
  if (include) install.push(`--include=${include}`);
  try {
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    await execute('npm', install, command(destination, options.signal));
    const resolved = await installedRuntime(destination);
    if (!valid(resolved) || resolved.build !== receipt.build)
      throw new Error('Installed runtime differs from the selected archive.');
  } catch (error) {
    await restoreMetadata();
    let rollback;
    try {
      // The previous archive remains available until success. Cached/local dependencies
      // restore the old tree even after cancellation, without another network operation.
      await execute('npm', [...install, '--offline'], command(destination));
      const restored = await installedRuntime(destination);
      if (valid(current) && (!valid(restored) || restored.build !== current.build))
        throw new Error('the previous installed runtime could not be restored');
    } catch (failure) {
      rollback = failure;
    } finally {
      await restoreMetadata();
    }
    await discardNew();
    throw new Error(
      `Runtime update failed; package.json and lockfile restored. ${
        rollback
          ? `Installed dependencies still need repair: run npm install in ${destination}. ${rollback.message}`
          : 'Previous dependencies restored.'
      } ${error.message}`,
      { cause: error },
    );
  }
  // A legacy root archive may be hand-authored. Only this owner's path is eligible,
  // and aliases in another dependency field still keep its file alive.
  if (typeof previous === 'string' && managed.test(previous) && previous !== receipt.dependency) {
    const old = localFile(previous, destination);
    if (!referenced(manifest, old, destination)) {
      let owned = false;
      try {
        owned = Boolean(await archivedBuild(previous, destination));
      } catch {
        /* An absent or unrecognised file is not ours to remove. */
      }
      if (owned) await rm(old);
    }
  }
  return {
    scene: destination,
    changed: true,
    build: receipt.build,
    dependency: receipt.dependency,
  };
}
