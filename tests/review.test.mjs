import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { reviewScene, unmarkedIntervals } from '../tools/review.mjs';
import { renderer } from '../tools/render.mjs';

test('rendered review detects a frozen operation and unused cue, permits a reading hold', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-review-'));
  const out = join(directory, 'review');
  try {
    await build({
      stdin: {
        resolveDir: resolve('.'),
        contents: `import { cueSheet } from './dist/story/cues.js';
          console.warn('Line geometry has too few points');
          const sheet = cueSheet({duration: 5, segments:[{id:'lesson',start:0,end:5,text:'Explain each change'}], cues: {
            frozen: {start: 0, end: 1, action: 'Move the circle', text: '<em>copy</em>'},
            missing: {start: 1, end: 2, action: 'Reveal the result'},
            read: {start: 2, end: 3, hold: 'Compare the values'},
            unassigned: {start: 3, end: 4},
            move: {start: 4, end: 5, action: 'Move the circle to its destination'},
          }});
          const circle = document.querySelector('circle');
          window.explainer = {duration: 5};
          document.querySelector('.ve-scene').scene = {
            seek(t) {
              const frame = sheet.at(t);
              frame.progress('frozen');
              if (t < 1) circle.dataset.layoutError = 'No readable space for label';
              else delete circle.dataset.layoutError;
              circle.setAttribute('cx', 50 + 30 * frame.progress('move'));
            },
            snapshot: () => ({x: circle.cx.baseVal.value}),
            review: sheet.review,
          };
        `,
      },
      outfile: join(directory, 'index.js'),
      bundle: true,
      format: 'iife',
    });
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html><body>
      <main class="ve-scene"><svg width="100" height="100"><circle cx="50" cy="50" r="20"/></svg></main>
      <script src="index.js"></script></body></html>`,
    );
    const result = await reviewScene({ directory, out, width: 375 });
    const report = JSON.parse(await readFile(join(out, 'review.json'), 'utf8'));
    assert(
      result.warnings.some(
        (warning) => warning.startsWith('frozen:') && warning.includes('кадры одинаковы'),
      ),
    );
    assert(
      result.warnings.some(
        (warning) => warning.startsWith('missing:') && warning.includes('не обращался'),
      ),
    );
    assert(
      result.warnings.some(
        (warning) => warning.startsWith('unassigned:') && warning.includes('опишите'),
      ),
    );
    assert(!result.warnings.some((warning) => warning.startsWith('read:')));
    assert.equal(report.cues[0].frames[0].time, 0);
    assert.deepEqual(report.cues[0].frames[0].diagnostics, ['No readable space for label']);
    assert(result.warnings.includes('frozen: No readable space for label'));
    const moving = report.cues.find((cue) => cue.id === 'move');
    assert.equal(moving.unchanged, false);
    assert.equal(moving.frames[0].state.x, 50);
    assert.equal(moving.frames.at(-1).state.x, 80);
    assert.equal(report.cues.at(-1).frames.at(-1).time, 5);
    assert(!result.warnings.some((warning) => warning.startsWith('move:')));
    assert(result.warnings.some((warning) => warning.includes('Line geometry has too few points')));
    assert.equal(
      report.messages.find((message) => message.text.includes('too few points')).time,
      0,
    );
    assert.equal(report.unmarked.length, 1);
    assert.deepEqual([report.unmarked[0].start, report.unmarked[0].end], [3, 4]);
    assert.equal(report.unmarked[0].frames.length, 2);
    const html = await readFile(result.path, 'utf8');
    assert(html.includes('&lt;em&gt;copy&lt;/em&gt;'));
    assert(html.includes('<dialog'));
    assert(!html.includes('<em>copy</em>'));
    await writeFile(
      join(directory, 'index.html'),
      '<main class="ve-scene"><svg></svg></main><script>throw new Error("broken scene setup")</script>',
    );
    await assert.rejects(renderer({ directory, theme: 'light' }), /broken scene setup/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unmarked narration uses the union of overlapping actions and reading holds', () => {
  const report = {
    segments: [{ id: 'chapter', start: 0, end: 10, text: 'An explanation' }],
    cues: [
      { kind: 'chapter', start: 0, end: 10 },
      { kind: 'action', start: 1, end: 3 },
      { kind: 'hold', start: 2, end: 6 },
      { kind: 'action', start: 8, end: 9.5 },
    ],
  };
  assert.deepEqual(
    unmarkedIntervals(report).map(({ start, end }) => [start, end]),
    [
      [0, 1],
      [6, 8],
    ],
  );
});
