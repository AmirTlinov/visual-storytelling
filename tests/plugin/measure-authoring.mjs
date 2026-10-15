import { pluginHost } from './host.mjs';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../../tools/chromium.mjs';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { observeBrowserFrames } from './frame-observer.mjs';

const out = resolve('artifacts/slice13/input-frame-check/run-' + randomUUID());
await mkdir(out, { recursive: true });
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
const browser = await chromium.launch(chromiumLaunchOptions());
const call = async (name, args) => {
  const result = await host.client.callTool({ name, arguments: args });
  assert(!result.isError, JSON.stringify(result));
  return result.structuredContent;
};
const errors = [],
  projects = [],
  edits = [],
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
  for (let index = 0; index < Number(process.env.TRIALS ?? 200); index++) {
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
    const width = index < 67 ? 1200 : index < 134 ? 760 : 390;
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
    if (index % 25 === 24)
      console.log(JSON.stringify({ completed: index + 1, latestMs: elapsedMs }));
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
    release,
    cold,
    edits,
    presentations,
    errors,
  };
  const distribution = (key) => {
    const sorted = edits.map((e) => e[key]).sort((a, b) => a - b);
    return {
      p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted.at(-1),
    };
  };
  receipt.metrics = {
    pixels: distribution('pixelMs'),
    sdk: distribution('callMs'),
    validationOverhead: distribution('observationMs'),
  };
  receipt.gates = { localOperationToBrowserPixels: receipt.metrics.pixels.p95 <= 250 };
  await writeFile(join(out, 'acceptance.json'), JSON.stringify(receipt, null, 2));
  console.log(
    JSON.stringify({
      out,
      version: receipt.version,
      samples: edits.length,
      pixels: distribution('pixelMs'),
      sdk: distribution('callMs'),
      validationOverhead: distribution('observationMs'),
      errors,
    }),
  );
  assert(
    receipt.gates.localOperationToBrowserPixels,
    'p95 operation to actual browser pixels exceeds 250ms; all samples are retained',
  );
} finally {
  await browser.close();
  await host.close();
}
