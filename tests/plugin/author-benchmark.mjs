import { pluginHost } from './host.mjs';
import { authoringTrials } from './authoring-trials.mjs';
import { observeBrowserFrames } from './frame-observer.mjs';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../../tools/chromium.mjs';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpus, totalmem, platform, arch, release as osRelease } from 'node:os';
import assert from 'node:assert/strict';

// Test-only transport and observation; document, text and controls belong to the agent.
export async function authorBenchmark({ release, output, model, reasoning }) {
  const out = resolve(output);
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out);
  const metadata = {
    release,
    model,
    reasoning,
    hardware: {
      cpu: cpus()[0].model,
      cores: cpus().length,
      memoryBytes: totalmem(),
      platform: platform(),
      arch: arch(),
      os: osRelease(),
    },
    plugin: JSON.parse(await readFile(join(release, 'plugin.json'))).version,
  };
  await writeFile(join(out, 'environment.json'), JSON.stringify(metadata, null, 2));
  const trials = authoringTrials(out, metadata),
    target = {},
    host = await pluginHost({
      dataDirectory: join(out, 'data'),
      serverCommand: join(release, 'runtime/node'),
      serverEntry: join(release, 'plugin/dist/server.mjs'),
      initialTarget: target,
    });
  const browser = await chromium.launch(chromiumLaunchOptions()),
    page = await browser.newPage({ viewport: { width: 1200, height: 960 } }),
    errors = [];
  let brief,
    first,
    interaction,
    observations = {},
    conditions = {},
    project,
    precedingProject,
    closed = false;
  page.on('pageerror', (e) => errors.push({ at: Date.now(), message: e.message }));
  const call = async (name, args) => {
    const started = Date.now(),
      request = { name, arguments: args };
    if (brief && name === 'story_control' && args.commands?.some((c) => c.type === 'parameters')) {
      frames.begin();
      interaction = { started };
    }
    const result = await host.client.callTool(request);
    trials.record(request, result, started);
    await appendFile(
      join(out, 'calls.jsonl'),
      JSON.stringify({ ...request, started, finished: Date.now(), trial: brief?.index, result }) +
        '\n',
    );
    const authored = result.structuredContent?.project;
    if (
      authored &&
      (!brief ||
        (name === 'story_create' && authored.id !== precedingProject) ||
        (name === 'story_edit' && authored.id === project?.id))
    )
      project = authored;
    return result;
  };
  const warm = await call('story_create', {
    title: 'Разложим предметы',
    document: { recipe: 'division', inputs: { count: 7, divisor: 3 }, chapters: [] },
    path: join(out, 'warmup'),
    requestId: randomUUID(),
  });
  assert(!warm.isError, JSON.stringify(warm));
  const opened = await call('story_open', { projectId: warm.structuredContent.project.id });
  target.sessionId = opened.structuredContent.sessionId;
  await page.goto(host.url);
  await page.locator('body').evaluate((b) => (b.style.maxWidth = 'none'));
  const root = () =>
    page.frameLocator('iframe[title="MCP App"]').frameLocator('#scene').locator('main.ve-scene');
  await root().waitFor();
  await root().evaluate(async (r) => await r.scene.ready?.());
  const frames = await observeBrowserFrames(page);
  const context = async () => {
    await page.waitForFunction(
      () => window.pluginTest.context?.structuredContent?.visualStory?.context,
    );
    return page.evaluate(() => window.pluginTest.context.structuredContent.visualStory.context);
  };
  const observe = async (label) => {
    assert(brief && project, 'Create this task in a new project before observing it.');
    assert(['first', 'initial', 'changed'].includes(label), 'Choose first, initial or changed.');
    assert(!Object.hasOwn(observations, label), 'A measured observation is immutable.');
    assert(first || label === 'first', 'Observe this task first before checking its result.');
    let result;
    const deadline = Date.now() + 15000;
    do {
      result = await call('story_inspect', { context: await context(), detail: 'model' });
      const s = result.structuredContent;
      if (
        !result.isError &&
        s.projectId === project.id &&
        s.shownSourceRevision === project.sourceRevision &&
        s.renderStatus === 'rendered'
      )
        break;
      if (Date.now() > deadline)
        throw Error(
          'The authored source was not shown before observation deadline: ' +
            JSON.stringify(result),
        );
      await new Promise((r) => setTimeout(r, 50));
    } while (true);
    const state = result.structuredContent.state,
      box = await root().locator('.ve-stage').boundingBox();
    assert(box?.width > 0);
    let png;
    if (!first) {
      const authored = await root().evaluate((r) => r.scene.authoring.document);
      trials.assertFirst(authored);
      const match = await frames.matchedDrawing(box, brief.start);
      first = {
        capturedAt: brief.start + match.pixelMs,
        pixelMs: match.pixelMs,
        projectId: project.id,
        sourceRevision: project.sourceRevision,
        context: result.structuredContent.context,
        authored,
        snapshot: state.snapshot,
      };
      png = match.png;
    } else if (label === 'changed' && interaction) {
      const match = await frames.matchedDrawing(box, interaction.started);
      interaction.capturedAt = interaction.started + match.pixelMs;
      interaction.pixelMs = match.pixelMs;
      png = match.png;
    } else png = await page.screenshot();
    const path = join(out, `trial-${brief.index}-${label}.png`);
    await writeFile(path, png);
    observations[label] = state.snapshot;
    const observedAt = Date.now();
    conditions[label] = {
      at: observedAt,
      values: structuredClone(state.rendering?.presented?.values),
    };
    await writeFile(
      join(out, `observation-${brief.index}-${label}.json`),
      JSON.stringify(
        {
          at: observedAt,
          state,
          context: result.structuredContent.context,
          first,
          interaction,
          path,
        },
        null,
        2,
      ),
    );
    return {
      png: png.toString('base64'),
      path,
      state,
      context: result.structuredContent.context,
      firstPixelMs: first.pixelMs,
      elapsedMs: Date.now() - brief.start,
    };
  };
  const actions = {
    async ready() {
      return {
        out,
        url: host.url,
        ...metadata,
        context: await context(),
        tools: (await host.client.listTools()).tools.filter((t) =>
          ['story_create', 'story_control', 'story_edit', 'story_inspect', 'story_help'].includes(
            t.name,
          ),
        ),
      };
    },
    async start() {
      brief = await trials.start({ context: await context() }, host.client);
      precedingProject = project?.id;
      project = undefined;
      frames.begin();
      first = interaction = undefined;
      observations = {};
      conditions = {};
      return brief;
    },
    async call(args) {
      const r = await call(args.name, args.arguments);
      return r;
    },
    async observe(args) {
      return observe(args.label);
    },
    async watch() {
      return root().evaluate(async (r) => {
        const deadline = performance.now() + (r.scene.duration + 10) * 1000;
        for (;;) {
          await r.scene.ready?.();
          const state = {
            time: r.scene.currentTime,
            duration: r.scene.duration,
            playing: r.scene.playing,
            waiting: r.scene.waiting,
          };
          if (!state.playing) return state;
          if (performance.now() > deadline) throw Error('Playback observation deadline');
          await new Promise((a) => setTimeout(a, 50));
        }
      });
    },
    async finish({ comments, error } = {}) {
      let authored;
      try {
        authored = await root().evaluate((r) => r.scene.authoring.document, undefined, {
          timeout: 2000,
        });
      } catch (failure) {
        error = [error, 'Cannot observe authored document: ' + failure.message]
          .filter(Boolean)
          .join('\n');
      }
      const result = await trials.finish({
        capturedAt: first?.capturedAt,
        interactionAt: interaction?.capturedAt,
        observations,
        conditions,
        authored,
        comments,
        error,
      });
      await appendFile(
        join(out, 'errors.jsonl'),
        JSON.stringify({ trial: brief.index, pageErrors: errors }) + '\n',
      );
      brief = undefined;
      return result;
    },
    async close() {
      if (closed) return { closed: true };
      if (brief)
        await actions.finish({ error: 'Benchmark closed before the active trial finished.' });
      await frames.close().catch(() => {});
      await browser.close();
      await host.close();
      closed = true;
      return { closed: true };
    },
  };
  const token = randomUUID();
  let pendingAction = Promise.resolve();
  const enqueue = (action, args) => {
    const pending = pendingAction.catch(() => {}).then(() => actions[action](args));
    pendingAction = pending;
    return pending;
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.headers['x-benchmark-token'] !== token) {
        res.writeHead(403).end();
        return;
      }
      let text = '';
      for await (const part of req) {
        text += part;
        if (text.length > 1000000) throw Error('Input too large');
      }
      const { action, ...args } = JSON.parse(text);
      if (!Object.hasOwn(actions, action)) throw Error('Unknown test action');
      const result = await enqueue(action, args);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
      if (action === 'close') server.close();
    } catch (e) {
      await appendFile(
        join(out, 'transport-errors.jsonl'),
        JSON.stringify({
          at: Date.now(),
          trial: brief?.index,
          message: e.message,
          stack: e.stack,
        }) + '\n',
      );
      res
        .writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = { url: 'http://127.0.0.1:' + server.address().port, token, out, card: host.url };
  await writeFile(join(out, 'endpoint.json'), JSON.stringify(endpoint, null, 2));
  return {
    endpoint,
    close: async () => {
      await enqueue('close');
      server.close();
    },
  };
}
