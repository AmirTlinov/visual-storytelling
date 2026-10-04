import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { writeFile, stat, access } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { serve } from '../site.mjs';
import { observeBrowser } from './browser-observer.mjs';
import { runScenario, validateScenario } from './scenario.mjs';
import { captureWriter } from './session.mjs';
import { setTimeout as delay } from 'node:timers/promises';

export async function captureBrowser(options, out) {
  const scenario = validateScenario(options);
  const writer = await captureWriter(out),
    samples = writer.frames;
  let server,
    browser,
    session,
    observer,
    page,
    timer,
    draining,
    stopWatcher,
    stopping = false,
    error;
  let writes = Promise.resolve(),
    context;
  const drainBinding = '__visualReviewDrain' + randomUUID().replaceAll('-', '');
  const chunks = [],
    steps = [],
    messages = [],
    gaps = [];
  async function flush(stop = false) {
    const current = observer;
    if (!current) return;
    try {
      chunks.push(
        await current.evaluate((handle, stop) => (stop ? handle.stop() : handle.drain()), stop),
      );
    } catch {
      /* Navigation is recorded as a gap; pixels have independent storage. */
    }
  }
  try {
    let url = scenario.url;
    if (!/^https?:\/\//i.test(url ?? '')) {
      const path = resolve(url),
        directory = (await stat(path)).isDirectory();
      server = await serve(directory ? path : dirname(path));
      url = `${server.url}/${directory ? 'index.html' : encodeURIComponent(basename(path))}`;
    }
    if (scenario.cdp) {
      browser = await chromium.connectOverCDP(scenario.cdp, { timeout: 10000 });
      page = browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url() === url);
      if (!page) throw new Error(`No existing CDP tab matches ${url}`);
    } else {
      browser = await chromium.launch({ headless: !scenario.headed });
      page = await browser.newPage({
        viewport: { width: scenario.width, height: scenario.height },
        colorScheme: scenario.theme,
        reducedMotion: scenario.reduced ? 'reduce' : 'no-preference',
        deviceScaleFactor: 1,
      });
    }
    page.on('pageerror', (e) =>
      messages.push({ kind: 'error', text: e.message, epoch: Date.now() }),
    );
    page.on('console', (e) => {
      if (['error', 'warning'].includes(e.type()))
        messages.push({
          kind: e.type(),
          text: e.text(),
          location: e.location(),
          epoch: Date.now(),
        });
    });
    if (!scenario.cdp) await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      (targets) => targets.forEach((t) => document.querySelector(t)),
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
    session = await page.context().newCDPSession(page);
    await session.send('Runtime.enable');
    await session.send('Runtime.addBinding', { name: drainBinding });
    session.on('Runtime.bindingCalled', (event) => {
      if (event.name === drainBinding) chunks.push(JSON.parse(event.payload));
    });
    const install = async () => {
      observer = await page.evaluateHandle(observeBrowser, {
        targets: scenario.targets,
        drainBinding,
      });
      const review = await page
        .evaluate(() => document.querySelector('.ve-scene')?.scene?.review?.())
        .catch(() => undefined);
      if (review) context = { review, clock: 'media' };
    };
    await install();
    page.on('domcontentloaded', () => {
      if (!stopping) {
        gaps.push({
          epoch: Date.now(),
          kind: 'document-navigation',
          note: 'DOM observer restarted; pixels retained',
        });
        void install().catch(() => {});
      }
    });
    draining = setInterval(() => void flush(), 500);
    let resolveFirst;
    const first = new Promise((done) => (resolveFirst = done));
    session.on('Page.screencastFrame', (event) => {
      const epoch = event.metadata.timestamp * 1000;
      if (stopping || !Number.isFinite(epoch)) {
        void session
          .send('Page.screencastFrameAck', { sessionId: event.sessionId })
          .catch(() => {});
        return;
      }
      writes = writes
        .then(async () => {
          if (!samples.length || epoch > samples.at(-1).epoch) {
            await writer.append({
              id: `frame:${samples.length}`,
              epoch,
              receivedEpoch: Date.now(),
              png: Buffer.from(event.data, 'base64'),
              capture: 'compositor',
              pixelTimeUncertaintyMs: null,
            });
            resolveFirst();
          }
        })
        .catch((e) => {
          error ??= e.message;
        })
        .finally(() =>
          session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {}),
        );
    });
    await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await Promise.race([first, delay(1500)]);
    if (!samples.length) {
      const before = Date.now(),
        png = await page.screenshot({ animations: 'allow', caret: 'initial' });
      await writer.append({
        id: 'frame:0',
        epoch: Date.now(),
        png,
        capture: 'screenshot',
        uncertaintyMs: Date.now() - before,
      });
    }
    await options.onReady?.();
    const controller = new AbortController();
    let userStopped = false;
    if (options.stopFile)
      stopWatcher = setInterval(async () => {
        if (
          await access(options.stopFile).then(
            () => true,
            () => false,
          )
        ) {
          userStopped = true;
          controller.abort(new Error('Recording stopped'));
        }
      }, 100);
    const budget = Math.max(
      45000,
      (scenario.seconds + 30) * 1000 + scenario.actions.reduce((n, a) => n + (a.ms ?? 5000), 0),
    );
    const deadline = performance.now() + budget;
    timer = setTimeout(() => controller.abort(new Error('Capture time budget exceeded')), budget);
    const stamp = async (step) => {
      const { value, ...description } = step;
      steps.push({ ...description, epoch: Date.now() });
    };
    try {
      await runScenario(page, scenario.actions, stamp, { signal: controller.signal, deadline });
      const until = performance.now() + scenario.seconds * 1000;
      while (performance.now() < until && !page.isClosed()) {
        if (
          options.stopFile &&
          (await access(options.stopFile).then(
            () => true,
            () => false,
          ))
        )
          break;
        await delay(Math.max(0, Math.min(100, until - performance.now())), undefined, {
          signal: controller.signal,
        });
      }
    } catch (e) {
      if (!userStopped)
        error = controller.signal.aborted ? controller.signal.reason.message : e.message;
    }
    clearTimeout(timer);
    clearInterval(draining);
    clearInterval(stopWatcher);
    stopping = true;
    await session.send('Page.stopScreencast').catch(() => {});
    await writes;
    await flush(true);
    if (!page.isClosed()) {
      try {
        const before = Date.now(),
          png = await page.screenshot({ animations: 'allow', caret: 'initial' }),
          epoch = Date.now();
        if (epoch > samples.at(-1).epoch)
          await writer.append({
            id: `frame:${samples.length}`,
            epoch,
            png,
            capture: 'screenshot',
            uncertaintyMs: epoch - before,
          });
      } catch (e) {
        error ??= `Final screenshot failed: ${e.message}`;
      }
    }
    await options.onCaptured?.();
    const origin = samples[0].epoch;
    for (const s of samples) {
      s.time = (s.epoch - origin) / 1000;
      if (s.receivedEpoch !== undefined) {
        s.receivedTime = (s.receivedEpoch - origin) / 1000;
        delete s.receivedEpoch;
      }
    }
    const telemetry = {
      capabilities: [],
      raf: [],
      elements: [],
      events: [],
      longFrames: [],
      layoutShifts: [],
      scene: [],
      documents: [],
    };
    for (const c of chunks) {
      const seconds = (t) => (c.epoch + t - origin) / 1000;
      telemetry.capabilities.push(...c.capabilities);
      if (!telemetry.documents.some((d) => d.epoch === c.epoch))
        telemetry.documents.push({ time: seconds(c.started), url: c.document, epoch: c.epoch });
      telemetry.raf.push(...c.raf.map(seconds));
      for (const key of ['elements', 'scene'])
        telemetry[key].push(
          ...c[key].map((e) => ({ ...e, document: c.document, time: seconds(e.time) })),
        );
      for (const key of ['events', 'longFrames', 'layoutShifts'])
        telemetry[key].push(
          ...c[key].map((e) => ({ ...e, document: c.document, time: seconds(e.start) })),
        );
    }
    telemetry.capabilities = [...new Set(telemetry.capabilities)];
    telemetry.raf.sort((a, b) => a - b);
    for (const key of ['elements', 'events', 'longFrames', 'layoutShifts', 'scene'])
      telemetry[key].sort((a, b) => a.time - b.time);
    telemetry.steps = steps.map(({ epoch, ...s }) => ({ ...s, time: (epoch - origin) / 1000 }));
    telemetry.messages = messages.map(({ epoch, ...s }) => ({
      ...s,
      time: (epoch - origin) / 1000,
    }));
    if (error) telemetry.error = error;
    const source = {
      kind: 'browser-capture',
      path: scenario.url,
      viewport,
      clock: 'CDP compositor capture',
      sparse: true,
      domSynchronized: false,
      timingNote:
        'CDP timestamps do not establish pixel/DOM synchrony. Pixel presentation-time uncertainty is unknown; DOM timing is separate.',
      theme: scenario.cdp ? 'existing-tab' : scenario.theme,
      reduced: scenario.cdp ? 'existing-tab' : scenario.reduced,
      ...(error ? { error } : {}),
      gaps: gaps.map(({ epoch, ...g }) => ({ ...g, time: (epoch - origin) / 1000 })),
    };
    const captureManifest = await writer.finish(source, telemetry, context);
    const { onReady, onCaptured, stopFile, ...stored } = scenario;
    await writeFile(
      join(out, 'replay.json'),
      JSON.stringify({ kind: 'motion-capture', version: 1, ...stored }, null, 2) + '\n',
    );
    return { samples, source, telemetry, context, captureManifest };
  } finally {
    clearTimeout(timer);
    clearInterval(draining);
    clearInterval(stopWatcher);
    stopping = true;
    await writes;
    await observer?.evaluate((h) => h.stop()).catch(() => {});
    await session?.send('Runtime.removeBinding', { name: drainBinding }).catch(() => {});
    await page
      ?.evaluate((name) => {
        delete window[name];
      }, drainBinding)
      .catch(() => {});
    await session?.detach().catch(() => {});
    await browser?.close();
    await server?.close();
  }
}
