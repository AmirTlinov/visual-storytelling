import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitFrame, inspectPresentation } from '../dist/scene-frame.js';
import { SvgLayout } from '../dist/layout/svg.js';
import { summarizeRuntime } from '../tools/motion/runtime.mjs';

test('a logical frame fits the constrained axis without changing its aspect ratio', () => {
  assert.deepEqual(fitFrame(1280, 720, 360, 580), { width: 360, height: 202.5, scale: 0.28125 });
  assert.deepEqual(fitFrame(400, 800, 900, 300), { width: 150, height: 300, scale: 0.375 });
});

test('SVG layout stays in logical units while its enclosing film frame changes screen scale', async () => {
  const saved = { document: globalThis.document, ResizeObserver: globalThis.ResizeObserver };
  let observe,
    disconnected = false,
    removed = false;
  globalThis.document = {
    fonts: {
      ready: Promise.resolve(),
      addEventListener() {},
      removeEventListener() {
        removed = true;
      },
    },
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      observe = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  const attributes = {},
    widths = [];
  const svg = {
    clientWidth: 800,
    style: {},
    setAttribute(key, value) {
      attributes[key] = value;
    },
    getBoundingClientRect() {
      return { width: 400 };
    },
  };
  try {
    const layout = await SvgLayout.observe(svg, (width) => {
      widths.push(width);
      return 600;
    });
    assert.deepEqual(widths, [800]);
    assert.equal(attributes.viewBox, '0 0 800 600');
    svg.getBoundingClientRect = () => ({ width: 200 });
    observe();
    assert.deepEqual(widths, [800], 'an outer camera scale must not relayout drawing coordinates');
    svg.clientWidth = 640;
    observe();
    assert.deepEqual(widths, [800, 640]);
    layout.dispose();
    assert.equal(disconnected && removed, true);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('visual review reports inspectable artwork clipping even when the canvas itself fits', () => {
  const clipped = {
    id: 'actor:tesla',
    bounds: { x: -20, y: 0, width: 100, height: 120 },
    clip: { x: 0, y: 0, width: 800, height: 600 },
  };
  const telemetry = {
    elements: [],
    raf: [],
    events: [],
    messages: [],
    longFrames: [],
    scene: [
      { time: 1, presentation: { outsideViewport: false, clipped: [clipped] } },
      { time: 2, presentation: { outsideViewport: false, clipped: [clipped] } },
    ],
  };
  const report = summarizeRuntime(telemetry, { width: 800, height: 600 });
  assert.equal(report.insights.length, 1);
  assert.equal(report.insights[0].kind, 'content-clipped');
  assert.equal(report.insights[0].target, 'actor:tesla');
  assert.deepEqual(report.insights[0].bounds, clipped.bounds);
  assert.deepEqual(report.insights[0].clip, clipped.clip);
});

test('intentional background geometry stays inspectable without being reported as cropped content', () => {
  const globals = ['innerWidth', 'innerHeight', 'HTMLCanvasElement', 'getComputedStyle'];
  const saved = Object.fromEntries(globals.map((key) => [key, globalThis[key]]));
  const bounds = { x: 0, y: 0, width: 800, height: 600, right: 800, bottom: 600 };
  const objects = ['background', 'subject'].map((framing) => ({
    id: framing,
    x: -20,
    y: 0,
    width: 100,
    height: 120,
    visible: true,
    data: { framing },
  }));
  const stage = {
    parentElement: null,
    closest: () => null,
    getBoundingClientRect: () => bounds,
    checkVisibility: () => true,
    querySelectorAll: () => [canvas],
  };
  class Canvas {
    parentElement = stage;
    dataset = { reviewId: 'canvas' };
    closest = () => null;
    getBoundingClientRect = () => bounds;
    checkVisibility = () => true;
    __visualReview = () => ({ objects });
  }
  const canvas = new Canvas();
  Object.assign(globalThis, {
    innerWidth: 800,
    innerHeight: 600,
    HTMLCanvasElement: Canvas,
    getComputedStyle: () => ({ overflowX: 'hidden', overflowY: 'hidden' }),
  });
  try {
    const report = inspectPresentation(stage);
    assert.deepEqual(
      report.clipped.map((object) => object.id),
      ['subject'],
    );
    assert.equal(report.uninspectedCanvases, 0);
    assert.equal(
      canvas.__visualReview().objects.length,
      2,
      'background geometry remains in motion telemetry',
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
