#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const execute = promisify(execFile);
const receiptFile = '.installation.json';
export const installationDirectory = () =>
  process.env.VISUAL_STORY_INSTALL_DIR ??
  join(homedir(), 'Library/Application Support/Visual Storytelling/installation');

/** A stable executable resolves one immutable release before Node or any late import starts. */
export const launcher = `#!/bin/sh
set -eu
base=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if ! cd -P "$base/current" 2>/dev/null; then
  echo 'Visual Storytelling is not installed. Run the installer from the release archive.' >&2
  exit 1
fi
export PLUGIN_ROOT="$PWD"
exec "$PWD/runtime/node" "$PWD/plugin/dist/server.mjs" "$@"
`;

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
async function optionalRead(path) {
  return readFile(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
async function atomicFile(path, data, mode = 0o600) {
  const temporary = path + '.' + randomUUID();
  try {
    await writeFile(temporary, data, { flag: 'wx', mode });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
async function pointAt(directory, target) {
  const temporary = join(directory, '.current-' + randomUUID());
  try {
    await symlink(target, temporary);
    await rename(temporary, join(directory, 'current'));
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Hash the complete shipped tree, including safe local symlink identities and executable bits. */
export async function releaseDigest(root) {
  const hash = createHash('sha256');
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = join(directory, entry.name),
        name = relative(root, file);
      if (name === receiptFile) continue;
      const info = await lstat(file);
      if (info.isDirectory()) {
        hash.update(`directory\0${name}\0`);
        await visit(file);
      } else if (info.isSymbolicLink()) {
        const target = await readlink(file),
          inside = relative(root, resolve(dirname(file), target));
        if (isAbsolute(target) || inside === '..' || inside.startsWith('../'))
          throw new Error(`Release link escapes its directory: ${name}`);
        hash.update(`link\0${name}\0${target}\0`);
      } else if (info.isFile()) {
        hash.update(`file\0${name}\0${info.size}\0${info.mode & 0o111}\0`);
        for await (const bytes of createReadStream(file)) hash.update(bytes);
      } else throw new Error(`Unsupported release entry: ${name}`);
    }
  }
  await visit(root);
  return hash.digest('hex');
}

async function validateRelease(root) {
  const manifest = await json(join(root, 'plugin.json'));
  const release = await json(join(root, 'release.json'));
  if (
    manifest.name !== 'visual-storytelling' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)
  )
    throw new Error('Expected a versioned Visual Storytelling release.');
  if (
    release.plugin !== manifest.version ||
    release.platform !== process.platform ||
    release.arch !== process.arch
  )
    throw new Error('Release version or platform does not match this installation.');
  for (const name of [
    'plugin/dist/server.mjs',
    'plugin/dist/kernel.mjs',
    'plugin/dist/app.html',
    'dist/build-info.json',
    'LICENSE',
  ])
    if (!(await lstat(join(root, name))).isFile()) throw new Error(`Incomplete release: ${name}`);
  await access(join(root, 'runtime/node'), constants.X_OK);
  return manifest;
}

async function permissions(directory, immutable) {
  // Never chmod through npm's relative executable links.
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await permissions(file, immutable);
    else if (entry.isFile()) {
      const mode = (await lstat(file)).mode;
      await chmod(file, immutable ? 0o444 | (mode & 0o111) : 0o644 | (mode & 0o111));
    }
  }
  await chmod(directory, immutable ? 0o555 : 0o700);
}

async function installationLock(directory) {
  const lock = join(directory, '.install-lock'),
    token = randomUUID(),
    until = Date.now() + 120000;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token }), {
        flag: 'wx',
        mode: 0o600,
      });
      return async () => {
        const owner = await json(join(lock, 'owner.json')).catch(() => null);
        if (owner?.token === token) await rm(lock, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await json(join(lock, 'owner.json')).catch(() => null);
      let stale = false;
      if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
        } catch (failure) {
          if (failure.code === 'ESRCH') stale = true;
          else if (failure.code !== 'EPERM') throw failure;
        }
      } else {
        const info = await lstat(lock).catch(() => null);
        stale = info && Date.now() - info.mtimeMs > 120000;
      }
      if (stale) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= until)
        throw new Error(
          'Another Visual Storytelling installation is still running. Retry when it finishes.',
        );
      await delay(100);
    }
  }
}

/** Installation owns version selection; the existing runtime socket owns processes and sessions. */
export async function installRelease(
  source,
  { directory = installationDirectory(), register = true, codex = 'codex' } = {},
) {
  source = await realpath(source);
  const manifest = await validateRelease(source),
    digest = await releaseDigest(source);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await realpath(directory);
  const owner = await lstat(directory);
  if (owner.uid !== process.getuid())
    throw new Error('Installation directory belongs to another user.');
  await chmod(directory, 0o700);
  const unlock = await installationLock(directory);
  const id = manifest.version + '-' + digest.slice(0, 16),
    relativeRelease = join('releases', id),
    release = join(directory, relativeRelease);
  let temporary;
  try {
    await mkdir(join(directory, 'releases'), { recursive: true, mode: 0o700 });
    const existing = await lstat(release).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (existing) {
      if (!existing.isDirectory() || (await releaseDigest(release)) !== digest)
        throw new Error(
          'Installed release changed. Refusing to overwrite immutable runtime files.',
        );
    } else {
      temporary = join(directory, 'releases', '.install-' + randomUUID());
      await cp(source, temporary, { recursive: true, verbatimSymlinks: true });
      if ((await releaseDigest(temporary)) !== digest)
        throw new Error('Release changed while copying. Finish building and retry installation.');
      await writeFile(
        join(temporary, receiptFile),
        JSON.stringify({ version: manifest.version, digest }, null, 2) + '\n',
      );
      await permissions(temporary, true);
      await rename(temporary, release);
      temporary = undefined;
    }
    await atomicFile(join(directory, 'launch'), launcher, 0o755);
    const marketDirectory = join(directory, '.agents/plugins');
    await mkdir(marketDirectory, { recursive: true, mode: 0o700 });
    const marketplaceFile = join(marketDirectory, 'marketplace.json');
    const previousManifest = await optionalRead(marketplaceFile);
    const previous = await readlink(join(directory, 'current')).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const marketplace = {
      name: 'visual-storytelling-local',
      interface: { displayName: 'Visual Storytelling' },
      plugins: [
        {
          name: 'visual-storytelling',
          source: { source: 'local', path: './' + relativeRelease },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Education',
        },
      ],
    };
    await atomicFile(marketplaceFile, JSON.stringify(marketplace, null, 2) + '\n');
    await pointAt(directory, relativeRelease);
    let priorRegistration,
      movedRegistration = false,
      addedRegistration = false;
    try {
      if (register) {
        const listed = await execute(codex, ['plugin', 'marketplace', 'list', '--json'], {
          maxBuffer: 2_000_000,
        });
        priorRegistration = JSON.parse(listed.stdout).marketplaces.find(
          (item) => item.name === 'visual-storytelling-local',
        );
        if (priorRegistration && (await realpath(priorRegistration.root)) !== directory) {
          if (priorRegistration.marketplaceSource?.sourceType !== 'local')
            throw new Error(
              'The Visual Storytelling marketplace has a non-local source. Select its local installation explicitly.',
            );
          await execute(
            codex,
            ['plugin', 'marketplace', 'remove', 'visual-storytelling-local', '--json'],
            { maxBuffer: 2_000_000 },
          );
          movedRegistration = true;
        }
        await execute(codex, ['plugin', 'marketplace', 'add', directory, '--json'], {
          maxBuffer: 2_000_000,
        });
        addedRegistration = true;
        await execute(
          codex,
          ['plugin', 'add', 'visual-storytelling@visual-storytelling-local', '--json'],
          { maxBuffer: 2_000_000 },
        );
        const declared = (await json(join(release, 'mcp.json'))).mcpServers?.[
          'visual-storytelling'
        ];
        const effective = JSON.parse(
          (await execute(codex, ['mcp', 'get', 'visual-storytelling', '--json'])).stdout,
        );
        if (
          !effective.enabled ||
          effective.transport?.command !== declared?.command ||
          JSON.stringify(effective.transport?.args) !== JSON.stringify(declared?.args) ||
          !effective.transport?.env?.PLUGIN_DATA ||
          effective.transport.cwd !== effective.transport.env.PLUGIN_DATA
        )
          throw new Error('Codex did not load the stable Visual Storytelling launcher.');
      }
    } catch (error) {
      if (previous) await pointAt(directory, previous);
      else await rm(join(directory, 'current'), { force: true });
      if (previousManifest) await atomicFile(marketplaceFile, previousManifest);
      else await rm(marketplaceFile, { force: true });
      let recovery = '';
      if (movedRegistration || addedRegistration) {
        try {
          if (addedRegistration && (movedRegistration || !priorRegistration))
            await execute(
              codex,
              ['plugin', 'marketplace', 'remove', 'visual-storytelling-local', '--json'],
              { maxBuffer: 2_000_000 },
            );
          if (movedRegistration)
            await execute(
              codex,
              [
                'plugin',
                'marketplace',
                'add',
                priorRegistration.marketplaceSource.source,
                '--json',
              ],
              { maxBuffer: 2_000_000 },
            );
          if (priorRegistration)
            await execute(
              codex,
              ['plugin', 'add', 'visual-storytelling@visual-storytelling-local', '--json'],
              { maxBuffer: 2_000_000 },
            );
        } catch (failure) {
          recovery = ` Marketplace recovery also failed: ${failure.message}`;
        }
      }
      throw new Error(
        `Codex registration failed; the previous runtime selection is preserved. ${error.message}${recovery}`,
        { cause: error },
      );
    }
    return {
      version: manifest.version,
      digest,
      release,
      launcher: join(directory, 'launch'),
      registered: register,
    };
  } finally {
    if (temporary) {
      await permissions(temporary, false).catch(() => {});
      await rm(temporary, { recursive: true, force: true });
    }
    await unlock();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    options: {
      directory: { type: 'string' },
      'skip-registration': { type: 'boolean' },
      codex: { type: 'string' },
    },
    allowPositionals: true,
  });
  if (positionals.length > 1)
    throw new Error('Usage: node plugin/install.mjs [release-directory] [--skip-registration]');
  if (values.directory && !values['skip-registration'])
    throw new Error('Use --skip-registration with an isolated --directory.');
  const result = await installRelease(
    positionals[0] ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    {
      directory: values.directory,
      register: !values['skip-registration'],
      codex: values.codex,
    },
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.registered)
    console.log(
      'Open Visual Storytelling setup in Codex. Reconnect the plugin after active work finishes to use this release.',
    );
}
