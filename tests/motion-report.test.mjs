import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment } from 'parse5';
import { orderedInsights, reviewFocus } from '../tools/motion/focus.mjs';
import { observationsMarkup } from '../tools/motion/diagnostics.mjs';
import { motionMarkup } from '../tools/motion/report-view.mjs';

const image = 'data:image/png;base64,iVBORw0KGgo=';
const report = (overrides = {}) => ({
  title: 'A short transition',
  frames: [
    { time: 1, image },
    { time: 1.1, image },
  ],
  intervals: [{ from: 0, to: 1, dtMs: 100, changedPercent: 5, duplicate: false }],
  width: 80,
  height: 40,
  scale: 1,
  threshold: 8,
  motionBounds: { x: 0, y: 0, width: 80, height: 40 },
  overlay: image,
  difference: image,
  source: { kind: 'scene-seek' },
  ...overrides,
});
const timeline = (signals) => ({ frames: 100, from: 0, to: 3, intervals: [], signals });
const runtime = (insights, warning) => ({
  insights,
  warning,
  mainThreadIntervalMs: { p95: 16.7, max: 120 },
  longFrameCount: 1,
  maxInteractionMs: null,
  trajectories: [],
});
const reversals = [0.1, 0.2, 0.3, 0.4, 2.75].map((time, frame) => ({
  kind: 'brief-reversal',
  time,
  frame,
  detail: frame === 4 ? 'Independent flash after the periodic sequence' : 'Repeated pulse',
}));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function nodes(html) {
  const result = [];
  const visit = (node) => {
    result.push(node);
    node.childNodes?.forEach(visit);
  };
  visit(parseFragment(html));
  return result;
}
const attribute = (node, name) => node.attrs?.find((entry) => entry.name === name)?.value;
const textContent = (node) => node.value ?? node.childNodes?.map(textContent).join('') ?? '';

test('a scenario failure stays first outside the detail window, with partial-capture limits', () => {
  const value = report({
    source: { kind: 'browser-capture', sparse: true, warning: 'Capture stopped early' },
    runtime: runtime(
      [
        { kind: 'page-error', time: 1.02, detail: 'Rendering failed' },
        { kind: 'long-animation-frame', time: 1.03, durationMs: 120 },
        { kind: 'action-error', time: 2, detail: 'Target detached during click' },
      ],
      'DOM clock has no pixel-time alignment',
    ),
    timeline: timeline([{ kind: 'brief-reversal', time: 1.04, detail: 'A short flash' }]),
    comparison: { warning: 'Different viewport sizes' },
  });
  const focus = reviewFocus(value);
  assert.equal(orderedInsights(value)[0].kind, 'action-error');
  assert.equal(focus.items[0].kind, 'action-error');
  assert.equal(focus.items[0].time, 2);
  assert.match(focus.items[0].detail, /Target detached/);
  assert(focus.items.some((item) => item.kind === 'capture-warning'));
  assert.equal(focus.items.length, 3);
  assert.equal(focus.additionalCount, 4);
  assert.match(focus.coverage, /CDP/);
  assert.match(motionMarkup(value), /вне выбранного окна/);
});

test('regional periodicity does not remove frame-return evidence, including a separate flash', () => {
  const value = freeze(
    report({
      frames: [
        { time: 2.7, image },
        { time: 2.8, image },
      ],
      timeline: timeline(reversals),
      photometry: {
        status: 'available',
        spectrum: { status: 'available', frequencyHz: 10, binSpacingHz: 1, region: 'cell 2' },
      },
    }),
  );
  const before = JSON.stringify(value);
  const focus = reviewFocus(value);
  assert(focus.items.some((item) => item.kind === 'brightness-periodicity'));
  const returns = focus.items.find((item) => item.kind === 'repeated-appearance-return');
  assert(returns, 'brightness periodicity must not explain away all frame returns');
  assert.equal(returns.count, reversals.length);
  assert.equal(returns.time, 2.75, 'the selected independent flash must remain discoverable');
  const raw = nodes(observationsMarkup(value))
    .filter((node) => node.tagName === 'pre')
    .map((node) => JSON.parse(textContent(node)));
  assert.deepEqual(raw, reversals, 'the full list must retain every original time and field');
  assert.equal(JSON.stringify(value), before);
});

test('focus links and CLI views name existing sections, including skipped photometry', () => {
  for (const photometry of [undefined, { status: 'skipped', reason: 'Only two frames' }]) {
    const value = report({ timeline: timeline(reversals), photometry });
    const focus = reviewFocus(value);
    assert.equal(focus.items[0].view, 'frames');
    const all = nodes(motionMarkup(value));
    const ids = new Set(all.map((node) => attribute(node, 'id')).filter(Boolean));
    for (const item of focus.items) assert(ids.has(`motion-${item.view}`));
    for (const node of all.filter((entry) => attribute(entry, 'data-motion-section') !== undefined))
      assert(ids.has(attribute(node, 'href').slice(1)), 'every overview link must resolve');
  }
});

test('compact details mark truncation while complete observations preserve the diagnostic', () => {
  const detail = `Click failed:\n${'visible input context '.repeat(20)}\nFINAL DIAGNOSTIC`;
  const value = report({ runtime: runtime([{ kind: 'action-error', detail }]) });
  const shown = reviewFocus(value).items[0].detail;
  assert(shown.length <= 200);
  assert(shown.endsWith('…'));
  assert(!shown.includes('\n'));
  assert.equal(
    JSON.parse(textContent(nodes(observationsMarkup(value)).find((node) => node.tagName === 'pre')))
      .detail,
    detail,
  );
});

test('grouped durations show the full range while retaining the representative time and target', () => {
  const insights = [
    { kind: 'brief-disappearance', target: '#badge', time: 1.02, durationMs: 19.3 },
    { kind: 'brief-disappearance', target: '#badge', time: 2, durationMs: 34.2 },
    { kind: 'long-animation-frame', time: 1.04, durationMs: 71 },
    { kind: 'long-animation-frame', time: 0.5, durationMs: 125 },
    { kind: 'brief-disappearance', target: '#other', time: 1.03, durationMs: 20 },
  ];
  const before = structuredClone(insights);
  const items = reviewFocus(report({ runtime: runtime(insights) })).items;
  const badge = items.find((item) => item.target === '#badge');
  assert.match(badge.detail, /^19\.3–34\.2 мс/);
  assert.equal(badge.time, 1.02);
  assert.equal(badge.count, 2);
  const long = items.find((item) => item.kind === 'long-animation-frame');
  assert.match(long.detail, /^71\.0–125\.0 мс/);
  assert.equal(long.time, 1.04);
  assert.equal(long.count, 2);
  const other = items.find((item) => item.target === '#other');
  assert.match(other.detail, /^20\.0 мс/);
  assert.equal(other.count, 1);
  assert.deepEqual(insights, before);
});

test('short or unchanged model-time reports do not imply a smoothness pass', () => {
  const short = report();
  assert.deepEqual(reviewFocus(short).items, []);
  assert.match(reviewFocus(short).coverage, /Время модели/);
  const shortNodes = nodes(motionMarkup(short));
  const empty = shortNodes.find((node) => attribute(node, 'class') === 'motion-focus-empty');
  assert.match(textContent(empty), /Автосигналов для выделения нет/);
  assert.match(textContent(empty), /Сопоставьте наложение и кадры/);
  const unchanged = report({ motionBounds: null });
  assert.equal(reviewFocus(unchanged).items[0].kind, 'unchanged-window');
  assert.match(reviewFocus(unchanged).items[0].detail, /время действия/);
});

test('embedded cue reports keep independent anchors without duplicating their frame strips', () => {
  const unsaved = nodes(motionMarkup(report()));
  assert(!unsaved.some((node) => attribute(node, 'href')?.endsWith('/motion.json')));
  const saved = report();
  saved.frames = saved.frames.map((frame, i) => ({ ...frame, file: `analysis/${i}.png` }));
  const html = [0, 1]
    .map((i) =>
      motionMarkup(saved, {
        includeFrames: false,
        idPrefix: `cue-motion-${i}`,
        artifactBase: `motion-00${i + 1}`,
      }),
    )
    .join('');
  const all = nodes(html);
  const ids = all.map((node) => attribute(node, 'id')).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  assert(!all.some((node) => attribute(node, 'class') === 'motion-strip'));
  assert.deepEqual(
    all
      .filter((node) => node.tagName === 'a')
      .map((node) => attribute(node, 'href'))
      .filter((href) => href && !href.startsWith('#')),
    [
      'motion-001/motion.json',
      'motion-001/frames.png',
      'motion-002/motion.json',
      'motion-002/frames.png',
    ],
  );
  for (const node of all.filter((entry) => attribute(entry, 'data-motion-section') !== undefined)) {
    const hash = attribute(node, 'href').slice(1);
    assert(ids.includes(hash));
    assert.match(hash, /^cue-motion-[01]-(frames|method)$/);
  }
});
