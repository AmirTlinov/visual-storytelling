import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('unchanged SVG state is quiet; text, geometry, grid and reverse seek still update', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-ink-'));
  let browser;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          import { SceneShell, surface, lettering } from './dist/index.js';
          import './dist/style.css';
          window.galleryReady = SceneShell.ready().then(() => {
            const drawing = surface(document.querySelector('main'), {id:'sample',width:360,height:440,title:'Ink',description:'Update a label and a shape',grid:{step:20}});
            const label = lettering(drawing.layer, '1/3', {x:60,y:50,anchor:'middle'});
            const empty = lettering(drawing.layer, '');
            const mark = drawing.pen.path(drawing.layer, 'line', 'M10 100 H110');
            window.lab = {drawing, label, empty, mark};
          });`,
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'index.js'),
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="index.css"></head><body><main></main><script src="index.js"></script></body></html>',
    );
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(directory, 'index.html')).href);
    await page.evaluate(() => window.galleryReady);
    const result = await page.evaluate(() => {
      const { drawing, label, empty, mark } = lab;
      const inkState = (group) =>
        JSON.stringify(
          [...group.querySelectorAll('path,circle')].map((node) => {
            const style = getComputedStyle(node);
            return style.visibility === 'hidden'
              ? null
              : [
                  node.getAttribute('d'),
                  node.getAttribute('cx'),
                  node.getAttribute('cy'),
                  style.strokeDasharray,
                  style.strokeDashoffset,
                ];
          }),
        );
      const grid = () => drawing.element.querySelector('.vs-grid').innerHTML;
      const originalGrid = grid();
      label.write(0.5);
      mark.reveal(0.5);
      const observer = new MutationObserver(() => {});
      observer.observe(drawing.element, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
      for (let i = 0; i < 60; i++) {
        drawing.resize(360, 440, { step: 20 });
        label.text('1/3');
        label.at(60, 50);
        label.write(0.5);
        empty.text('');
        empty.write(1);
        mark.reveal(0.5);
      }
      const repeatedMutations = observer.takeRecords().length;
      observer.disconnect();
      const half = inkState(label.element);
      label.write(1);
      label.write(0);
      label.write(0.5);
      const reverseRestores = inkState(label.element) === half;
      label.text('1/8');
      const newText = inkState(label.element);
      label.write(0);
      label.write(0.5);
      const textRestores =
        inkState(label.element) === newText && label.element.getAttribute('aria-label') === '1/8';
      const before = inkState(mark.element);
      mark.update('M10 100 H210');
      mark.reveal(0.5);
      const geometryChanged = inkState(mark.element) !== before;
      const changed = inkState(mark.element);
      mark.reveal(1);
      mark.reveal(0.5);
      const geometryRestores = inkState(mark.element) === changed;
      drawing.grid({ step: 40, x: 5 });
      const gridChanged = grid() !== originalGrid;
      drawing.resize(360, 440, { step: 20 });
      const gridRestores = grid() === originalGrid;
      drawing.resize(400, 500, { step: 20 });
      const resized =
        drawing.element.getAttribute('viewBox') === '0 0 400 500' && grid() !== originalGrid;
      drawing.grid(false);
      const gridHidden = grid() === '';
      drawing.resize(360, 440, { step: 20 });
      return {
        repeatedMutations,
        reverseRestores,
        textRestores,
        geometryChanged,
        geometryRestores,
        gridChanged,
        gridRestores,
        resized,
        gridHidden,
        gridReturns: grid() === originalGrid,
      };
    });
    assert.equal(result.repeatedMutations, 0);
    for (const [key, value] of Object.entries(result))
      if (key !== 'repeatedMutations') assert.equal(value, true, key);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
