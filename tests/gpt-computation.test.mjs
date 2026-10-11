import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assetURLs } from '../tools/asset-urls.mjs';
import { sourceAliases } from '../tools/source-package.mjs';
import { forward, PRESETS, VOCAB } from '../examples/gpt-model/model.js';
import { computationPlan } from '../examples/gpt-model/computation.js';

test('visual GPT calculations equal the actual model and retain selected tensor addresses', () => {
  for (const preset of PRESETS.slice(0, 3)) {
    const trace = forward(preset.tokens);
    for (const block of [0, 1]) {
      for (const kind of ['projection', 'score', 'mix', 'residual', 'mlp', 'logit']) {
        const calculation = computationPlan({ trace, block, kind, head: 1, source: 1, channel: 5 });
        const a = [calculation.plan.result].flat();
        const b = [calculation.expected].flat();
        a.forEach((value, index) => assert.ok(Math.abs(value - b[index]) < 1e-10));
        for (const tensor of Object.values(calculation.inputs)) {
          assert.ok(tensor.values.every(Number.isFinite));
          assert.ok(tensor.values.every((value, i) => tensor.origin(i).value === value));
        }
      }
    }
  }
  const trace = forward(PRESETS[0].tokens);
  const score = computationPlan({ trace, kind: 'score', token: 3, source: 1 });
  assert.deepEqual(score.inputs.q.origin(2).address, [3, 2]);
  assert.deepEqual(score.inputs.k.origin(2).address, [1, 2]);
  const mix = computationPlan({ trace, kind: 'mix', token: 3, channel: 2 });
  assert.deepEqual(mix.inputs.a.origin(1).address, [3, 1]);
  assert.deepEqual(mix.inputs.v.origin(1).address, [1, 2]);
  const mlp = computationPlan({ trace, kind: 'mlp', token: 3, channel: 5 });
  assert.deepEqual(mlp.inputs.a.origin(17).address, [3, 17]);
  assert.deepEqual(mlp.inputs.w.origin(17).address, [17, 5]);
  for (const block of [0, 1]) {
    for (const projection of ['q', 'k', 'v']) {
      for (const head of [0, 1]) {
        for (const channel of [0, 3, 5, 7]) {
          const selected = computationPlan({
            trace,
            kind: 'projection',
            projection,
            block,
            head,
            channel,
            token: 3,
            source: 1,
          });
          const row = projection === 'q' ? 3 : 1;
          const column = ['q', 'k', 'v'].indexOf(projection) * 8 + head * 4 + (channel % 4);
          assert.equal(
            selected.expected,
            trace.blocks[block].attention.heads[head][projection][row][channel % 4],
          );
          assert.deepEqual(selected.inputs.x.origin(6).address, [row, 6]);
          assert.deepEqual(selected.inputs.w.origin(6).address, [6, column]);
          assert.ok(Math.abs(selected.plan.result - selected.expected) < 1e-10);
        }
      }
    }
  }
  assert.throws(
    () => computationPlan({ trace, kind: 'projection', projection: 'o' }),
    /Invalid Q\/K\/V/,
  );
  for (let candidate = 0; candidate < VOCAB.length; candidate++) {
    for (let token = 0; token < trace.ids.length; token++) {
      const logit = computationPlan({ trace, kind: 'logit', token, candidate });
      assert.equal(logit.expected, trace.logits[token][candidate]);
      assert.ok(Math.abs(logit.plan.result - logit.expected) < 1e-10);
      assert.deepEqual(logit.inputs.x.origin(6).address, [token, 6]);
      assert.deepEqual(logit.inputs.w.origin(6).address, [candidate, 6]);
      assert.equal(logit.inputs.w.origin(6).tensor, 'gpt:token-embedding');
    }
  }
  assert.throws(
    () => computationPlan({ trace, kind: 'logit', candidate: -1 }),
    /Invalid candidate/,
  );
});

test('the real MathMorph pane reverses delivery and changes calculation without a second clock', async (t) => {
  const bundle = await build({
    stdin: {
      contents: `
        import {mountComputation} from './examples/gpt-model/computation.js';
        import {forward, PRESETS} from './examples/gpt-model/model.js';
        import {SceneShell} from '@visual-storytelling/core';
        Object.assign(window,{mountComputation,forward,PRESETS,SceneShell});
      `,
      resolveDir: resolve('.'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    tsconfigRaw: { compilerOptions: {} },
    alias: sourceAliases,
    define: { 'import.meta.url': 'document.baseURI' },
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setContent(
    '<style>body{margin:0}#host{width:900px;height:520px;transform:scale(.75);transform-origin:top left;position:relative;--ve-ink:#292724;--ve-surface:#fff;--ve-purple:#735184;--ve-orange:#b45824;--ve-blue:#2c63a0;font:20px Arial}</style><div id="host"></div>',
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const states = await page.evaluate(() => {
    const pane = mountComputation(document.querySelector('#host'));
    const aperture = document.querySelector('#host').getBoundingClientRect();
    const pixels = document.querySelector('#host canvas').getBoundingClientRect();
    const dimensions = {
      host: [aperture.width, aperture.height],
      canvas: [pixels.width, pixels.height],
    };
    const trace = forward(PRESETS[0].tokens);
    const result = [];
    for (const kind of ['projection', 'score', 'mix', 'residual', 'mlp', 'logit']) {
      const state = { trace, kind, token: 3, source: 1, channel: 2, block: 1, head: 0 };
      pane.render({ ...state, progress: 0.31 });
      const before = pane.snapshot();
      pane.render({ ...state, progress: 1 });
      const end = pane.snapshot();
      pane.render({ ...state, progress: 0 });
      pane.render({ ...state, progress: 0.31 });
      const reversed = pane.snapshot();
      result.push({
        kind,
        reversible: JSON.stringify(before) === JSON.stringify(reversed),
        received: end.received,
        vector: Array.isArray(end.result),
      });
    }
    pane.render({ trace: forward(PRESETS[1].tokens), kind: 'score', progress: 1, reduced: true });
    const changed = pane.snapshot();
    pane.render({
      trace,
      kind: 'projection',
      projection: 'k',
      token: 3,
      source: 1,
      channel: 2,
      progress: 0.3,
    });
    const keyProjection = pane.snapshot();
    pane.render({
      trace,
      kind: 'projection',
      projection: 'v',
      token: 3,
      source: 1,
      channel: 2,
      progress: 0.3,
    });
    const valueProjection = pane.snapshot();
    pane.render({ trace, kind: 'logit', candidate: 7, progress: 0.3 });
    const firstCandidate = pane.snapshot();
    pane.render({ trace, kind: 'logit', candidate: 9, progress: 0.3 });
    const secondCandidate = pane.snapshot();
    document.querySelector('#host').style.width = '375px';
    pane.render({ trace: forward(PRESETS[1].tokens), kind: 'score', progress: 0.4, compact: true });
    const host = document.querySelector('#host');
    Object.assign(host.style, { width: '1200px', height: '432px', transform: 'scale(.640625)' });
    const framed = { trace, kind: 'mlp', token: 3, channel: 5 };
    pane.render({ ...framed, progress: 0 });
    const stages = pane.snapshot().stages;
    const framing = [];
    for (const stage of [0, 2, 30, 62, 64]) {
      const progress = ((stage + 0.2) / stages) * 0.82;
      pane.render({ ...framed, progress });
      const first = pane.view.capture();
      const distance = first.position[2] - first.target[2] - 0.7;
      const bodyHeight =
        (host.getBoundingClientRect().height * 1.4) / (2 * distance * Math.tan(Math.PI / 10));
      pane.render({ ...framed, progress: 1 });
      pane.render({ ...framed, progress });
      framing.push({
        bodyHeight,
        stable: JSON.stringify(first) === JSON.stringify(pane.view.capture()),
      });
    }
    pane.render({ ...framed, progress: 1 });
    const allInputs = pane.snapshot().origins;
    const players = document.querySelectorAll('[data-player],.ve-player').length;
    pane.dispose();
    pane.dispose();
    return {
      result,
      changed,
      projectionChanged:
        keyProjection.expected !== valueProjection.expected &&
        keyProjection.projection === 'k' &&
        valueProjection.projection === 'v',
      candidateChanged:
        firstCandidate.expected !== secondCandidate.expected &&
        firstCandidate.candidate === 7 &&
        secondCandidate.candidate === 9,
      framing,
      stages,
      originalTerms: allInputs.a.length,
      dimensions,
      players,
      remaining: document.querySelector('#host').childElementCount,
    };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(states.dimensions.canvas, states.dimensions.host);
  assert.ok(states.result.every((item) => item.reversible));
  assert.ok(states.result.filter((item) => !item.vector).every((item) => item.received));
  assert.equal(states.changed.received, true);
  assert.equal(states.projectionChanged, true);
  assert.equal(states.candidateChanged, true);
  assert.equal(states.stages, 65, 'a low display follows all 32 pairs, their sums and the bias');
  assert.equal(states.originalTerms, 32);
  assert.ok(states.framing.every((frame) => frame.bodyHeight >= 60));
  assert.ok(states.framing.every((frame) => frame.stable));
  assert.equal(states.players, 0);
  assert.equal(states.remaining, 0);

  const camera = await page.evaluate(async () => {
    const root = document.querySelector('#host');
    root.style.width = '900px';
    const shell = SceneShell.mount(root, { title: 'GPT camera', heading: false, paper: false });
    const host = document.createElement('div');
    Object.assign(host.style, { width: '900px', height: '520px', position: 'relative' });
    shell.stage.append(host);
    const pane = mountComputation(host);
    shell.attachView(pane.view);
    pane.render({ trace: forward(PRESETS[0].tokens), kind: 'score', progress: 0 });
    const authored = root.scene.capture();
    const subjects = root.scene.inspect({ presentation: false }).objects;
    const operand = subjects.find((object) => object.id === 'gpt-calculation:left:0');
    await root.scene.control([{ type: 'focus', ids: [operand.id] }]);
    const focused = root.scene.capture();
    pane.view.reset({ animate: false });
    const reset = root.scene.capture();
    await root.scene.restore(focused);
    const restored = root.scene.capture();
    const transition = root.scene.inspect({ presentation: false }).viewTransition;
    pane.setActive(false);
    const hidden = root.scene.capture();
    const inactiveCapabilities = root.scene.inspect({ presentation: false }).capabilities;
    const inactiveRestore = pane.view.restore(focused.view);
    pane.setActive(true);
    const activeCapabilities = root.scene.inspect({ presentation: false }).capabilities;
    const reactivated = root.scene.capture();
    shell.dispose();
    pane.dispose();
    const disposed = pane.view.capture();
    return {
      authored,
      operand,
      focused,
      reset,
      restored,
      transition,
      hidden,
      inactiveCapabilities,
      inactiveRestore,
      activeCapabilities,
      reactivated,
      disposed,
      remaining: host.childElementCount,
    };
  });
  assert.deepEqual(errors, []);
  assert.equal(camera.authored.view.kind, 'three');
  assert.equal(camera.authored.view.following, true);
  assert.equal(camera.operand.provenance.origins[0].source.tensor, 'gpt:block-0:head-0:q');
  assert.equal(camera.focused.view.following, false);
  assert.equal(camera.reset.view.following, true);
  for (const field of ['position', 'target'])
    camera.restored.view[field].forEach((value, i) =>
      assert.ok(Math.abs(value - camera.focused.view[field][i]) < 1e-10),
    );
  assert.equal(camera.transition, 'idle');
  assert.equal(camera.hidden.view, undefined);
  assert.equal(camera.inactiveCapabilities.includes('focus'), false);
  assert.equal(camera.inactiveRestore, false);
  assert.equal(camera.activeCapabilities.includes('focus'), true);
  assert.deepEqual(camera.reactivated.view, camera.restored.view);
  assert.equal(camera.disposed, undefined);
  assert.equal(camera.remaining, 0);
});
