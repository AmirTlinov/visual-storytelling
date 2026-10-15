import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  access,
  lstat,
  realpath,
  symlink,
  rename,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageInfo, resolvePackage } from './build-info.mjs';
import { assertPreparedRuntimeRoot } from './prepared-runtime-trust.mjs';
import { readStoryProject } from './story-project.mjs';
import {
  readPreparedRuntime,
  readPinnedRuntime,
  preparedRuntimeFile,
  runtimeDependencyFields as fields,
  archivedBuild,
  installedRuntime,
  localFile,
} from './runtime-reference.mjs';

const execute = promisify(execFile);
const library = fileURLToPath(new URL('../', import.meta.url));
const name = '@visual-storytelling/core';
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

/** A prepared release is already an immutable package; pin its identity before any archive work. */
async function preparedRelease(root = library) {
  root = await assertPreparedRuntimeRoot(root);
  if (!(await readOptional(join(root, 'release.json')))) {
    // The source CLI uses its own generated release. Never select the installer's
    // current pointer or silently pin an older build after source edits.
    const source = root;
    const action = 'Prepare this checkout first: npm run plugin:release.';
    try {
      root = await assertPreparedRuntimeRoot(join(source, '.plugin-release'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(action, { cause: error });
    }
    const [info, release] = await Promise.all([
      packageInfo(source),
      readFile(join(root, 'release.json'), 'utf8').then(JSON.parse),
    ]);
    if (info.status !== 'current' || release.sourceBuild !== info.build) throw new Error(action);
  }
  const [release, receipt, pkg] = await Promise.all([
    readFile(join(root, 'release.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'dist/build-info.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'package.json'), 'utf8').then(JSON.parse),
  ]);
  if (pkg.name !== name || release.core?.build !== receipt.build || receipt.package !== name)
    throw new Error('Prepare an immutable plugin release before creating a live explanation.');
  await access(join(root, 'plugin/dist/live.html'));
  return { schemaVersion: 1, name, version: pkg.version, build: receipt.build, root };
}

export async function pinPreparedRuntime(destination, { root = library } = {}) {
  const pin = await preparedRelease(root);
  await writeFile(join(destination, preparedRuntimeFile), JSON.stringify(pin, null, 2) + '\n');
  return { ...pin, dependency: `file:${pin.root}` };
}

/** The same pinned package resolves normal scene imports during build and delivery. */
export async function linkPreparedRuntime(directory) {
  const pin = await readPreparedRuntime(directory);
  if (!pin) return null;
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (pkg.dependencies?.[name] !== pin.dependency)
    throw new Error('The scene dependency differs from its prepared runtime pin.');
  const extra = fields
    .flatMap((field) => Object.keys(pkg[field] ?? {}))
    .filter((key) => key !== name);
  if (extra.length) return null; // An extended package follows the normal lockfile installer.
  const parent = join(directory, 'node_modules/@visual-storytelling');
  await mkdir(parent, { recursive: true });
  const target = join(parent, 'core');
  try {
    await symlink(pin.root, target, 'dir');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if ((await realpath(target).catch(() => null)) !== pin.root) {
      if (!(await lstat(target)).isSymbolicLink())
        throw new Error('Installed scene runtime differs from its pin. Repair its dependencies.');
      // Undo and explicit migration can change the authored pin. Replace only this
      // dependency link; never remove or mutate either immutable release directory.
      const temporary = join(parent, '.core-' + randomUUID());
      try {
        await symlink(pin.root, temporary, 'dir');
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    }
  }
  return pin;
}

async function updatePreparedSceneRuntime(destination, options, metadata) {
  const { manifest, owner, before, lock, pinBefore } = metadata;
  const signal = options.signal;
  signal?.throwIfAborted();
  const pin = await preparedRelease(options.root);
  const dependency = `file:${pin.root}`;
  const previous = JSON.parse(pinBefore);
  if (
    previous.schemaVersion !== 1 ||
    previous.name !== name ||
    typeof previous.root !== 'string' ||
    !/^[a-f0-9]{64}$/.test(previous.build) ||
    manifest[owner][name] !== `file:${previous.root}`
  )
    throw new Error(
      'The scene dependency differs from its prepared runtime pin. Restore its metadata before migrating.',
    );
  if (
    previous.root === pin.root &&
    previous.build === pin.build &&
    manifest[owner][name] === dependency
  )
    return { scene: destination, changed: false, prepared: true, build: pin.build, dependency };
  if (owner !== 'dependencies')
    throw new Error(
      'A prepared scene runtime must remain in dependencies. Restore its package.json.',
    );
  const files = [
    [join(destination, 'package.json'), Buffer.from(before)],
    [join(destination, 'package-lock.json'), lock],
    [join(destination, preparedRuntimeFile), pinBefore],
  ];
  for (const [file, bytes] of files) {
    const current = await readOptional(file);
    if (bytes ? !current?.equals(bytes) : current !== null)
      throw new Error(
        'Scene runtime metadata changed while preparing its update. Retry after edits finish.',
      );
  }
  const restoreMetadata = async () => {
    for (const [file, bytes] of files)
      if (bytes) await writeFile(file, bytes);
      else await rm(file, { force: true });
  };
  const extra = fields
    .flatMap((field) => Object.keys(manifest[field] ?? {}))
    .some((key) => key !== name);
  const install = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
  try {
    signal?.throwIfAborted();
    manifest[owner][name] = dependency;
    await writeFile(files[0][0], JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(files[2][0], JSON.stringify(pin, null, 2) + '\n');
    if (extra) await execute('npm', install, command(destination, signal));
    else {
      await rm(files[1][0], { force: true });
      await linkPreparedRuntime(destination);
    }
    signal?.throwIfAborted();
    await readPreparedRuntime(destination);
    if ((await resolvePackage(name, destination)) !== pin.root)
      throw new Error('Installed runtime differs from the selected prepared release.');
  } catch (error) {
    await restoreMetadata();
    let rollback;
    try {
      if (extra) await execute('npm', [...install, '--offline'], command(destination));
      else await linkPreparedRuntime(destination);
    } catch (failure) {
      rollback = failure;
    } finally {
      await restoreMetadata();
    }
    throw new Error(
      `Runtime update failed; package.json, lockfile and prepared pin restored. ${
        rollback
          ? `Installed dependencies need repair: ${rollback.message}`
          : 'Previous dependencies restored.'
      } ${error.message}`,
      { cause: error },
    );
  }
  return { scene: destination, changed: true, prepared: true, build: pin.build, dependency };
}

const documentMigrationRequired = () =>
  Object.assign(
    new Error(
      'This pinned runtime predates StoryDocument v2. Explicitly migrate the project before document authoring.',
    ),
    { code: 'runtime_migration_required' },
  );

export async function storyDocumentAPI(directory, { installedFrom } = {}) {
  let pinned = await readPinnedRuntime(directory);
  if (pinned.archive && installedFrom) {
    const installed = await readPinnedRuntime(installedFrom);
    if (installed.archive || installed.runtime.build !== pinned.runtime.build)
      throw new Error('The accepted build does not contain this project’s exact pinned runtime.');
    pinned = installed;
  }
  if (pinned.archive)
    throw new Error('Install this project’s pinned dependencies before semantic authoring.');
  const entry = join(pinned.root, 'dist/story/document.js');
  await access(entry).catch((error) => {
    if (error.code === 'ENOENT') throw documentMigrationRequired();
    throw error;
  });
  const api = await import(pathToFileURL(entry).href);
  if (
    [
      'prepareStoryDocument',
      'prepareIllustratedDocument',
      'editStoryDocument',
      'authoredInputKeys',
    ].some((name) => typeof api[name] !== 'function')
  )
    throw documentMigrationRequired();
  return api;
}

/** The manifest owns document/module/resources; arbitrary source entries use the ordinary builder. */
export async function assertPreparedDocument(directory) {
  const pin = await readPreparedRuntime(directory);
  if (!pin) throw new Error('Document authoring requires a prepared StoryDocument project.');
  await storyDocumentAPI(directory);
  const file = join(pin.root, 'tools/runtime-package.mjs');
  const owner = pathToFileURL(file).href;
  if (owner !== import.meta.url) {
    await access(file).catch((error) => {
      if (error.code === 'ENOENT') throw documentMigrationRequired();
      throw error;
    });
    const api = await import(owner);
    if (typeof api.assertPreparedDocument !== 'function') throw documentMigrationRequired();
    return api.assertPreparedDocument(directory);
  }
  const manifest = await readStoryProject(directory);
  if (!manifest)
    throw Object.assign(
      new Error(
        'This project owns a source entry. Continue through file edits and the existing build, or explicitly adopt story-project.json.',
      ),
      { code: 'custom_scene_entry' },
    );
  return { ...pin, manifest };
}

const referenced = (manifest, file, directory) =>
  fields.some((field) =>
    Object.values(manifest[field] ?? {}).some((spec) => localFile(spec, directory) === file),
  );

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
  const pinBefore = await readOptional(join(destination, preparedRuntimeFile));
  if (pinBefore)
    return updatePreparedSceneRuntime(destination, options, {
      manifest,
      owner,
      before,
      lock,
      pinBefore,
    });
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
  if (
    !options.retainPreviousArchive &&
    typeof previous === 'string' &&
    managed.test(previous) &&
    previous !== receipt.dependency
  ) {
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
