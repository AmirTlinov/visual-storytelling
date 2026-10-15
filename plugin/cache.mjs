import { readdir, lstat, readlink, rm, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { readJSON } from '../tools/storage.mjs';
import { readBuildMetadata, presentationAvailable } from './build-payload.mjs';

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
export async function collectCache(
  data,
  { limitMB, projects, sessions, snapshotLeases, buildLeases = [] },
) {
  const keepBuilds = new Set(buildLeases),
    keepSnapshots = new Set(),
    keepDependencies = new Set(),
    keepPayloads = new Set(),
    keepPresentations = new Set();
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
    if (saved?.nextBuildRevision) keepBuilds.add(saved.nextBuildRevision);
  }
  for (const id of snapshotLeases) {
    const snapshot = join(data, 'snapshots', id);
    keepSnapshots.add(snapshot);
    const input = await readJSON(join(snapshot, '.vstory-input.json'));
    if (input?.buildRevision) keepBuilds.add(input.buildRevision);
    if (input?.acceptedBuildRevision) keepBuilds.add(input.acceptedBuildRevision);
  }
  for (const revision of keepBuilds) {
    if (!/^[a-zA-Z0-9._-]+$/.test(revision)) continue;
    const build = await readBuildMetadata(data, revision);
    if (build?.snapshot) keepSnapshots.add(resolve(build.snapshot));
    for (const part of build?.presentation?.parts ?? [])
      if (/^[a-f0-9]{64}$/.test(part.asset)) keepPayloads.add(part.asset);
    if (/^[a-f0-9]{64}$/.test(build?.presentation?.template))
      keepPresentations.add(build.presentation.template);
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
  for (const category of [
    'builds',
    'snapshots',
    'dependencies',
    'speech',
    'payloads',
    'presentation-bases',
  ])
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
              : category === 'payloads'
                ? keepPayloads.has(name.replace(/\.html$/, ''))
                : category === 'presentation-bases'
                  ? keepPresentations.has(name.replace(/\.json$/, ''))
                  : false;
      bytes += bytesHere;
      if (protectedEntry) protectedBytes += bytesHere;
      else candidates.push({ path, category, name, bytes: bytesHere, used: stat.mtimeMs });
    }
  const before = bytes,
    limit = limitMB * 1024 * 1024;
  const removed = new Set();
  for (const item of candidates.sort((a, b) => a.used - b.used)) {
    if (bytes - protectedBytes <= limit) break;
    await rm(item.path, { recursive: true, force: true });
    removed.add(item.path);
    bytes -= item.bytes;
  }
  // An unprotected receipt cannot outlive an evicted dependency and block rebuilding
  // that same content revision. Protected graphs were closed before eviction above.
  for (const item of candidates) {
    if (item.category !== 'builds' || !item.name.endsWith('.json') || removed.has(item.path))
      continue;
    const build = await readBuildMetadata(data, item.name.slice(0, -5));
    if (!build) continue;
    const inputAvailable =
      !build.snapshot ||
      (dirname(resolve(build.snapshot)) === resolve(data, 'snapshots') &&
        (await access(build.snapshot).then(
          () => true,
          (error) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          },
        )));
    const payloadAvailable =
      !build.presentation || (await presentationAvailable(data, build.presentation));
    if (inputAvailable && payloadAvailable) continue;
    await rm(item.path, { force: true });
    bytes -= item.bytes;
  }
  return {
    totalBytes: bytes,
    disposableBytes: bytes - protectedBytes,
    protectedBytes,
    removedBytes: before - bytes,
    limitBytes: limit,
  };
}
