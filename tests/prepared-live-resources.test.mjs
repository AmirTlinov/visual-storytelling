import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'parse5';
import { inlineResources } from '../tools/inline-resources.mjs';
import { playbackHTML, setNarrationMode, generatedNarrationHook } from '../tools/narration.mjs';

test('prepared media embeds original audio and public timing; missing audible assets fail', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'prepared-live-resources-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const recording = Buffer.from('immutable original recording');
  const timeline = {
    version: 1,
    duration: 1,
    cues: { 'division.gather': { start: 0, end: 1 } },
    segments: [{ id: 'division.gather', text: 'Соберём предметы.', start: 0, end: 1 }],
    source_sha256: 'private-receipt',
    synthesis: { voice: '/private/voice.wav' },
  };
  await writeFile(join(directory, 'audio.wav'), recording);
  await writeFile(join(directory, 'timeline.json'), JSON.stringify(timeline));
  const source = setNarrationMode('<!doctype html><html><body></body></html>', false);
  const hook = generatedNarrationHook(source);
  assert.match(await inlineResources(directory).markup(hook), /src="audio.wav"/);
  const resources = inlineResources(directory, { audio: true });
  const embedded = await resources.markup(playbackHTML(hook));
  const audio = parse(embedded)
    .childNodes.find((node) => node.tagName === 'html')
    .childNodes.find((node) => node.tagName === 'body').childNodes[0];
  const attrs = Object.fromEntries(audio.attrs.map(({ name, value }) => [name, value]));
  const decode = (url) => Buffer.from(url.split(',')[1], 'base64');
  assert.deepEqual(decode(attrs.src), recording);
  assert.deepEqual(JSON.parse(decode(attrs['data-story-timeline'])), {
    version: timeline.version,
    duration: timeline.duration,
    cues: timeline.cues,
    segments: timeline.segments,
  });
  await rm(join(directory, 'audio.wav'));
  await assert.rejects(resources.markup(playbackHTML(hook)), { code: 'ENOENT' });
  await rm(join(directory, 'timeline.json'));
  const quiet = generatedNarrationHook(setNarrationMode(source, true));
  const silent = await resources.markup(playbackHTML(quiet));
  assert.match(silent, /data-silent="true"/);
  assert.doesNotMatch(silent, /(?:src|data-story-timeline)=/);
});
