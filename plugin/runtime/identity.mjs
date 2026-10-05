import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { contentDigest } from '../../tools/build-info.mjs';

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
