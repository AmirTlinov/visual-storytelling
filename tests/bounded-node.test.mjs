import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('bounded nodes retain complete centered ink, readable size and body-owned connections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-node-'));
  let browser;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          import { surface } from './src/ink/surface.ts';
          import { loadFonts } from './src/ink/fonts.ts';
          import { node } from './src/recipes/node.ts';
          import { SvgLayout } from './src/layout/svg.ts';
          import './dist/style.css';
          window.ready = loadFonts().then(() => {
            const drawing = surface(document.querySelector('main'), { id:'nodes', width:600, height:400, title:'Nodes', description:'Bounded labels', grid:false });
            const first = node(drawing, 'first', 0.858, { format:v=>String(v).replace('.', ',') });
            const second = node(drawing, 'second', '42', { shape:'rect', width:80, height:56 });
            first.at(100,100); second.at(300,100);
            window.lab = { drawing, first, second, SvgLayout };
          });`,
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'index.js'),
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><link rel="stylesheet" href="index.css"><main></main><script src="index.js"></script>',
    );
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(directory, 'index.html')).href);
    await page.evaluate(() => window.ready);
    const result = await page.evaluate(() => {
      const { drawing, first, second, SvgLayout } = lab;
      // Inspect painted geometry rather than trusting the recipe's fit measurements.
      const ink = (node, ellipse) => {
        let left = Infinity,
          top = Infinity,
          right = -Infinity,
          bottom = -Infinity;
        let contained = true;
        for (const path of node.label.element.querySelectorAll('path')) {
          const matrix = node.content.getCTM().inverse().multiply(path.getCTM());
          const b = path.getBBox(),
            pad = Number(path.getAttribute('stroke-width')) / 2;
          for (const x of [b.x - pad, b.x + b.width + pad])
            for (const y of [b.y - pad, b.y + b.height + pad]) {
              const p = new DOMPoint(x, y).matrixTransform(matrix);
              left = Math.min(left, p.x);
              top = Math.min(top, p.y);
              right = Math.max(right, p.x);
              bottom = Math.max(bottom, p.y);
              const rx = Math.abs(p.x) / (node.width / 2 - 6),
                ry = Math.abs(p.y) / (node.height / 2 - 6);
              contained &&= (ellipse ? Math.hypot(rx, ry) : Math.max(rx, ry)) <= 1.00001;
            }
        }
        return {
          contained,
          centered: Math.abs(left + right) < 0.15 && Math.abs(top + bottom) < 0.15,
        };
      };
      const firstElement = first.element,
        labelElement = first.label.element;
      const visibleInk = (node) =>
        JSON.stringify(
          [...node.label.element.querySelectorAll('path,circle')]
            .filter((path) => {
              const style = getComputedStyle(path);
              return style.visibility !== 'hidden' && style.display !== 'none';
            })
            .map((path) => {
              const m = node.content.getCTM().inverse().multiply(path.getCTM());
              return [
                path.getAttribute('d'),
                path.getAttribute('cx'),
                path.getAttribute('cy'),
                path.getAttribute('r'),
                path.style.strokeDasharray,
                path.style.strokeDashoffset,
                ...[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => Math.round(v * 1e5) / 1e5),
              ];
            }),
        );
      const original = visibleInk(first);
      const initial = ink(first, true);
      const sizeStable = first.width === 64 && first.height === 64;
      first.reveal(0.45);
      const half = visibleInk(first);
      first.reveal(1);
      first.reveal(0);
      first.reveal(0.45);
      const seekRestores = visibleInk(first) === half;
      first.reveal(1);
      const values = [];
      for (const value of [1, -0.858, 0.01, 0.858]) {
        first.value(value);
        values.push(ink(first, true));
      }
      const identities = first.element === firstElement && first.label.element === labelElement;
      const restored = visibleInk(first) === original;
      first.show(false);
      first.value(0.751);
      first.value(0.858);
      first.show(true);
      const hidden = ink(first, true);
      second.text('длинная подпись');
      const expanded = second.width > 80 && second.height === 56;
      const rect = ink(second, false);
      const textElement = second.label.element.querySelector('text');
      const fontSize =
        Number(textElement.getAttribute('font-size')) *
        second.label.element.firstElementChild.transform.baseVal.consolidate().matrix.a;
      const labelKept = second.label.element.getAttribute('aria-label') === 'длинная подпись';
      const route = SvgLayout.connect(first.shape, second.shape, {
        fromShape: 'ellipse',
        space: drawing.layer,
        gap: 0,
      });
      const connection = Math.abs(route.start.y - 100) < 1 && Math.abs(route.start.x - 132) < 2;
      first.at(100, 150, 90);
      first.move(3, 0);
      const anchors = first.anchors;
      const anchorPlacement =
        Math.abs(anchors.center.x - 100) < 1e-5 &&
        Math.abs(anchors.center.y - 153) < 1e-5 &&
        Math.abs(anchors.right.y - 185) < 1e-5;
      const observer = new MutationObserver(() => {});
      observer.observe(first.element, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
      for (let i = 0; i < 20; i++) first.value(0.858);
      const repeatedMutations = observer.takeRecords().length;
      observer.disconnect();
      const line = drawing.pen.line(drawing.layer, 'offset-line', [100, 100], [160, 100]);
      line.reveal(1);
      const whole = line.element.getBBox();
      line.reveal(0.5);
      line.update('M200 150L260 150');
      line.reveal(1);
      const moved = line.element.getBBox();
      const tipsLeaveBounds = whole.x > 98 && whole.y > 98 && moved.x > 198 && moved.y > 148;
      const referenceHidden = first.label.element.querySelector('text').style.display === 'none';
      const paintedBounds = first.label.element.getBBox();
      const nativeExcluded = paintedBounds.height < first.label.bounds.height + 0.1;
      second.content.setAttribute('transform', 'translate(17 21) scale(.75)');
      SvgLayout.along(
        second.label.element,
        { start: { x: 100, y: 250 }, end: { x: 300, y: 250 } },
        {
          space: drawing.layer,
          offset: 30,
          avoid: [first.element],
        },
      );
      const placed = SvgLayout.box(second.label.element, drawing.layer);
      const obstacle = SvgLayout.box(first.element, drawing.layer);
      const sharedSpace = Math.abs(placed.cx - 200) < 0.001 && Math.abs(placed.cy - 280) < 0.001;
      const avoided =
        placed.x + placed.width <= obstacle.x ||
        placed.x >= obstacle.x + obstacle.width ||
        placed.y + placed.height <= obstacle.y ||
        placed.y >= obstacle.y + obstacle.height;
      SvgLayout.along(
        second.label.element,
        { start: { x: 200, y: 200 }, end: { x: 200, y: 300 } },
        {
          space: drawing.layer,
          offset: 4,
          avoid: [{ start: { x: 100, y: 250 }, end: { x: 300, y: 250 } }],
        },
      );
      const clear = SvgLayout.box(second.label.element, drawing.layer);
      const routeClearance =
        (clear.x + clear.width <= 196 || clear.x >= 204) &&
        (clear.y + clear.height <= 246 || clear.y >= 254);
      drawing.dispose();
      first.dispose();
      return {
        initial,
        sizeStable,
        values,
        identities,
        restored,
        seekRestores,
        hidden,
        expanded,
        rect,
        fontSize,
        labelKept,
        connection,
        anchorPlacement,
        repeatedMutations,
        tipsLeaveBounds,
        referenceHidden,
        nativeExcluded,
        sharedSpace,
        avoided,
        routeClearance,
        disposed: !first.element.isConnected && !second.element.isConnected,
      };
    });
    for (const state of [result.initial, ...result.values, result.hidden, result.rect]) {
      assert.equal(state.contained, true, 'all actual ink stays within the padded body');
      assert.equal(state.centered, true, 'actual ink remains centered after a value change');
    }
    assert.ok(result.fontSize >= 16 - 1e-6, 'long labels preserve minimum readable size');
    assert.equal(result.repeatedMutations, 0);
    for (const key of [
      'sizeStable',
      'identities',
      'restored',
      'seekRestores',
      'expanded',
      'labelKept',
      'connection',
      'anchorPlacement',
      'disposed',
      'tipsLeaveBounds',
      'referenceHidden',
      'nativeExcluded',
      'sharedSpace',
      'avoided',
      'routeClearance',
    ])
      assert.equal(result[key], true, key);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
