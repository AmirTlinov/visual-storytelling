import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { reviewScene } from '../tools/review.mjs';

test('rendered review detects a frozen operation and unused cue, permits a reading hold', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-review-'));
  const out = join(directory, 'review');
  try {
    await build({
      stdin: {
        resolveDir: resolve('.'),
        contents: `import { cueSheet } from './dist/story/cues.js';
          const sheet = cueSheet({duration: 4, cues: {
            frozen: {start: 0, end: 1, action: 'Move the circle', text: '<em>copy</em>'},
            missing: {start: 1, end: 2, action: 'Reveal the result'},
            read: {start: 2, end: 3, hold: 'Compare the values'},
            unassigned: {start: 3, end: 4},
          }});
          window.explainer = { duration: 4, pause() {},
            seek(t) { sheet.at(t).progress('frozen'); }, review: sheet.review };
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
    assert.equal(report.cues.at(-1).frames.at(-1).time, 4);
    const html = await readFile(result.path, 'utf8');
    assert(html.includes('&lt;em&gt;copy&lt;/em&gt;'));
    assert(html.includes('<dialog'));
    assert(!html.includes('<em>copy</em>'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
