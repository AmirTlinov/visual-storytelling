import test from 'node:test';
import assert from 'node:assert/strict';
import { cueSheet, activeCue } from '../dist/story/cues.js';
import { composeChapters } from '../dist/story/composition-plan.js';
import { documentScript } from '../dist/story/document.js';
import { morphTiming } from '../dist/morph/timing.js';

test('one action window retains speech anchors, observed progress and reversible morph time', () => {
  const source = {
    duration: 40,
    cues: {
      normalize: {
        start: 10,
        end: 11.22136,
        text: 'вернём строку слова на',
        action: 'Нормализовать ряд',
        timing: { duration: 9, delay: 0.5 },
      },
      explain: { start: 22, end: 23, timing: { duration: 5, delay: 2 } },
      compare: { start: 12, end: 12.8, timing: { until: 'explain', delay: 1 } },
    },
    segments: [
      {
        id: 'speech',
        start: 0,
        end: 35,
        text: 'Речь неизменна',
        words: [
          { text: 'Речь', start: 0, end: 0.6 },
          { text: 'неизменна', start: 0.6, end: 1 },
        ],
      },
    ],
  };
  const original = structuredClone(source),
    sheet = cueSheet(source);
  assert.deepEqual(source, original, 'resolution leaves the supplied alignment intact');
  assert.equal(sheet.script.segments, source.segments);
  assert.deepEqual(sheet.get('normalize').speech, { start: 10, end: 11.22136 });
  assert.equal(sheet.get('normalize').start, 10.5);
  assert.equal(sheet.get('normalize').end, 19.5);
  assert.equal(sheet.get('normalize').timing, undefined);
  assert.equal(sheet.get('compare').end, 22, 'until targets speech, not the delayed action');
  assert.deepEqual(cueSheet(JSON.parse(JSON.stringify(sheet.script))).script, sheet.script);
  for (const time of [15, 19.5, 9, 10.5, 15]) {
    for (const reduced of [false, true]) {
      const frame = sheet.at(time, reduced),
        expected = Math.max(0, Math.min(1, (time - 10.5) / 9));
      assert.equal(frame.progress('normalize'), expected);
      assert.equal(frame.elapsed('normalize'), Math.max(0, time - 10.5));
      assert.equal(frame.finished('normalize'), time >= 19.5);
      assert.equal(frame.has('normalize'), time >= 10.5);
      assert.equal(frame.reveal('normalize'), reduced ? Number(time >= 10.5) : expected);
      assert.deepEqual(morphTiming(frame, 'normalize'), {
        progress: expected,
        duration: 9,
        reduced,
      });
      assert(
        sheet
          .review()
          .observed.reads.some(
            (r) => r.id === 'normalize' && r.operation === 'progress' && r.value === expected,
          ),
      );
      assert(
        sheet
          .review()
          .observed.reads.some(
            (r) =>
              r.id === 'normalize' &&
              r.operation === 'elapsed' &&
              r.value === Math.max(0, time - 10.5),
          ),
      );
    }
  }
  assert.equal(
    activeCue(source, 10.2),
    undefined,
    'delayed actions do not start at the spoken word',
  );
  assert.equal(activeCue(source, 15).id, 'compare');
  const review = sheet.review().cues.find((c) => c.id === 'normalize');
  assert.equal(review.end - review.start, 9);
  assert.deepEqual(review.speech, { start: 10, end: 11.22136 });
});

test('action windows reject missing, nonfinite, empty and out-of-story timing', () => {
  for (const timing of [
    null,
    {},
    { duration: 0 },
    { duration: -1 },
    { duration: Infinity },
    { duration: 4, delay: -1 },
    { duration: 4, delay: NaN },
    { duration: 4, until: 'next' },
    { until: 'missing' },
    { until: 'move' },
    { until: '' },
    { until: 'next', delay: 3 },
    { duration: 100 },
    { duration: 4, typo: true },
  ]) {
    assert.throws(
      () =>
        cueSheet({
          duration: 10,
          cues: {
            move: { start: 2, end: 2.5, timing },
            next: { start: 4, end: 5 },
          },
        }),
      /timing|Invalid cue/,
      JSON.stringify(timing),
    );
  }
});

test('chapter and document projections retain both action and speech coordinates', () => {
  const local = {
    duration: 10,
    cues: {
      move: { start: 1, end: 1.5, timing: { duration: 4 } },
      stop: { start: 8, end: 9 },
    },
  };
  const composed = composeChapters([
    { id: 'lesson', title: 'Lesson', text: 'Lesson', seconds: 20, script: local },
  ]);
  assert.deepEqual(composed.script.cues['lesson.move'], {
    start: 2,
    end: 10,
    speech: { start: 2, end: 3 },
  });
  const aligned = {
    duration: 20,
    cues: {
      'lesson.move': { start: 2, end: 3, timing: { duration: 7 } },
    },
    segments: [{ id: 'lesson', start: 1, end: 15, text: 'Двигаем фигуру.' }],
  };
  const result = documentScript(
    {
      title: 'Lesson',
      chapters: [
        {
          id: 'lesson',
          title: 'Lesson',
          beats: [{ id: 'move', text: 'Двигаем фигуру', say: 'Двигаем фигуру.' }],
        },
      ],
    },
    aligned,
  );
  assert.deepEqual(result.cues['lesson.move'], { start: 2, end: 9, speech: { start: 2, end: 3 } });
  assert.equal(result.segments, aligned.segments);
  assert.deepEqual(aligned.cues['lesson.move'].timing, { duration: 7 });
});
