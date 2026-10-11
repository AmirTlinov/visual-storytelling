import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { contentDigest } from '../../tools/build-info.mjs';

/** The installer selects a release; a stale MCP must not mix its UI/schema with that release. */
export async function installedRuntime(serverDirectory) {
  const directory = await realpath(serverDirectory),
    root = resolve(directory, '../..');
  const receipt = await lstat(join(root, '.installation.json')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!receipt) return null; // Development and unpacked releases retain their explicit path.
  const releases = dirname(root),
    installation = dirname(releases),
    owner = await lstat(installation);
  if (
    !receipt.isFile() ||
    receipt.uid !== process.getuid() ||
    basename(releases) !== 'releases' ||
    !owner.isDirectory() ||
    owner.uid !== process.getuid()
  )
    throw new Error('Installed runtime has an unexpected owner or location.');
  const current = await realpath(join(installation, 'current')),
    selected = await lstat(join(current, '.installation.json'));
  if (dirname(current) !== releases || !selected.isFile() || selected.uid !== owner.uid)
    throw new Error('Selected runtime leaves its installation or has an unexpected owner.');
  return { directory: join(current, 'plugin/dist'), installation };
}

export async function requireSelectedRuntime(directory) {
  const installed = await installedRuntime(directory);
  if (installed && installed.directory !== (await realpath(directory)))
    throw Object.assign(new Error('This MCP connection belongs to a previous installed release.'), {
      code: 'RUNTIME_UPDATE_REQUIRED',
      action: 'Reconnect Visual Storytelling in this chat to use the installed release.',
    });
  return installed;
}

/** One handshake identity covers late imports and the installation that owns their paths. */
export async function runtimeBuild(serverDirectory) {
  const directory = await realpath(serverDirectory);
  const root = resolve(directory, '../..');
  // Workers and help load tools/core outside kernel.mjs. The core receipt also identifies
  // shipped templates and docs. Exclude only intermediate scene builds, never live bundles.
  const contents = await contentDigest(
    root,
    ['plugin', 'tools', 'dist', 'package.json', 'package-lock.json', 'plugin.json'],
    (name) => name === 'plugin/dist/scenes' || name.startsWith('plugin/dist/scenes/'),
  );
  return createHash('sha256')
    .update(JSON.stringify([directory, process.version, process.platform, process.arch, contents]))
    .digest('hex');
}
