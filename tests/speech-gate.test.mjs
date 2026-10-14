import test from 'node:test';
import assert from 'node:assert/strict';
import { story } from '../dist/story/story.js';
import { recordedSpeechAt } from '../dist/story/recorded-speech.js';
import { speechGate } from '../dist/story/speech-gate.js';
import { cueSheet } from '../dist/story/cues.js';
import { playbackHarness } from './story/playback-harness.mjs';
import { documentSpeechAnchorsCurrent } from '../dist/story/document-audibility.js';
import { validateStoryDocument } from '../dist/story/document-schema.js';
import { spokenSpan } from '../dist/story/spoken-words.js';

test('quiet timing rejects repartitioned and reordered action anchors within an unchanged whole take', () => {
  const document = validateStoryDocument({
    version: 2,
    models: [{ id: 'division', module: 'division', inputs: { count: 2, divisor: 2 } }],
    views: [{ id: 'groups', kind: 'groups', model: 'division' }],
    chapters: [
      {
        id: 'lesson',
        title: 'Предметы',
        beats: [
          {
            id: 'a',
            say: 'Два предмета.',
            speech: { id: 'voice.thought', when: { basis: 'presented', models: [] } },
          },
          {
            id: 'b',
            say: 'Соберём одну группу.',
            speech: { id: 'voice.thought', when: { basis: 'presented', models: [] } },
          },
        ],
      },
    ],
  });
  const recording = {
    duration: 5,
    cues: { 'lesson.a': { start: 0.1, end: 1.5 }, 'lesson.b': { start: 2, end: 4 } },
    segments: [
      {
        id: 'voice.thought',
        text: 'Два предмета. Соберём одну группу.',
        source_text: 'Два предмета. Соберём одну группу.',
        conditions: { basis: 'presented', models: [] },
        start: 0.1,
        end: 4,
        words: [
          { text: 'Два', start: 0.1, end: 0.5 },
          { text: 'предмета', start: 1, end: 1.5 },
          { text: 'Соберём', start: 2, end: 2.6 },
          { text: 'одну', start: 3, end: 3.5 },
          { text: 'группу', start: 3.8, end: 4 },
        ],
      },
    ],
  };
  assert.equal(documentSpeechAnchorsCurrent(document, recording), true);
  const silent = structuredClone(document);
  silent.chapters[0].beats = [{ id: 'silent', seconds: 1, action: 'Посмотрим на предметы.' }];
  assert.equal(documentSpeechAnchorsCurrent(silent, recording), false);
  const extra = structuredClone(recording);
  extra.segments.push({ ...extra.segments[0], id: 'voice.deleted' });
  assert.equal(documentSpeechAnchorsCurrent(document, extra), false);
  extra.segments[1].id = 'voice.thought';
  assert.equal(documentSpeechAnchorsCurrent(document, extra), false);
  const changed = structuredClone(document);
  changed.chapters[0].beats[0].say = 'Два предмета. Соберём';
  changed.chapters[0].beats[1].say = 'одну группу.';
  assert.equal(documentSpeechAnchorsCurrent(changed, recording), false);
  const repeated = structuredClone(document);
  repeated.chapters[0].beats[0].say = 'Два предмета.';
  repeated.chapters[0].beats[1].say = 'Два предмета.';
  const repeatedRecord = structuredClone(recording);
  Object.assign(repeatedRecord.segments[0], {
    text: 'Два предмета. Два предмета.',
    source_text: 'Два предмета. Два предмета.',
    words: [
      { text: 'Два предмета.', start: 0.1, end: 1.5 },
      { text: 'Два предмета.', start: 2, end: 4 },
    ],
  });
  assert.equal(documentSpeechAnchorsCurrent(repeated, repeatedRecord), true);
  repeated.chapters[0].beats.reverse();
  assert.equal(documentSpeechAnchorsCurrent(repeated, repeatedRecord), false);
  assert.equal(spokenSpan([{ text: 'Два предмета.', start: 0.1, end: 1.5 }], 1, 1), undefined);
});

const script = {
  duration: 8,
  cues: { all: { start: 0, end: 8 } },
  segments: [
    { id: 'look', start: 0, end: 2, text: 'Посмотрим на группы.' },
    { id: 'number', start: 2, end: 4, text: 'Семнадцать предметов.' },
    { id: 'try', start: 4, end: 6, text: 'Теперь попробуй сам.' },
    { id: 'check', start: 6, end: 8, text: 'Семнадцать предметов.' },
  ],
};

test('changed numbers gate only dependent speech, preserve user mute and restart at a whole-unit boundary', async (t) => {
  const h = playbackHarness(t);
  h.audio.muted = false;
  let shown;
  const s = story({
    script,
    audio: h.audio,
    exploreTimeline: true,
    stateAt: () => ({ count: 17 }),
    render(values) {
      shown = values.count;
    },
    speechApplicable(unit, moment) {
      return ['look', 'try'].includes(unit.id) || moment.values.count === 17;
    },
  });
  h.own(s);
  await s.player.play();
  s.input({ count: 18 });
  assert.equal(shown, 18);
  assert.equal(h.audio.muted, false);
  h.tick(2.5);
  assert.equal(h.audio.muted, true);
  assert.equal(s.player.state.muted, false);
  assert.equal(s.player.state.speech.unit, 'number');
  s.input({ count: 17 });
  assert.equal(shown, 17);
  assert.equal(h.audio.muted, true);
  h.tick(4);
  assert.equal(h.audio.muted, false);
  h.tick(4.1);
  await s.player.mute(true);
  assert.equal(s.player.state.muted, true);
  await s.player.mute(false);
  assert.equal(s.player.state.muted, false);
  assert.equal(h.audio.muted, true);
  h.tick(4.5);
  assert.equal(h.audio.muted, true);
  h.tick(6);
  assert.equal(h.audio.muted, false);
  s.pause();
  await s.player.play();
  assert.equal(h.audio.muted, false);
  s.seek(6.5);
  assert.equal(h.audio.muted, true, 'a seek into an accepted phrase cannot emit its fragment');
  s.seek(6);
  assert.equal(h.audio.muted, false, 'an explicit whole-unit start can replay the phrase');
  assert(h.callbacks.size <= 1, 'transport retains one frame loop');
});

test('speech sees only a completed model frame, including asynchronous input preparation and failed applicability', async (t) => {
  const h = playbackHarness(t);
  h.audio.muted = false;
  let shown,
    release,
    pending = true,
    fail = false;
  const observed = [];
  const s = story({
    script,
    audio: h.audio,
    exploreTimeline: true,
    stateAt: () => ({ count: 17 }),
    prepare(v) {
      if (v.count === 18 && pending) return new Promise((resolve) => (release = resolve));
    },
    render(v) {
      shown = v.count;
    },
    speechApplicable(unit, moment) {
      observed.push({ shown, count: moment.values.count });
      if (fail) throw Error('speech condition failed');
      return ['look', 'try'].includes(unit.id) || moment.values.count === 17;
    },
  });
  h.own(s);
  await s.ready();
  await s.player.play();
  h.tick(2.3);
  s.input({ count: 18 });
  assert.equal(s.requested.values.count, 18);
  assert.equal(s.presented.values.count, 17);
  assert.equal(shown, 17);
  assert.equal(h.audio.paused, true);
  assert.equal(observed.at(-1).count, 17);
  pending = false;
  release();
  await s.ready();
  assert.equal(shown, 18);
  assert.equal(h.audio.muted, true);
  assert(observed.every((value) => value.count === value.shown));
  fail = true;
  assert.throws(() => s.input({ count: 19 }), /speech condition failed/);
  assert.equal(s.presented.values.count, 19);
  assert.equal(s.error.stage, 'speech');
  assert.equal(h.audio.paused, true);
});

test('a recorded thought keeps its full accepted take boundaries instead of individual word spans', () => {
  const recording = {
    duration: 5,
    cues: {},
    segments: [
      {
        id: 'thought',
        start: 0.4,
        end: 4.5,
        audio_start: 0.2,
        audio_end: 4.8,
        text: 'Одна законченная мысль.',
        words: [
          { text: 'Одна', start: 0.4, end: 1 },
          { text: 'законченная', start: 1.2, end: 3 },
          { text: 'мысль', start: 3.4, end: 4.5 },
        ],
      },
    ],
  };
  const take = recordedSpeechAt(recording, 2);
  assert.equal(take.id, 'thought');
  assert.equal(take.start, 0.2);
  assert.equal(take.end, 4.8);
  assert.equal(take.spokenStart, 0.4);
  assert.equal(recordedSpeechAt(recording, 4.9), undefined);
});

test('a stalled frame never enables a fragment; only the measured head pause permits entry', () => {
  const gate = speechGate();
  gate.observe({ time: 1.9, unit: { id: 'first', start: 0, end: 2 }, applicable: false });
  assert.equal(
    gate.observe({ time: 5.2, unit: { id: 'next', start: 4, end: 6 }, applicable: true }).audible,
    false,
  );
  const withHead = speechGate();
  const unit = { id: 'next', start: 4, spokenStart: 4.3, end: 6 };
  assert.equal(withHead.observe({ time: 4.1, unit, applicable: true }).audible, true);
  const afterHead = speechGate();
  assert.equal(afterHead.observe({ time: 4.5, unit, applicable: true }).audible, false);
});

test('invalid complete takes fail before any audio or speech callback can run', () => {
  const unit = {
    id: 'thought',
    start: 1,
    end: 7,
    text: 'Мысль.',
    audio_start: 0.5,
    audio_end: 7.5,
  };
  const sheet = (segments) => cueSheet({ duration: 8, cues: {}, segments });
  assert.doesNotThrow(() => sheet([unit]));
  for (const patch of [
    { audio_start: NaN },
    { audio_start: 7, audio_end: 6 },
    { audio_start: undefined },
    { audio_end: 9 },
    { audio_start: 2 },
    { audio_end: 6 },
    { id: '' },
  ])
    assert.throws(() => sheet([{ ...unit, ...patch }]), /Invalid recorded/);
  assert.throws(() => sheet([unit, unit]), /Invalid recorded/);
  assert.throws(() => sheet([unit, { ...unit, id: 'overlap' }]), /overlaps/);
});

test('accepted retry seed belongs to its performance while applicability follows the requested source seed', async () => {
  const { validateStoryDocument } = await import('../dist/story/document.js');
  const { documentSpeechApplicable } = await import('../dist/story/document-audibility.js');
  const document = validateStoryDocument({
    version: 2,
    models: [],
    views: [],
    chapters: [
      {
        id: 'lesson',
        title: 'Опыт',
        beats: [
          {
            id: 'look',
            say: 'Проверим рисунок.',
            speech: { id: 'voice.lesson.look', when: { basis: 'presented', models: [] } },
          },
        ],
      },
    ],
  });
  const unit = {
    id: 'voice.lesson.look',
    start: 0,
    end: 1,
    text: 'Проверим рисунок.',
    source_text: 'Проверим рисунок.',
    seed: 43,
    source_seed: 42,
    delivery: '',
    conditions: { basis: 'presented', models: [] },
  };
  assert.equal(documentSpeechApplicable(document, unit, 'story', {}), true);
  document.chapters[0].beats[0].speech.seed = 44;
  assert.equal(documentSpeechApplicable(document, unit, 'story', {}), false);
});
