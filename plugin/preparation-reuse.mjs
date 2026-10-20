import { dirname, join } from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { contentDigest } from '../tools/build-info.mjs';
import { projectFiles } from '../tools/project-files.mjs';

/** Existing jobs own proof reuse, request identities and their protected input snapshots. */
export async function reusePreparation(runner, { kind, input, requestId, signature }) {
  const previous = runner.forRequest(requestId);
  if (previous) {
    if (previous.signature !== signature)
      throw new Error('requestId already belongs to another preparation.');
    return runner.describe(previous);
  }
  let same = [...runner.jobs.values()].find(
    (job) => job.signature === signature && ['queued', 'running'].includes(job.status),
  );
  if (!same && kind === 'review' && !input.options?.scenario) {
    const toolchain = await runner.toolchain();
    for (const job of [...runner.jobs.values()].reverse()) {
      if (
        job.kind !== kind ||
        job.signature !== signature ||
        job.status !== 'succeeded' ||
        job.toolchain?.digest !== toolchain.digest
      )
        continue;
      const proof = job.result?.reportProof;
      if (
        !proof ||
        proof.version !== 1 ||
        proof.kind !== 'document-checkpoints' ||
        !/^[a-f0-9]{64}$/.test(proof.outputDigest ?? '') ||
        proof.directory !== dirname(job.result.path) ||
        typeof proof.snapshot !== 'string'
      )
        continue;
      try {
        if (
          dirname(await realpath(proof.snapshot)) !==
          (await realpath(join(runner.data, 'snapshots')))
        )
          continue;
        const root = proof.directory;
        if (!(await lstat(root)).isDirectory() || (await realpath(root)) !== root) continue;
        for (const name of ['index.html', 'motion.json', 'session.json'])
          if (!(await lstat(join(root, name))).isFile()) throw Error('Report replaced');
        if (
          (await projectFiles(proof.snapshot)).revision === proof.inputRevision &&
          (await contentDigest(join(proof.snapshot, 'dist'), ['.'])) === proof.outputDigest &&
          (await contentDigest(root, ['.'])) === proof.digest
        ) {
          same = job;
          break;
        }
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code) && error.message !== 'Report replaced')
          throw error;
      }
    }
  }
  if (!same) return;
  const previousRequest = same.lastRequestedAt;
  same.lastRequestedAt = new Date().toISOString();
  (same.requestIds ??= []).push(requestId);
  try {
    await runner.save(same);
  } catch (error) {
    same.requestIds.pop();
    if (previousRequest === undefined) delete same.lastRequestedAt;
    else same.lastRequestedAt = previousRequest;
    throw error;
  }
  return runner.describe(same);
}
