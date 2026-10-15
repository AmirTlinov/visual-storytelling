import { AsyncLocalStorage } from 'node:async_hooks';
import { open, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const operations = new AsyncLocalStorage();
const fingerprint = (stat) =>
  ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']
    .map((key) => String(stat[key]))
    .join(':');
const current = () => {
  const scope = operations.getStore();
  return scope?.active ? scope : undefined;
};

/** Reuse content proofs only inside one owned operation, never across watcher/restart boundaries. */
export async function withVerifiedInputs(work) {
  if (current()) return work();
  const scope = {
    active: true,
    files: new Map(),
    metrics: { readBytes: 0, hashedBytes: 0, copiedBytes: 0, hashes: 0, hits: 0, statChecks: 0 },
  };
  try {
    return await operations.run(scope, work);
  } finally {
    scope.active = false;
    scope.files.clear();
  }
}
export const verifiedInputWork = () => ({ ...current()?.metrics });
export function copiedInputBytes(bytes) {
  const scope = current();
  if (scope) scope.metrics.copiedBytes += bytes;
}

/** A content hash is reusable only while inode and nanosecond change metadata still match. */
export async function verifiedInputDigest(file) {
  const scope = current();
  const before = await lstat(file, { bigint: true });
  if (scope) scope.metrics.statChecks++;
  if (!before.isFile()) throw new Error('A verified input must remain a regular file.');
  const identity = fingerprint(before),
    previous = scope?.files.get(file);
  if (previous?.identity === identity) {
    scope.metrics.hits++;
    return previous.digest;
  }
  const handle = await open(file, 'r');
  let bytes, observed;
  try {
    observed = await handle.stat({ bigint: true });
    bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (fingerprint(after) !== fingerprint(observed))
      throw new Error('Project changed while reading its inputs.');
  } finally {
    await handle.close();
  }
  const latest = await lstat(file, { bigint: true });
  if (identity !== fingerprint(observed) || identity !== fingerprint(latest))
    throw new Error('Project changed while reading its inputs.');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (scope) {
    scope.metrics.statChecks += 3;
    scope.metrics.readBytes += bytes.length;
    scope.metrics.hashedBytes += bytes.length;
    scope.metrics.hashes++;
    scope.files.set(file, { identity, digest });
  }
  return digest;
}
