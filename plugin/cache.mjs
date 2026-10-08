import { readdir, lstat, readlink, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { readJSON } from './runtime/storage.mjs';

const entries = (path) =>
  readdir(path).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
async function size(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return stat.size;
  return (await Promise.all((await entries(path)).map((name) => size(join(path, name))))).reduce(
    (a, b) => a + b,
    0,
  );
}

/** Evict only disposable preparation. Authored projects, history and released artifacts are outside this owner. */
export async function collectCache(data, { limitMB, projects, sessions, snapshotLeases }) {
  const keepBuilds = new Set(),
    keepSnapshots = new Set(),
    keepDependencies = new Set();
  for (const project of projects) if (project.buildRevision) keepBuilds.add(project.buildRevision);
  for (const session of sessions) {
    keepBuilds.add(session.build.revision);
    if (session.nextBuild) keepBuilds.add(session.nextBuild.revision);
  }
  // Persisted cards and lesson return points must reopen after restarting the plugin.
  for (const name of await entries(join(data, 'sessions'))) {
    if (!name.endsWith('.json')) continue;
    const saved = await readJSON(join(data, 'sessions', name));
    if (saved?.buildRevision) keepBuilds.add(saved.buildRevision);
  }
  for (const id of snapshotLeases) {
    const snapshot = join(data, 'snapshots', id);
    keepSnapshots.add(snapshot);
    const input = await readJSON(join(snapshot, '.vstory-input.json'));
    if (input?.buildRevision) keepBuilds.add(input.buildRevision);
  }
  for (const revision of keepBuilds) {
    if (!/^[a-zA-Z0-9._-]+$/.test(revision)) continue;
    const build = await readJSON(join(data, 'builds', revision + '.json'));
    if (build?.snapshot) keepSnapshots.add(resolve(build.snapshot));
  }
  for (const snapshot of keepSnapshots) {
    const link = await readlink(join(snapshot, 'node_modules')).catch((error) => {
      if (['ENOENT', 'EINVAL'].includes(error.code)) return null;
      throw error;
    });
    if (link) keepDependencies.add(dirname(resolve(snapshot, link)));
  }
  const candidates = [];
  let bytes = 0,
    protectedBytes = 0;
  for (const category of ['builds', 'snapshots', 'dependencies', 'speech'])
    for (const name of await entries(join(data, category))) {
      const path = join(data, category, name),
        stat = await lstat(path),
        bytesHere = await size(path);
      const protectedEntry =
        category === 'builds'
          ? keepBuilds.has(name.replace(/\.json$/, ''))
          : category === 'snapshots'
            ? keepSnapshots.has(path)
            : category === 'dependencies'
              ? keepDependencies.has(path)
              : false;
      bytes += bytesHere;
      if (protectedEntry) protectedBytes += bytesHere;
      else candidates.push({ path, bytes: bytesHere, used: stat.mtimeMs });
    }
  const before = bytes,
    limit = limitMB * 1024 * 1024;
  for (const item of candidates.sort((a, b) => a.used - b.used)) {
    if (bytes <= limit) break;
    await rm(item.path, { recursive: true, force: true });
    bytes -= item.bytes;
  }
  return { bytes, protectedBytes, removedBytes: before - bytes, limitBytes: limit };
}
