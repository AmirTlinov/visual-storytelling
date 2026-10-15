import { pluginHost } from './host.mjs';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../../tools/chromium.mjs';
import { readFile, writeFile, appendFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadavg, cpus, totalmem, platform, arch, release as osRelease } from 'node:os';
import assert from 'node:assert/strict';
import { observeBrowserFrames } from './frame-observer.mjs';
import { assertViewerSnapshot } from './viewer-snapshot.mjs';

const out = resolve('artifacts/slice14/input-frame-check/run-' + randomUUID());
await mkdir(out, { recursive: true });
const authorTrials = Number(process.env.TRIALS ?? 200),
  viewerTrials = Number(process.env.VIEWER_TRIALS ?? 0);
assert(Number.isSafeInteger(authorTrials) && authorTrials > 0);
assert(Number.isSafeInteger(viewerTrials) && viewerTrials >= 0);
const widthAt = (index, count) => [1200, 760, 390][Math.min(2, Math.floor((index * 3) / count))];
const release = resolve(process.env.ACCEPT_RELEASE ?? '.plugin-release'),
  data = join(out, 'data'),
  target = {},
  start = performance.now();
const host = await pluginHost({
  dataDirectory: data,
  serverCommand: join(release, 'runtime/node'),
  serverEntry: join(release, 'plugin/dist/server.mjs'),
  initialTarget: target,
});
const startupMs = performance.now() - start;
const environment = {
  cpu: cpus()[0].model,
  cores: cpus().length,
  memoryBytes: totalmem(),
  platform: platform(),
  arch: arch(),
  os: osRelease(),
  loadAtStartup: loadavg(),
  startupMs,
};
const browser = await chromium.launch(chromiumLaunchOptions());
const call = async (name, args) => {
  const result = await host.client.callTool({ name, arguments: args });
  assert(!result.isError, JSON.stringify(result));
  return result.structuredContent;
};
const errors = [],
  projects = [],
  edits = [],
  viewer = [],
  cold = [];
const waitShown = async (item) => {
  let last;
  for (let n = 0; n < 150; n++) {
    const x = (last = await call('story_inspect', { sessionId: item.sessionId }));
    if (
      x.shownSourceRevision === item.project.sourceRevision &&
      x.renderStatus === 'rendered' &&
      (!x.state?.rendering || x.state.rendering.phase === 'ready') &&
      !x.update
    )
      return x;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Display deadline ' + JSON.stringify(last));
};
try {
  for (const recipe of ['division', 'fractions', 'dependency-route']) {
    const began = performance.now(),
      inputs =
        recipe === 'division'
          ? { count: 17, divisor: 4 }
          : recipe === 'fractions'
            ? {
                leftNumerator: 1,
                leftDenominator: 3,
                rightNumerator: 1,
                rightDenominator: 3,
                action: 'move',
              }
            : { orderId: '417', reserve: 'none' };
    const created = await call('story_create', {
      title: recipe,
      document: { recipe, inputs, chapters: [] },
      path: join(out, recipe),
      requestId: randomUUID(),
    });
    assert(!created.job, 'Expected prepared create');
    const opened = await call('story_open', { projectId: created.project.id });
    target.sessionId = opened.sessionId;
    const page = await browser.newPage({ viewport: { width: 1200, height: 960 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(host.url);
    await page.locator('body').evaluate((body) => (body.style.maxWidth = 'none'));
    const frame = page.frameLocator('iframe[title="MCP App"]').frameLocator('#scene');
    await frame.locator('main.ve-scene').waitFor();
    const frames = await observeBrowserFrames(page);
    const box = await frame.locator('.ve-stage').boundingBox();
    assert(box?.width > 0);
    const item = {
      recipe,
      project: created.project,
      sessionId: opened.sessionId,
      page,
      frame,
      frames,
      box,
    };
    await waitShown(item);
    await frame.locator('main').evaluate((root) => {
      window.originalScene = root.scene;
    });
    cold.push({
      recipe,
      firstFrameMs: performance.now() - began,
      totalSinceStartupMs: performance.now() - start,
    });
    projects.push(item);
  }
  for (let index = 0; index < authorTrials; index++) {
    const item = projects[index % 3],
      round = Math.floor(index / 3),
      values =
        item.recipe === 'division'
          ? { count: round % 36, divisor: 2 + Math.floor(round / 36) }
          : item.recipe === 'fractions'
            ? {
                leftNumerator: round % 13,
                leftDenominator: 12,
                rightNumerator: Math.floor(round / 13),
                rightDenominator: 12,
              }
            : { orderId: String(418 + round), 'disabled-provider': round % 2 === 0 };
    await item.page.bringToFront();
    const width = widthAt(index, authorTrials);
    if (item.page.viewportSize().width !== width) {
      await item.page.setViewportSize({ width, height: 960 });
      await item.frame.locator('main').evaluate(async (root) => {
        await root.scene.ready?.();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      item.box = await item.frame.locator('.ve-stage').boundingBox();
    }
    const startedEpoch = item.frames.begin();
    const began = performance.now(),
      result = await call('story_edit', {
        context: item.project.context,
        requestId: randomUUID(),
        operations: [
          {
            op: 'set-inputs',
            modelId: item.recipe === 'dependency-route' ? 'route' : item.recipe,
            values,
          },
        ],
      });
    const callMs = performance.now() - began;
    assert.equal(result.delivery, 'shown', JSON.stringify(result));
    item.project = result.project;
    const state = await item.frame.locator('main').evaluate((root) => ({
      same: root.scene === window.originalScene,
      values: root.scene.capture().values,
      snapshot: root.scene.snapshot(),
    }));
    assert(state.same);
    for (const [key, value] of Object.entries(values)) assert.equal(state.values[key], value);
    const elapsedMs = performance.now() - began;
    const match = await item.frames.matchedDrawing(item.box, startedEpoch),
      pixelMs = match.pixelMs;
    await writeFile(join(out, 'frame-' + index + '.png'), match.png);
    const revision = result.buildRevision ?? result.shown[0].buildRevision;
    const build = JSON.parse(await readFile(join(data, 'builds', revision + '.json'), 'utf8'));
    assert(!Object.hasOwn(build, 'html'));
    assert.equal(result.work.payload.hashedBytes, 0);
    assert.equal(result.work.payload.writtenBytes, 0);
    assert.equal(result.work.payload.templateHits, 1);
    edits.push({
      index,
      width,
      recipe: item.recipe,
      elapsedMs,
      callMs,
      pixelMs,
      startedEpoch,
      frameHash: match.hash,
      observationMs: elapsedMs - callMs,
      revision,
      sourceRevision: item.project.sourceRevision,
      work: result.work,
      bytes: Buffer.byteLength(JSON.stringify(build)),
      values,
    });
    await appendFile(
      join(out, 'samples.jsonl'),
      JSON.stringify({ kind: 'author', ...edits.at(-1) }) + '\n',
    );
    if (index % 25 === 24)
      console.log(JSON.stringify({ completed: index + 1, latestMs: elapsedMs }));
  }
  for (let index = 0; index < viewerTrials; index++) {
    const item = projects[index % 3],
      round = Math.floor(index / 3),
      width = widthAt(index, viewerTrials);
    await item.page.bringToFront();
    if (item.page.viewportSize().width !== width) {
      await item.page.setViewportSize({ width, height: 960 });
      await item.frame.locator('main').evaluate(async (root) => {
        await root.scene.ready?.();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
    }
    const root = item.frame.locator('main'),
      before = await root.evaluate((root) => root.scene.capture().values),
      key =
        item.recipe === 'division'
          ? 'count'
          : item.recipe === 'fractions'
            ? 'leftNumerator'
            : 'disabled-provider',
      delta = round % 2 ? -1 : 1,
      expected = item.recipe === 'dependency-route' ? !before[key] : before[key] + delta,
      button =
        item.recipe === 'dependency-route'
          ? item.frame.getByRole('switch', { name: 'Отказ: Провайдер А', exact: true })
          : item.frame.getByRole('button', {
              name: `${delta === 1 ? 'Увеличить' : 'Уменьшить'}: ${item.recipe === 'division' ? 'Предметов' : 'Первая: числитель'}`,
              exact: true,
            });
    if (!(await button.isVisible()))
      await item.frame.getByRole('button', { name: 'Условия', exact: true }).click();
    await root.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const popup = await Promise.all(
      (await item.frame.locator('[popover]:popover-open').all()).map((node) => node.boundingBox()),
    );
    const exclude = popup
      .filter(Boolean)
      .map((r) => ({ x: r.x - 32, y: r.y - 32, width: r.width + 64, height: r.height + 64 }));
    item.box = await item.frame.locator('.ve-stage').boundingBox();
    const markupBefore = await root.locator('.ve-stage').innerHTML();
    const baseline = await item.frames.capture();
    await writeFile(join(out, 'viewer-before-' + index + '.png'), Buffer.from(baseline, 'base64'));
    await button.evaluate((element) => {
      window.viewerActivation = undefined;
      element.addEventListener(
        'pointerdown',
        (event) => {
          window.viewerActivation = {
            at: performance.timeOrigin + event.timeStamp,
            trusted: event.isTrusted,
          };
        },
        { capture: true, once: true },
      );
    });
    const dispatchEpoch = item.frames.begin();
    await button.click();
    const accepted = await root.evaluate(async (root) => {
      await root.scene.ready?.();
      return {
        activation: window.viewerActivation,
        same: root.scene === window.originalScene,
        values: root.scene.capture().values,
        snapshot: root.scene.snapshot(),
      };
    });
    assert(
      accepted.activation?.trusted,
      'Viewer input must come from an actual trusted pointer activation',
    );
    assert(accepted.activation.at >= dispatchEpoch);
    assert(accepted.same);
    assert.equal(accepted.values[key], expected);
    assertViewerSnapshot(item.recipe, accepted.values, accepted.snapshot);
    assert.notEqual(
      await root.locator('.ve-stage').innerHTML(),
      markupBefore,
      'The subject drawing must change, not only its control',
    );
    const match = await item.frames.matchedDrawing(item.box, accepted.activation.at, {
      baseline,
      exclude,
    });
    await writeFile(join(out, 'viewer-' + index + '.png'), match.png);
    const sample = {
      index,
      width,
      recipe: item.recipe,
      key,
      expected,
      activation: accepted.activation,
      dispatchEpoch,
      pixelMs: match.pixelMs,
      observed: match.observed,
      reason: match.reason,
      frameHash: match.hash,
      popup,
      exclude,
      snapshot: accepted.snapshot,
    };
    viewer.push(sample);
    await appendFile(
      join(out, 'samples.jsonl'),
      JSON.stringify({ kind: 'viewer', ...sample }) + '\n',
    );
    if (popup.length) await item.page.keyboard.press('Escape');
    if (index % 25 === 24)
      console.log(JSON.stringify({ viewerCompleted: index + 1, latestMs: match.pixelMs }));
  }
  const jobs = await readdir(join(data, 'jobs')).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  assert.deepEqual(
    jobs.filter((n) => n.endsWith('.json')),
    [],
  );
  assert.equal(new Set(edits.map((e) => e.revision)).size, edits.length);
  const presentations = [];
  for (const item of projects)
    for (const [width, theme] of [
      [390, 'dark'],
      [1200, 'light'],
    ]) {
      await item.page.setViewportSize({ width, height: 960 });
      await item.page.emulateMedia({ reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
      const current = await call('story_inspect', { sessionId: item.sessionId });
      await call('story_control', {
        context: current.context,
        requestId: randomUUID(),
        commands: [{ type: 'theme', value: theme }],
      });
      const view = await call('story_inspect', {
        sessionId: item.sessionId,
        detail: 'presentation',
      });
      for (const key of ['clipped', 'unreadableText', 'layoutOverflow'])
        assert.deepEqual(view.state.presentation[key], []);
      await item.page.screenshot({ path: join(out, item.recipe + '-' + width + '.png') });
      presentations.push(view);
    }
  assert.deepEqual(errors, []);
  const receipt = {
    version: JSON.parse(await readFile(join(release, 'plugin.json'), 'utf8')).version,
    releaseInfo: JSON.parse(await readFile(join(release, 'release.json'), 'utf8')),
    authorTrials,
    viewerTrials,
    surface: 'owned Chromium SDK card; target page foregrounded before every clock',
    release,
    environment: { ...environment, loadAtFinish: loadavg() },
    cold,
    edits,
    viewer,
    presentations,
    errors,
  };
  const distribution = (key, samples = edits) => {
    const sorted = samples.map((e) => e[key] ?? Infinity).sort((a, b) => a - b);
    return {
      p50: Number.isFinite(sorted[Math.ceil(sorted.length * 0.5) - 1])
        ? sorted[Math.ceil(sorted.length * 0.5) - 1]
        : null,
      p95: Number.isFinite(sorted[Math.ceil(sorted.length * 0.95) - 1])
        ? sorted[Math.ceil(sorted.length * 0.95) - 1]
        : null,
      max: Number.isFinite(sorted.at(-1)) ? sorted.at(-1) : null,
      observed: samples.filter((e) => Number.isFinite(e[key])).length,
      samples: samples.length,
    };
  };
  receipt.metrics = {
    pixels: distribution('pixelMs'),
    sdk: distribution('callMs'),
    validationOverhead: distribution('observationMs'),
    ...(viewer.length && { viewer: distribution('pixelMs', viewer) }),
  };
  receipt.gates = {
    localOperationToBrowserPixels:
      receipt.metrics.pixels.observed === edits.length &&
      receipt.metrics.pixels.p95 !== null &&
      receipt.metrics.pixels.p95 <= 250,
    ...(viewer.length && {
      viewerInputToBrowserResponse:
        viewer.every((e) => e.observed) &&
        receipt.metrics.viewer.p95 !== null &&
        receipt.metrics.viewer.p95 <= 100,
    }),
  };
  await writeFile(join(out, 'acceptance.json'), JSON.stringify(receipt, null, 2));
  console.log(
    JSON.stringify({
      out,
      version: receipt.version,
      samples: edits.length,
      pixels: distribution('pixelMs'),
      sdk: distribution('callMs'),
      validationOverhead: distribution('observationMs'),
      viewer: viewer.length && distribution('pixelMs', viewer),
      errors,
    }),
  );
  assert(
    receipt.gates.localOperationToBrowserPixels,
    'p95 operation to actual browser pixels exceeds 250ms; all samples are retained',
  );
  if (viewer.length)
    assert(
      receipt.gates.viewerInputToBrowserResponse,
      'p95 trusted viewer input to browser response exceeds100ms; all samples are retained',
    );
} catch (error) {
  await writeFile(
    join(out, 'failure.json'),
    JSON.stringify(
      { out, release, cold, edits, viewer, errors, message: error.message, stack: error.stack },
      null,
      2,
    ),
  );
  console.error(
    JSON.stringify({
      out,
      error: error.message,
      authorSamples: edits.length,
      viewerSamples: viewer.length,
    }),
  );
  throw error;
} finally {
  await browser.close();
  await host.close();
}
