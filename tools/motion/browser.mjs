import { chromium } from 'playwright';
import { writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { serve } from '../site.mjs';
import { observeBrowser } from './browser-observer.mjs';
import { runScenario, validateScenario } from './scenario.mjs';
import { saveCapture } from './media.mjs';

export async function captureBrowser(options, out) {
  const scenario = validateScenario(options);
  let server, browser, session, observer, page, timer;
  let stopping = false,
    error,
    truncated = false;
  const samples = [],
    steps = [],
    messages = [];
  let telemetry;
  try {
    let url = scenario.url;
    if (!/^https?:\/\//i.test(url ?? '')) {
      const path = resolve(url);
      const directory = (await stat(path)).isDirectory();
      server = await serve(directory ? path : dirname(path));
      url = `${server.url}/${directory ? 'index.html' : encodeURIComponent(basename(path))}`;
    }
    if (scenario.cdp) {
      browser = await chromium.connectOverCDP(scenario.cdp, { timeout: 10000 });
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url() === url);
      if (!page)
        throw new Error(`No existing CDP tab matches ${url}; open that page first or omit --cdp`);
    } else {
      browser = await chromium.launch({ headless: !scenario.headed });
      page = await browser.newPage({
        viewport: { width: scenario.width, height: scenario.height },
        colorScheme: scenario.theme,
        reducedMotion: scenario.reduced ? 'reduce' : 'no-preference',
        deviceScaleFactor: 1,
      });
    }
    page.on('pageerror', (entry) =>
      messages.push({ kind: 'error', text: entry.message, epoch: Date.now() }),
    );
    page.on('console', (entry) => {
      if (['error', 'warning'].includes(entry.type()))
        messages.push({
          kind: entry.type(),
          text: entry.text(),
          location: entry.location(),
          epoch: Date.now(),
        });
    });
    if (!scenario.cdp) await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    // Targets may only appear after an action. Validate syntax without waiting for existence.
    await page.evaluate(
      (targets) => targets.forEach((target) => document.querySelector(target)),
      scenario.targets,
    );
    if (scenario.ready)
      await page.locator(scenario.ready).waitFor({ state: 'visible', timeout: 10000 });
    await page.bringToFront();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      deviceScaleFactor: devicePixelRatio,
    }));
    observer = await page.evaluateHandle(observeBrowser, { targets: scenario.targets });
    session = await page.context().newCDPSession(page);
    let resolveFirst;
    const first = new Promise((done) => {
      resolveFirst = done;
    });
    session.on('Page.screencastFrame', (event) => {
      void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      if (stopping) return;
      if (samples.length >= 599) {
        truncated = true;
        return;
      }
      const epoch = event.metadata.timestamp * 1000;
      if (!Number.isFinite(epoch) || (samples.length && epoch <= samples.at(-1).epoch)) return;
      samples.push({
        epoch,
        receivedEpoch: Date.now(),
        png: Buffer.from(event.data, 'base64'),
        capture: 'compositor',
        pixelTimeUncertaintyMs: null,
      });
      resolveFirst();
    });
    await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await Promise.race([first, page.waitForTimeout(1500)]);
    if (!samples.length) {
      const before = Date.now(),
        png = await page.screenshot({ animations: 'allow', caret: 'initial' });
      samples.push({
        epoch: Date.now(),
        png,
        capture: 'screenshot',
        uncertaintyMs: Date.now() - before,
      });
    }
    const stamp = async (step) => {
      // Scheduling diagnostics must not wait for a busy application main thread.
      const epoch = Date.now();
      // Filled values stay in the replay supplied by the user, not in diagnostic prose.
      const { value, ...description } = step;
      steps.push({ ...description, epoch });
    };
    try {
      await Promise.race([
        (async () => {
          await runScenario(page, scenario.actions, stamp);
          await page.waitForTimeout(scenario.seconds * 1000);
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Capture exceeded 45 seconds; shorten the scenario')),
            45000,
          );
        }),
      ]);
    } catch (failure) {
      error = failure.message;
    }
    clearTimeout(timer);
    stopping = true;
    await session.send('Page.stopScreencast').catch(() => {});
    try {
      telemetry = await observer.evaluate((handle) => handle.stop());
    } catch {
      telemetry = {
        capabilities: [],
        raf: [],
        elements: [],
        events: [],
        longFrames: [],
        layoutShifts: [],
        warning: 'Page navigation reset runtime observations; captured images remain available',
      };
    }
    if (!page.isClosed()) {
      try {
        const before = Date.now(),
          png = await page.screenshot({ animations: 'allow', caret: 'initial' });
        const epoch = Date.now();
        if (epoch > (samples.at(-1)?.epoch ?? 0))
          samples.push({ epoch, png, capture: 'screenshot', uncertaintyMs: epoch - before });
      } catch (failure) {
        error ??= `Final screenshot failed: ${failure.message}`;
      }
    }
    const origin = samples[0].epoch;
    for (const sample of samples) {
      sample.time = (sample.epoch - origin) / 1000;
      if (sample.receivedEpoch !== undefined) {
        sample.receivedTime = (sample.receivedEpoch - origin) / 1000;
        delete sample.receivedEpoch;
      }
    }
    // CDP timestamps describe captured compositor images, not physical display presentation.
    const source = {
      kind: 'browser-capture',
      path: scenario.url,
      viewport,
      clock: 'CDP compositor capture; screenshots have timestamp uncertainty',
      sparse: true,
      domSynchronized: false,
      timingNote:
        'CDP image timestamps do not establish pixel/DOM synchrony. Pixel presentation-time uncertainty is unknown; use DOM timing separately.',
      theme: scenario.cdp ? 'existing-tab' : scenario.theme,
      reduced: scenario.cdp ? 'existing-tab' : scenario.reduced,
    };
    const epoch = telemetry.epoch ?? 0;
    const seconds = (t) => (epoch + t - origin) / 1000;
    telemetry.raf = (telemetry.raf ?? []).map(seconds);
    telemetry.elements = (telemetry.elements ?? []).map((entry) => ({
      ...entry,
      time: seconds(entry.time),
    }));
    for (const key of ['events', 'longFrames', 'layoutShifts'])
      telemetry[key] = (telemetry[key] ?? []).map((entry) => ({
        ...entry,
        time: seconds(entry.start),
      }));
    telemetry.steps = steps.map(({ epoch, ...step }) => ({
      ...step,
      time: (epoch - origin) / 1000,
    }));
    telemetry.messages = messages.map(({ epoch, ...entry }) => ({
      ...entry,
      time: (epoch - origin) / 1000,
    }));
    if (truncated) {
      telemetry.warning = 'Capture reached 600 images; shorten the scenario for full coverage';
      source.warning = telemetry.warning;
      source.truncated = true;
    }
    if (error) telemetry.error = error;
    const captureManifest = await saveCapture(samples, source, out, telemetry);
    const replay = { kind: 'motion-capture', version: 1, ...scenario };
    await writeFile(join(out, 'replay.json'), JSON.stringify(replay, null, 2) + '\n');
    return { samples, source, telemetry, replay, captureManifest };
  } finally {
    clearTimeout(timer);
    stopping = true;
    await observer?.evaluate((handle) => handle.stop()).catch(() => {});
    await session?.detach().catch(() => {});
    // CDP connections disconnect here; user-owned browser processes and pages stay open.
    await browser?.close();
    await server?.close();
  }
}
