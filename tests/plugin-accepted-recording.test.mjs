import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reuseAcceptedRecording } from '../plugin/accepted-recording.mjs';
import { collectCache } from '../plugin/cache.mjs';
import { projectFiles } from '../tools/project-files.mjs';
import { writeJSON } from '../tools/storage.mjs';

test('accepted recording and stems survive a queued edit lease and enter only its verified preparation', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'story-accepted-recording-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const accepted = join(data, 'snapshots', 'accepted'),
    candidate = join(data, 'snapshots', 'candidate'),
    prepared = join(data, 'snapshots', 'prepared');
  for (const path of [accepted, candidate, prepared]) await mkdir(path, { recursive: true });
  await writeFile(join(accepted, 'story.json'), 'original author');
  await writeFile(join(accepted, 'audio.wav'), 'accepted master');
  await writeFile(join(accepted, 'voice.wav'), 'accepted voice stem');
  await writeFile(join(accepted, 'music.wav'), 'accepted music stem');
  await writeJSON(join(accepted, 'timeline.json'), {
    stem_sha256: { 'voice.wav': 'voice-hash', 'music.wav': 'music-hash' },
  });
  const before = await projectFiles(accepted);
  await writeJSON(join(accepted, '.vstory-input.json'), {
    revision: 'source',
    preparedRevision: before.revision,
  });
  await writeJSON(join(data, 'builds', 'old.json'), {
    projectId: 'project',
    revision: 'old',
    snapshot: accepted,
  });
  await writeJSON(join(candidate, '.vstory-input.json'), { acceptedBuildRevision: 'old' });
  await collectCache(data, {
    limitMB: 0,
    projects: [],
    sessions: [],
    snapshotLeases: ['candidate'],
  });
  await access(join(accepted, 'audio.wav'));
  await mkdir(prepared, { recursive: true });
  await writeFile(join(prepared, 'story.json'), 'changed author');
  await reuseAcceptedRecording(
    data,
    { projectId: 'project', acceptedBuildRevision: 'old' },
    prepared,
  );
  for (const file of ['audio.wav', 'voice.wav', 'music.wav', 'timeline.json'])
    assert.deepEqual(await readFile(join(prepared, file)), await readFile(join(accepted, file)));
  assert.equal(await readFile(join(prepared, 'story.json'), 'utf8'), 'changed author');
  assert.equal((await projectFiles(accepted)).revision, before.revision);
  await writeFile(join(accepted, 'voice.wav'), 'corrupted stem');
  await assert.rejects(
    reuseAcceptedRecording(data, { projectId: 'project', acceptedBuildRevision: 'old' }, prepared),
    /snapshot changed/,
  );
});
