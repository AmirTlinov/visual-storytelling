import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { captionTrack } from '../dist/story/captions.js';

const chapter = (text, tokens = text.match(/[\p{L}\p{N}]+/gu)) => ({
  id: 'speech',
  start: 1,
  end: 1 + tokens.length * 0.5,
  text,
  words: tokens.map((text, i) => ({ text, start: 1 + i * 0.5, end: 1.4 + i * 0.5 })),
});

test('aliases merge aligned spoken spans before grouping, retaining punctuation and export times', () => {
  const segment = chapter('«Пэ дэ эф», двадцать три; пэ дэ эф.');
  const source = structuredClone(segment);
  const track = captionTrack(
    {
      captionAliases: { пэ: 'П', 'пэ дэ эф': 'PDF', 'двадцать три': '23' },
      segments: [segment],
    },
    { maxChars: 7, maxSeconds: 0.2 },
  );
  assert.deepEqual(track.segments, [
    { start: 1, end: 2.4, text: '«PDF»,' },
    { start: 2.5, end: 3.4, text: '23;' },
    { start: 3.5, end: 4.9, text: 'PDF.' },
  ]);
  assert.equal(track.at(2.3), '«PDF»,');
  assert.equal(track.at(2.45), '');
  assert.match(track.serialize('srt'), /00:00:01,000 --> 00:00:02,400\n«PDF»,/);
  assert.match(track.serialize('vtt'), /00:00:03\.500 --> 00:00:04\.900\nPDF\./);
  assert.deepEqual(segment, source);
  // The shortened display phrase and its neighbour fit in one caption.
  assert.equal(
    captionTrack(
      {
        captionAliases: { 'двадцать три': '23' },
        segments: [chapter('Двадцать три страницы.')],
      },
      { maxChars: 12 },
    ).at(1),
    '23 страницы.',
  );
});

test('longest matches win left-to-right regardless of map order and replacements are not recursive', () => {
  const aliases = { 'а б': 'X', 'б а': 'Y', 'а б а': 'Z' };
  for (const captionAliases of [aliases, Object.fromEntries(Object.entries(aliases).reverse())]) {
    assert.equal(captionTrack({ captionAliases, segments: [chapter('А б а б а.')] }).at(1), 'Z Y.');
  }
  assert.equal(
    captionTrack({
      captionAliases: { один: 'два', два: '2' },
      segments: [chapter('Один два один.')],
    }).at(1),
    'два 2 два.',
  );
});

test('aliases keep whole-word boundaries, spelling variants and aligner splits honest', () => {
  assert.equal(
    captionTrack({
      captionAliases: { пэдээф: 'PDF', еще: 'ещё' },
      segments: [chapter('Пэдээфка и пэдээф — ещё.')],
    }).at(1),
    'Пэдээфка и PDF — ещё.',
  );
  assert.equal(
    captionTrack({
      captionAliases: { пэдээф: 'PDF' },
      segments: [chapter('Пэдээф.', ['Пэ', 'дэ', 'эф'])],
    }).at(1),
    'PDF.',
  );
  assert.equal(
    captionTrack({
      captionAliases: { 'пэ дэ эф': 'PDF' },
      segments: [chapter('Пэ, дэ эф.')],
    }).at(1),
    'Пэ, дэ эф.',
  );
  assert.throws(
    () =>
      captionTrack({
        captionAliases: { двадцать: '20' },
        segments: [chapter('Двадцать три.', ['Двадцатьтри'])],
      }),
    /complete aligned words/,
  );
});

test('chapter captions without word alignment retain their one interval', () => {
  const segment = { id: 'silent', start: 2, end: 7, text: 'Пэ   дэ эф: двадцать три. Пэ дэ эф.' };
  assert.deepEqual(
    captionTrack(
      {
        captionAliases: { 'пэ дэ эф': 'PDF', 'двадцать три': '23' },
        segments: [segment],
      },
      { maxChars: 3 },
    ).segments,
    [{ start: 2, end: 7, text: 'PDF: 23. PDF.' }],
  );
});

test('caption alias pairs reject empty, marked-up and ambiguous normalized keys', () => {
  for (const captionAliases of [
    null,
    [],
    { '': 'PDF' },
    { пэ: '' },
    { пэ: 2 },
    { пэ: '<b>PDF</b>' },
    { пэ: 'P\nDF' },
  ]) {
    assert.throws(() => captionTrack({ captionAliases, segments: [] }), /captionAliases/);
  }
  assert.throws(
    () =>
      captionTrack({
        captionAliases: { Ещё: 'more', 'ещё ': 'again' },
        segments: [],
      }),
    /Duplicate captionAliases/,
  );
});

test('SceneShell uses the same display aliases for visible and accessible chapter captions', async () => {
  const phrase = 'Вычислим, насколько каждая связь влияет на общий промах в пэ дэ эф.';
  const words = phrase.match(/[\p{L}\p{N}]+/gu).map((text, i) => ({
    text,
    start: 4 + i * 0.22,
    end: 4.18 + i * 0.22,
  }));
  const script = {
    duration: 10,
    cues: {},
    captionAliases: { 'пэ дэ эф': 'PDF' },
    segments: [chapter('Пэ дэ эф.'), { id: 'two-lines', start: 4, end: 8.5, text: phrase, words }],
  };
  const wrapped = captionTrack(script).at(4.1);
  assert.equal(wrapped.split('\n').length, 2);
  const bundle = await build({
    stdin: {
      contents: `import { SceneShell } from './dist/scene.js'; import './dist/style.css';
        window.mount = captions => {
          const shell = SceneShell.mount(document.querySelector('main'), {title:'Example', captions});
          shell.attachStory({script:${JSON.stringify(script)},stateAt:()=>({}),render(){}});
        };`,
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    outdir: '.',
    platform: 'browser',
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [captions, width] of [
      [true, 1280],
      [true, 375],
      [undefined, 375],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 812 } });
      await page.setContent('<body class="ve-standalone"><main class="ve-scene"></main></body>');
      await page.addStyleTag({
        content: bundle.outputFiles.find((f) => f.path.endsWith('.css')).text,
      });
      await page.addScriptTag({
        content: bundle.outputFiles.find((f) => f.path.endsWith('.js')).text,
      });
      await page.evaluate((value) => {
        window.mount(value);
        document.querySelector('main').scene.seek(1.1);
      }, captions);
      assert.equal(await page.locator('[data-caption]').textContent(), 'PDF.');
      await page.evaluate(() => {
        document.querySelector('main').scene.seek(4.1);
        return document.fonts.ready;
      });
      assert.equal(await page.locator('[data-caption]').textContent(), wrapped);
      assert.equal(await page.locator('[data-caption]').getAttribute('role'), 'status');
      if (captions) {
        const box = await page.locator('[data-caption]').evaluate((el) => {
          const wordsPerLine = {};
          for (const word of el.textContent.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(el.firstChild, word.index);
            range.setEnd(el.firstChild, word.index + word[0].length);
            const top = range.getBoundingClientRect().top;
            wordsPerLine[top] = (wordsPerLine[top] ?? 0) + 1;
          }
          return {
            height: el.getBoundingClientRect().height,
            lineHeight: parseFloat(getComputedStyle(el).lineHeight),
            scale: Number(el.closest('[data-scene-frame]').dataset.frameScale),
            whiteSpace: getComputedStyle(el).whiteSpace,
            wordsPerLine: Object.values(wordsPerLine),
            overflows: el.scrollWidth > el.clientWidth,
            top: el.getBoundingClientRect().top,
            bottom: el.getBoundingClientRect().bottom,
            controlsTop: document.querySelector('[data-player]').getBoundingClientRect().top,
            controlsBottom: document.querySelector('[data-player]').getBoundingClientRect().bottom,
          };
        });
        assert.equal(box.whiteSpace, width === 375 ? 'normal' : 'pre-line');
        assert.equal(box.overflows, false);
        assert.ok(
          box.wordsPerLine.every((count) => count > 1),
          JSON.stringify(box.wordsPerLine),
        );
        const rows = box.height / (box.lineHeight * box.scale);
        assert.ok(
          rows >= 2 - 0.01 && rows <= (width === 375 ? 3 : 2) + 0.01,
          JSON.stringify({ width, ...box }),
        );
        assert.ok(
          box.bottom <= box.controlsTop && box.controlsBottom <= 812,
          JSON.stringify({ width, ...box }),
        );
      }
      await page.evaluate(() => document.querySelector('main').scene.seek(1.1));
      assert.equal(await page.locator('[data-caption]').textContent(), 'PDF.');
      await page.evaluate(() => document.querySelector('main').scene.seek(0));
      assert.equal(await page.locator('[data-caption]').textContent(), '');
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
