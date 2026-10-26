import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';

test('glyph metrics reuse only owned unchanged geometry and honor CSS and attribute updates', async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
 import {SketchMotion} from './dist/ink/motion.js';
 import {glyphs} from './dist/ink/glyphs.js';
 window.motion=SketchMotion; window.glyphs=glyphs;`,
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent('<svg width="400" height="200"></svg>');
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const result = await page.evaluate(() => {
      const root = document.querySelector('svg'),
        ns = root.namespaceURI;
      const native = SVGPathElement.prototype.getTotalLength;
      let reads = 0;
      SVGPathElement.prototype.getTotalLength = function () {
        reads++;
        return native.call(this);
      };
      const makeText = () => {
        const text = document.createElementNS(ns, 'text');
        text.textContent = '1';
        text.style.fontSize = '24px';
        root.append(text);
        motion.write(text, 0.5);
        return text;
      };
      makeText();
      const firstReads = reads;
      const text = makeText(),
        secondReads = reads - firstReads;
      const owned = text.nextElementSibling.querySelector('path');
      owned.style.d = 'path("M0 0L100 0")';
      motion.draw(owned, 0.5);
      const ownedLength = parseFloat(owned.style.strokeDasharray),
        ownedTip = Number(owned.nextElementSibling.getAttribute('cx'));
      const foreign = document.createElementNS(ns, 'path');
      foreign.setAttribute('d', glyphs['1'][0]);
      foreign.style.d = 'path("M0 0L100 0")';
      root.append(foreign);
      motion.draw(foreign, 0.5);
      const foreignLength = parseFloat(foreign.style.strokeDasharray),
        foreignTip = Number(foreign.nextElementSibling.getAttribute('cx'));
      foreign.style.d = 'path("M0 0L200 0")';
      motion.draw(foreign, 0.5);
      const cssUpdated = parseFloat(foreign.style.strokeDasharray);
      foreign.style.removeProperty('d');
      foreign.setAttribute('d', 'M0 0L300 0');
      motion.draw(foreign, 0.5);
      const attributeUpdated = parseFloat(foreign.style.strokeDasharray);
      owned.style.removeProperty('d');
      motion.draw(owned, 0.5);
      const restored = parseFloat(owned.style.strokeDasharray),
        expected = native.call(owned);
      SVGPathElement.prototype.getTotalLength = native;
      return {
        firstReads,
        secondReads,
        ownedLength,
        ownedTip,
        foreignLength,
        foreignTip,
        cssUpdated,
        attributeUpdated,
        restored,
        expected,
      };
    });
    assert.ok(result.firstReads > 0);
    assert.equal(result.secondReads, 0);
    assert.equal(result.ownedLength, 100);
    assert.equal(result.ownedTip, 50);
    assert.equal(result.foreignLength, 100);
    assert.equal(result.foreignTip, 50);
    assert.equal(result.cssUpdated, 200);
    assert.equal(result.attributeUpdated, 300);
    // CSSOM serializes stroke-dasharray with six significant digits.
    assert.ok(Math.abs(result.restored - result.expected) < 1e-4, JSON.stringify(result));
  } finally {
    await browser.close();
  }
});
