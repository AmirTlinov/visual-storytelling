import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { serve } from '../tools/site.mjs';
import { reviewMotion } from '../tools/motion/review.mjs';
import { validateScenario, runScenario } from '../tools/motion/scenario.mjs';

const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const run = promisify(execFile);

test('CLI overrides the scenario URL and retains a private action failure amid page errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-cli-'));
  const server = await serve(directory);
  try {
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><button id="open" onclick="for(let i=0;i<12;i++)console.error(`Page error ${i}`)">Open</button><div id="panel">Ready</div>',
    );
    const flow = join(directory, 'flow.json');
    await writeFile(
      flow,
      JSON.stringify({
        url: `${server.url}/wrong-page`,
        actions: [
          { type: 'click', selector: '#open' },
          { type: 'fill', selector: '#panel', env: 'MOTION_PRIVATE_TEST_VALUE' },
        ],
        seconds: 0.1,
      }),
    );
    const out = join(directory, 'report');
    const secret = 'private-test-"value"\\line';
    let result;
    try {
      await run(
        process.execPath,
        ['tools/scene.mjs', 'review', server.url, '--scenario', flow, '--out', out],
        { env: { ...process.env, MOTION_PRIVATE_TEST_VALUE: secret } },
      );
      assert.fail('The failed fill must return status 2');
    } catch (error) {
      assert.equal(error.code, 2);
      result = JSON.parse(error.stdout);
    }
    assert.equal(result.source.path, server.url);
    assert.equal(result.insights[0].kind, 'action-error');
    assert.match(result.insights[0].detail, /not an <input>/);
    for (const file of ['index.html', 'motion.json', 'telemetry.json', 'replay.json']) {
      const text = await readFile(join(out, file), 'utf8');
      assert(!text.includes('private-test-'), `fill value leaked into ${file}`);
    }
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('cancelling a scenario interrupts waits and prevents later repeated input', async () => {
  for (const repeat of [false, true]) {
    const controller = new AbortController();
    let clicks = 0;
    const page = {
      locator: () => ({
        waitFor: async () => {},
        scrollIntoViewIfNeeded: async () => {},
        boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }),
        click: async () => clicks++,
      }),
      mouse: { click: async () => clicks++ },
    };
    const actions = repeat
      ? [{ type: 'click', selector: '#button', repeat: 2, intervalMs: 5000 }]
      : [
          { type: 'wait', ms: 5000 },
          { type: 'click', selector: '#button' },
        ];
    const timer = setTimeout(() => controller.abort(new Error('Capture deadline')), 25);
    const started = performance.now();
    try {
      await assert.rejects(
        runScenario(page, actions, async () => {}, { signal: controller.signal }),
        /Capture deadline/,
      );
      assert(performance.now() - started < 1000, 'the cancelled timer must settle promptly');
      assert.equal(clicks, repeat ? 1 : 0);
    } finally {
      clearTimeout(timer);
    }
  }
});

test('browser records repeated input, attributes a stall and blink, replays and compares saved evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-browser-'));
  const server = await serve(resolve('tests/fixtures'));
  try {
    const actions = [
      { type: 'click', selector: '#toggle' },
      { type: 'wait', ms: 120 },
      { type: 'click', selector: '#toggle' },
    ];
    const faulty = await reviewMotion({
      input: `${server.url}/motion-browser.html?fault=1`,
      capture: { actions, targets: ['#card'], seconds: 1 },
      out: join(directory, 'fault'),
    });
    const report = await read(faulty.data);
    assert(
      report.runtime.insights.some((v) => v.kind === 'long-animation-frame' && v.durationMs >= 100),
    );
    const blink = report.runtime.insights.find((v) => v.kind === 'brief-disappearance');
    assert(blink, 'target opacity disappearance should be observed');
    assert(
      report.frames[0].time <= blink.time && report.frames.at(-1).time >= blink.time,
      'automatic detail should include the visual defect',
    );
    assert.equal(
      report.runtime.steps.filter((v) => v.type === 'click' && v.phase === 'end').length,
      2,
    );
    assert(faulty.recording.frames > faulty.frames);
    assert(!JSON.stringify(report).includes('base64'));

    const offline = await reviewMotion({
      input: resolve(dirname(faulty.data), report.captureManifest),
      from: Math.max(0, blink.time - 0.03),
      out: join(directory, 'offline'),
    });
    const imported = await read(offline.data);
    assert.equal(imported.source.kind, 'browser-capture');
    assert(imported.timeline.frames <= report.timeline.frames);
    assert(imported.runtime.insights.some((v) => v.kind === 'brief-disappearance'));
    const captures = await read(resolve(dirname(offline.data), imported.captureManifest));
    assert.equal(captures.frames.length, imported.timeline.frames);

    const healthy = await reviewMotion({
      input: faulty.replay,
      capture: { url: `${server.url}/motion-browser.html` },
      baseline: join(directory, 'fault'),
      out: join(directory, 'healthy'),
    });
    const after = await read(healthy.data);
    assert(!after.runtime.insights.some((v) => v.kind === 'brief-disappearance'));
    assert(after.comparison.pairs.length >= 6);
    assert(after.comparison.pairs.some((p) => p.mode === 'elapsed'));
    assert(after.comparison.pairs.some((p) => p.mode === 'phase'));
    assert(after.comparison.pairs.every((v) => Number.isFinite(v.timestampDistanceMs)));
    assert(after.runtime.trajectories[0].largestStep);
    await assert.rejects(
      reviewMotion({ input: faulty.replay, baseline: faulty.data, out: join(directory, 'fault') }),
      /separate/,
    );

    // The portable report must keep playback functional after copying all evidence.
    const browser = await chromium.launch();
    const reports = await serve(directory);
    try {
      const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
      await page.goto(`${reports.url}/offline/index.html`);
      assert.equal(await page.locator('.motion-detail[open]').count(), 0);
      assert((await page.locator('.motion-summary').boundingBox()).height < 1100);
      await page.locator('.motion-nav a[href="#motion-runtime"]').click();
      assert.notEqual(await page.locator('#motion-runtime').getAttribute('open'), null);
      assert.equal(
        await page.locator('#motion-runtime .motion-observation-list > li').count(),
        imported.runtime.insights.length + imported.timeline.signals.length,
        'the complete observations survive the compact overview',
      );
      const jump = page.locator('#motion-runtime [data-motion-time][data-clock="browser"]').first();
      const requested = Number(await jump.getAttribute('data-motion-time'));
      await jump.click();
      const nearest = captures.frames.reduce((best, frame) =>
        Math.abs(frame.time - requested) < Math.abs(best.time - requested) ? frame : best,
      );
      assert.notEqual(await page.locator('.motion-play').getAttribute('open'), null);
      assert.equal(
        await page.locator('.motion-play input[type=range]').inputValue(),
        String(nearest.time),
      );
      assert.match(
        await page.locator('.motion-seek-note').innerText(),
        /Синхронизация DOM и пикселей не подтверждена/,
      );
      const beforeStep = await page.locator('.motion-play img').getAttribute('src');
      await page.locator('.motion-play [data-next]').click();
      assert.notEqual(await page.locator('.motion-play img').getAttribute('src'), beforeStep);
      await page.locator('.motion-play [data-previous]').click();
      assert.equal(await page.locator('.motion-play img').getAttribute('src'), beforeStep);
      await page.goto(`${reports.url}/offline/index.html#motion-photometry`);
      await page.waitForFunction(() => document.querySelector('#motion-photometry').open);
      await page.setViewportSize({ width: 375, height: 800 });
      assert(
        await page.locator('.motion-context img').isVisible(),
        'mobile retains source context',
      );
      for (const summary of await page.locator('.motion-detail > summary').all())
        if (!(await summary.evaluate((element) => element.parentElement.open)))
          await summary.click();
      if ((await page.locator('.motion-play').getAttribute('open')) === null)
        await page.locator('.motion-play summary').click();
      const slider = page.locator('.motion-play input[type=range]');
      const maximum = await slider.getAttribute('max');
      await slider.focus();
      await slider.press('End');
      await page.waitForFunction(() => {
        const image = document.querySelector('.motion-play img');
        return image.complete && image.naturalWidth > 0;
      });
      assert.equal(
        await page.locator('.motion-play output').innerText(),
        `${Number(maximum).toFixed(3)} с`,
      );
      assert(
        new URL(await page.locator('.motion-play img').getAttribute('src'), page.url()).pathname ===
          new URL(captures.frames.at(-1).file, `${reports.url}/offline/capture/frames.json`)
            .pathname,
      );
      await page.locator('.motion-play [data-play]').click();
      await page.waitForTimeout(100);
      assert(Number(await slider.inputValue()) < Number(maximum));
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'report fits a narrow viewport',
      );
    } finally {
      await browser.close();
      await reports.close();
    }
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('late-mounted targets and action failures retain a usable partial report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-mount-'));
  try {
    const input = join(directory, 'index.html');
    await writeFile(
      input,
      `<!doctype html><button onclick="document.body.insertAdjacentHTML('beforeend','<div id=panel>Ready</div>')">Open</button>`,
    );
    const result = await reviewMotion({
      input,
      capture: {
        targets: ['#panel'],
        actions: [
          { type: 'click', role: 'button', name: 'Open' },
          { type: 'fill', selector: '#panel', env: 'MOTION_TEST_ABSENT_VARIABLE' },
        ],
        seconds: 0.1,
      },
      out: join(directory, 'review'),
    });
    const report = await read(result.data);
    assert(
      report.runtime.insights.some(
        (v) => v.kind === 'action-error' && v.detail.includes('Environment variable'),
      ),
    );
    assert(report.runtime.trajectories[0].missingSamples > 0);
    assert(!report.runtime.insights.some((v) => v.kind === 'target-not-observed'));
    assert(report.frames.length >= 2);
    const replay = await read(result.replay);
    assert.equal(replay.actions[1].env, 'MOTION_TEST_ABSENT_VARIABLE');
    assert.throws(() => validateScenario({ actions: [{ type: 'wait', ms: Infinity }] }), /wait/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CDP reuses the selected authenticated tab, preserves its viewport and disconnects cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-cdp-'));
  const server = await serve(resolve('tests/fixtures'));
  const browser = await chromium.launch({
    args: ['--remote-debugging-port=0', '--enable-automation'],
  });
  try {
    const session = await browser.newBrowserCDPSession();
    const { arguments: args } = await session.send('Browser.getBrowserCommandLine');
    // Obtain the actual port from the browser user-data directory, owned by this test.
    const profile = args
      .find((v) => v.startsWith('--user-data-dir='))
      .slice('--user-data-dir='.length);
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
    const url = `${server.url}/motion-browser.html`;
    await page.goto(url);
    await page.evaluate(() => localStorage.setItem('motion-test-session', 'present'));
    const result = await reviewMotion({
      input: url,
      capture: {
        cdp: `http://127.0.0.1:${port}`,
        actions: [{ type: 'click', selector: '#toggle' }],
        seconds: 0.2,
      },
      out: join(directory, 'review'),
    });
    assert.equal(result.source.viewport.width, 700);
    assert(browser.isConnected());
    assert(!page.isClosed());
    assert.equal(await page.evaluate(() => localStorage.getItem('motion-test-session')), 'present');
    assert(await page.locator('.stage').evaluate((node) => node.classList.contains('open')));
  } finally {
    await browser.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
