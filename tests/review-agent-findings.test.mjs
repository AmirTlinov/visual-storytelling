import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { observeBrowser } from '../tools/motion/browser-observer.mjs';
import { summarizeRuntime } from '../tools/motion/runtime.mjs';
import { buildEpisodes } from '../tools/motion/episodes.mjs';

test('actions at a chapter boundary belong to the new chapter, including repeated visits', () => {
  for (const times of [
    [0, 1, 2, 3, 4, 5, 3, 4, 5, 6],
    [0, 1, 3],
  ]) {
    const episodes = buildEpisodes(
      times.map((_, time) => ({ time, id: String(time) })),
      {
        context: {
          clock: 'media',
          review: {
            segments: [
              { id: 'intro', start: 0, end: 3 },
              { id: 'turn', start: 3, end: 6 },
            ],
            cues: [{ id: 'rotate', kind: 'action', start: 3, end: 5, action: 'Rotate' }],
          },
        },
        telemetry: { scene: times.map((mediaTime, time) => ({ time, mediaTime })) },
      },
    );
    const turns = episodes.filter((episode) => episode.cue === 'rotate');
    assert.deepEqual(
      turns.map((episode) => episode.parent),
      times.length > 3 ? ['chapter:turn', 'chapter:turn:visit:1'] : ['chapter:turn'],
    );
  }
});

test('accessible-only captions stay observed without hiding actual content clipping', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    await page.setContent(`<style>
      .sr { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%); }
      .legacy { clip-path:none;clip:rect(0,0,0,0); }
      #clipped,#static { width:20px;height:20px;overflow:hidden;white-space:nowrap; }
      #static { clip:rect(0,0,0,0);position:static; }
      #hidden-parent { display:none; }
    </style><p class="sr" id="caption">An intentionally hidden spoken description</p>
      <p class="sr legacy" id="legacy">An accessible-only legacy label</p>
      <p id="clipped">This visible sentence is actually clipped</p>
      <p id="static">Legacy clip is ineffective on this visible static paragraph</p>
      <div id="hidden-parent"><p id="child">Not painted</p></div>`);
    await page.evaluate(
      observeBrowser
        .toString()
        .replace('function observeBrowser', 'window.startObservation = function'),
    );
    const observed = await page.evaluate(async () => {
      const observer = window.startObservation({
        targets: ['#caption', '#legacy', '#clipped', '#static', '#child'],
      });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return observer.stop();
    });
    const runtime = summarizeRuntime(
      { ...observed, messages: [], steps: [] },
      { width: 640, height: 480 },
    );
    assert(observed.elements.some((point) => point.selector === '#caption'));
    assert(observed.elements.some((point) => point.selector === '#legacy'));
    assert.equal(observed.elements.find((point) => point.selector === '#child').visible, false);
    assert.deepEqual(
      runtime.insights
        .filter((insight) => insight.kind === 'content-clipped')
        .map((insight) => insight.target),
      ['#clipped', '#static'],
    );
  } finally {
    await browser.close();
  }
});
