import fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { acquireDirectoryLock } from '../file-lock.mjs';

export const narrationOutputNames = Object.freeze([
  'audio.wav',
  'voice.wav',
  'music.wav',
  'timeline.json',
  'CREDITS.txt',
  'narration.txt',
  'voice-preview.html',
]);
const journalName = '.vstory-voice-publication';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const missing = (error) => {
  if (error.code !== 'ENOENT') throw error;
  return null;
};
async function bytes(file) {
  const stat = await fs.lstat(file).catch(missing);
  if (!stat) return null;
  if (!stat.isFile()) throw new Error(`Narration publication needs a regular file: ${file}`);
  return fs.readFile(file);
}
async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function durableFile(file, value) {
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function writePlan(journal, plan) {
  const temporary = join(journal, 'plan-' + randomUUID());
  await durableFile(temporary, JSON.stringify(plan));
  await fs.rename(temporary, join(journal, 'plan.json'));
  await syncDirectory(journal);
}
async function readPlan(directory, journal = join(directory, journalName)) {
  const stat = await fs.lstat(journal).catch(missing);
  if (!stat) return;
  if (!stat.isDirectory()) throw new Error('Invalid narration publication journal.');
  const plan = JSON.parse(await bytes(join(journal, 'plan.json')));
  if (
    plan?.version !== 1 ||
    plan.directory !== directory ||
    !['prepared', 'rollback', 'committed'].includes(plan.phase) ||
    !Number.isSafeInteger(plan.pid) ||
    plan.pid < 1 ||
    !Array.isArray(plan.files) ||
    !plan.files.length ||
    new Set(plan.files.map((f) => f.name)).size !== plan.files.length ||
    plan.files.some(
      (f) =>
        !narrationOutputNames.includes(f.name) ||
        [f.before, f.after].some((d) => d !== null && !/^[a-f0-9]{64}$/.test(d)),
    )
  )
    throw new Error('Invalid narration publication journal.');
  return { journal, plan };
}
async function verify(directory, journal, plan) {
  // Validate every durable backup before changing any accepted file.
  for (const item of plan.files) {
    for (const [folder, expected] of [
      ['previous', item.before],
      ['next', item.after],
    ]) {
      const saved = await bytes(join(journal, folder, item.name));
      if ((saved === null ? null : hash(saved)) !== expected)
        throw new Error(`Narration recovery bytes changed: ${item.name}`);
    }
    const current = await bytes(join(directory, item.name)),
      digest = current === null ? null : hash(current);
    if (digest !== item.before && digest !== item.after)
      throw new Error(`Narration output changed outside its publication: ${item.name}`);
  }
}
async function apply(directory, journal, plan, side, signal) {
  for (const item of plan.files) {
    signal?.throwIfAborted();
    const expected = side === 'next' ? item.after : item.before;
    const target = join(directory, item.name),
      current = await bytes(target);
    const digest = current === null ? null : hash(current);
    if (digest !== item.before && digest !== item.after)
      throw new Error(`Narration output changed outside its publication: ${item.name}`);
    if (digest === expected) continue;
    if (expected === null) await fs.rm(target, { force: true });
    else {
      const temporary = join(directory, '.voice-publish-' + randomUUID());
      try {
        await durableFile(temporary, await bytes(join(journal, side, item.name)));
        const latest = await bytes(target),
          latestDigest = latest === null ? null : hash(latest);
        if (latestDigest !== digest)
          throw new Error(`Narration output changed during publication: ${item.name}`);
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    await syncDirectory(directory);
  }
  signal?.throwIfAborted();
}
async function discard(directory, journal) {
  const retired = join(directory, '.voice-retired-' + randomUUID());
  await fs.rename(journal, retired);
  await syncDirectory(directory);
  await fs.rm(retired, { recursive: true, force: true });
}

async function preparingJournals(directory) {
  return (await fs.readdir(directory))
    .filter((name) => name.startsWith('.voice-preparing-'))
    .map((name) => join(directory, name));
}

/** Readers never repair a half-published recording or start a model. */
export async function assertNarrationPublished(directory) {
  if (
    (await fs.lstat(join(directory, journalName)).catch(missing)) ||
    (await preparingJournals(directory)).length
  )
    throw new Error(
      'Narration publication was interrupted. Retry explicit voice preparation to recover it.',
    );
}

/** Explicit retry finishes durable prepared bytes before any provider can be invoked. */
export async function recoverNarration(directory) {
  directory = await fs.realpath(directory);
  const release = await acquireDirectoryLock(join(directory, '.vstory-voice-publication-lock'));
  try {
    let saved = await readPlan(directory);
    const preparing = await preparingJournals(directory);
    if (preparing.length) {
      if (saved || preparing.length !== 1)
        throw new Error(
          'Conflicting narration publications are preserved; no provider will be called.',
        );
      saved = await readPlan(directory, preparing[0]);
      if (!saved)
        throw new Error(
          'Incomplete narration publication is preserved; no provider will be called.',
        );
      await verify(directory, saved.journal, saved.plan);
      const journal = join(directory, journalName);
      await fs.rename(saved.journal, journal);
      await syncDirectory(directory);
      saved = { ...saved, journal };
    }
    if (!saved) return false;
    const { journal, plan } = saved;
    await verify(directory, journal, plan);
    await apply(directory, journal, plan, plan.phase === 'rollback' ? 'previous' : 'next');
    await discard(directory, journal);
    return true;
  } finally {
    await release();
  }
}

/** One durable publication owner for Higgs and local/API adapters. */
export async function publishNarration(directory, staging, names, { signal } = {}) {
  directory = await fs.realpath(directory);
  if (
    !Array.isArray(names) ||
    !names.length ||
    new Set(names).size !== names.length ||
    names.some((name) => !narrationOutputNames.includes(name))
  )
    throw new Error('Invalid narration publication outputs.');
  signal?.throwIfAborted();
  const release = await acquireDirectoryLock(join(directory, '.vstory-voice-publication-lock'), {
    signal,
  });
  try {
    await assertNarrationPublished(directory);
    const preparing = await fs.mkdtemp(join(directory, '.voice-preparing-'));
    await syncDirectory(directory);
    const journal = join(directory, journalName);
    let published = false;
    try {
      await fs.mkdir(join(preparing, 'next'));
      await fs.mkdir(join(preparing, 'previous'));
      const files = [];
      for (const name of names) {
        const before = await bytes(join(directory, name)),
          after = await bytes(join(staging, name));
        if (before !== null) await durableFile(join(preparing, 'previous', name), before);
        if (after !== null) await durableFile(join(preparing, 'next', name), after);
        files.push({
          name,
          before: before === null ? null : hash(before),
          after: after === null ? null : hash(after),
        });
      }
      await syncDirectory(join(preparing, 'next'));
      await syncDirectory(join(preparing, 'previous'));
      const plan = { version: 1, directory, pid: process.pid, phase: 'prepared', files };
      await writePlan(preparing, plan);
      signal?.throwIfAborted();
      await fs.rename(preparing, journal);
      published = true;
      await syncDirectory(directory);
      try {
        await verify(directory, journal, plan);
        await apply(directory, journal, plan, 'next', signal);
        await writePlan(journal, { ...plan, phase: 'committed' });
      } catch (error) {
        try {
          await writePlan(journal, { ...plan, phase: 'rollback' });
          await verify(directory, journal, plan);
          await apply(directory, journal, plan, 'previous');
          await discard(directory, journal);
        } catch (recovery) {
          throw new AggregateError(
            [error, recovery],
            'Narration publication needs explicit recovery; durable old/new bytes are retained.',
          );
        }
        throw error;
      }
      await discard(directory, journal);
    } finally {
      if (!published) await fs.rm(preparing, { recursive: true, force: true });
    }
  } finally {
    await release();
  }
}
