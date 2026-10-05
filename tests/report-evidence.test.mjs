import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { serve } from '../tools/site.mjs';
import { writeReportEvidence } from '../tools/motion/report-evidence.mjs';
import { sessionMarkup } from '../tools/motion/session-view.mjs';
import { playbackMarkup } from '../tools/motion/diagnostics.mjs';
import { queryEvidence } from '../tools/motion/inspection.mjs';

test('large review loads bounded evidence on file and HTTP, preserving queries and latest seeks', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'report-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const out = join(directory, 'review with spaces');
  await mkdir(out);
  const image = join(directory, 'source # image.png');
  await sharp({ create: { width: 200, height: 100, channels: 4, background: '#876543' } })
    .png()
    .toFile(image);
  const frames = Array.from({ length: 160 }, (_, i) => ({
    id: `frame:${i}`,
    time: i / 10 + (i >= 77 ? 10 : 0),
    file: image,
    width: 200,
    height: 100,
    state: {
      ...JSON.parse('{"__proto__":{"retained":"as data"}}'),
      frame: i,
      note: `PRIVATE_FRAME_DETAIL ${'x'.repeat(65536)}`,
    },
    views: [{ id: 'world', camera: { x: i }, receipt: { phase: 'observed', time: i / 10 } }],
    objects: [
      { id: 'operation', x: 0, y: 0, width: 100, height: 50, data: { kind: 'add' } },
      {
        id: 'cube',
        parent: 'operation',
        viewId: 'world',
        x: i % 20,
        y: 10,
        width: 10,
        height: 10,
        coordinates: 'css-viewport',
        text: '</script><script>window.injected=true</script>',
      },
    ],
  }));
  const telemetry = {
    documents: [
      { time: 0, url: 'a' },
      { time: 5, url: 'b' },
      { time: 10, url: 'a' },
    ],
    elements: [
      {
        time: 0.1,
        selector: '#heading',
        document: 'a',
        epoch: 100,
        x: 30,
        y: 1,
        width: 10,
        height: 5,
        text: 'A',
      },
      {
        time: 5.1,
        selector: '#heading',
        document: 'b',
        x: 40,
        y: 1,
        width: 10,
        height: 5,
        text: 'B',
      },
    ],
    scene: [
      { time: 0, state: { name: 'opening' } },
      { time: 12, state: { name: 'closing' } },
    ],
    events: [{ type: 'click', trusted: true, time: 7.6, target: '#heading' }],
    steps: [{ type: 'click', time: 7.6, epoch: 7600, selector: '#heading' }],
  };
  const episode = {
    id: 'chapter',
    title: 'A chapter',
    kind: 'chapter',
    start: 0,
    end: 25.9,
    frames: [{ time: 0 }, { time: 25.9 }],
    observed: { sampledFrames: 160 },
  };
  const report = {
    title: 'Saved evidence',
    samples: frames,
    telemetry,
    source: { kind: 'scene-seek', viewport: { width: 100, height: 50 } },
    context: { review: { unused: `PRIVATE_REVIEW ${'y'.repeat(1024 * 1024)}` } },
    session: {
      episodes: [episode],
      coverage: { from: 0, to: 25.9, frames: 160, sampling: 'model-checkpoints', complete: true },
    },
  };
  const index = await writeReportEvidence(report, out);
  const player = playbackMarkup(
    index.frames.map((f) => ({ time: f.time, image: f.file })),
    { open: true },
  );
  const html = `<!doctype html><meta charset="utf-8">${sessionMarkup(report, out, player, index)}`;
  await writeFile(join(out, 'index.html'), html);
  assert(!html.includes('PRIVATE_FRAME_DETAIL'));
  assert(!html.includes('PRIVATE_REVIEW'));
  assert(html.length < 100_000, `The HTML grew to ${html.length} bytes`);
  const bytes = (await Promise.all(index.chunks.map((c) => stat(join(out, c.file))))).reduce(
    (sum, s) => sum + s.size,
    0,
  );
  assert(bytes > 10_000_000);
  for (const chunk of index.chunks)
    assert(!(await readFile(join(out, chunk.file), 'utf8')).includes('</script>'));
  t.diagnostic(
    `${bytes} bytes of detailed evidence; ${Buffer.byteLength(html)} bytes of HTML; ${index.chunks.length} chunks`,
  );

  const browser = await chromium.launch();
  const server = await serve(directory);
  try {
    for (const protocol of ['file', 'http']) {
      const page = await browser.newPage();
      const errors = [],
        requests = new Map();
      let pending = 0,
        peak = 0;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (!/evidence-[a-f0-9]+\.js/.test(request.url())) return;
        requests.set(request.url(), (requests.get(request.url()) ?? 0) + 1);
        peak = Math.max(peak, ++pending);
      });
      const done = (request) => {
        if (/evidence-[a-f0-9]+\.js/.test(request.url())) pending--;
      };
      page.on('requestfinished', done);
      page.on('requestfailed', done);
      if (protocol === 'http')
        await page.route('**/evidence-*.js', async (route) => {
          await delay(25);
          await route.continue();
        });
      await page.goto(
        protocol === 'file'
          ? pathToFileURL(join(out, 'index.html')).href
          : `${server.url}/review%20with%20spaces/index.html`,
      );
      const evidenceAt = async (at) => {
        await page.waitForFunction((time) => {
          const inspector = document.querySelector('#session-inspector');
          const text = document.querySelector('[data-inspection-data]').textContent;
          return (
            inspector.getAttribute('aria-busy') === 'false' &&
            text &&
            JSON.parse(text).requested.at === time
          );
        }, at);
        return page.locator('[data-inspection-data]').textContent().then(JSON.parse);
      };
      const seek = async (at) => {
        await page.evaluate(
          (time) => document.dispatchEvent(new CustomEvent('motionframe', { detail: { time } })),
          at,
        );
        return evidenceAt(at);
      };
      await evidenceAt(0);
      assert(
        requests.size < index.chunks.length / 2,
        'Opening a report must not preload its whole capture',
      );
      assert.equal(await page.evaluate(() => window.injected), undefined);
      const playerImage = page.locator('.motion-playback');
      const box = await playerImage.boundingBox();
      const scale = Math.min(box.width / 200, box.height / 100);
      await playerImage.click({
        position: {
          x: (box.width - 200 * scale) / 2 + 10 * scale,
          y: (box.height - 100 * scale) / 2 + 30 * scale,
        },
      });
      await page.waitForFunction(() => {
        const evidence = JSON.parse(document.querySelector('[data-inspection-data]').textContent);
        return evidence.requested.point && evidence.requested.object === 'cube';
      });
      await page.selectOption('[data-inspection-object]', 'cube');
      await page.waitForFunction(
        () =>
          JSON.parse(document.querySelector('[data-inspection-data]').textContent).requested
            .object === 'cube',
      );
      const expectedData = {
        frames: frames.map((f, i) => ({ ...f, file: index.frames[i].file })),
        telemetry,
        source: report.source,
        episodes: [episode],
      };
      for (const at of [0.05, 7.65, 11, 19, 25.9, 0]) {
        const actual = await seek(at);
        assert.deepEqual(
          actual,
          JSON.parse(
            JSON.stringify(
              queryEvidence(expectedData, { at, radius: 0.3, object: 'cube', limit: 3 }),
            ),
          ),
          `${protocol} at ${at}`,
        );
      }
      await seek(11);
      await page.selectOption('[data-inspection-object]', '#heading');
      await page.waitForFunction(
        () =>
          JSON.parse(document.querySelector('[data-inspection-data]').textContent).requested
            .object === '#heading',
      );
      assert.deepEqual(
        JSON.parse(await page.locator('[data-inspection-data]').textContent()),
        JSON.parse(
          JSON.stringify(
            queryEvidence(expectedData, { at: 11, radius: 0.3, object: '#heading', limit: 3 }),
          ),
        ),
      );
      await page.selectOption('[data-inspection-object]', 'cube');
      // A long scrub must release earlier chunks; returning to the beginning reloads them.
      const first = [...requests.keys()].find((url) => url.endsWith(index.chunks[0].file));
      const loaded = requests.get(first);
      for (const at of [2, 4, 6, 8, 18, 20, 22, 24, 25.9]) await seek(at);
      await seek(0);
      assert(
        requests.get(first) > loaded,
        `${protocol}: details from all visited intervals remained resident`,
      );
      // Pending selections get replaced, not queued. A late script cannot restore an old frame.
      await page.evaluate(() => {
        for (const time of [5, 9, 2, 13, 4, 7.65])
          document.dispatchEvent(new CustomEvent('motionframe', { detail: { time } }));
      });
      const last = await evidenceAt(7.65);
      await delay(100);
      assert.equal(
        JSON.parse(await page.locator('[data-inspection-data]').textContent()).requested.at,
        7.65,
      );
      assert.equal(last.objects[0].id, 'cube');
      if (protocol === 'http') {
        await page.reload();
        await evidenceAt(0);
        const unavailable = '**/' + index.chunks[index.frames.at(-1).chunk].file;
        const fail = (route) => route.abort();
        await page.route(unavailable, fail);
        await page.evaluate(() =>
          document.dispatchEvent(new CustomEvent('motionframe', { detail: { time: 25.9 } })),
        );
        await page.waitForFunction(() =>
          document.querySelector('[data-inspection-status]').textContent.includes('Cannot load'),
        );
        assert.equal(await page.locator('#session-inspector').getAttribute('aria-busy'), 'false');
        await page.unroute(unavailable, fail);
        assert.equal((await seek(25.9)).requested.at, 25.9, 'A failed load must be retryable');
      }
      assert(peak <= 2, `${protocol}: ${peak} concurrent evidence requests`);
      assert.deepEqual(errors, []);
      await page.close();
    }
    const replaced = await writeReportEvidence(
      {
        ...report,
        samples: [{ ...frames[0], state: { replaced: true } }],
      },
      out,
    );
    assert.notEqual(replaced.chunks[0].file, index.chunks[0].file);
    await assert.rejects(readFile(join(out, index.chunks[0].file)), { code: 'ENOENT' });
    assert.equal(frames[0].state.frame, 0);
  } finally {
    await browser.close();
    await server.close();
  }
});
