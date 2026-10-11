import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { buildScene } from '../tools/build-pages.mjs';
import { serve } from '../tools/site.mjs';

test('readonly meanings retain provenance and selection without becoming pointer or keyboard controls', async () => {
  const bundle = await build({
    stdin: {
      contents: `import {describeObject,sceneObjects} from './src/scene-objects.ts';
import {semanticObjects3D} from './src/viewport/semantics.ts';
import * as T from 'three'; window.semantic={describeObject,sceneObjects,semanticObjects3D,T};`,
      resolveDir: resolve('.'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <svg width="300" height="100"><g id="vector" data-object="vector"><rect width="80" height="60"/><text x="10" y="40">3</text></g><g data-object="decoration"><path d="M100 10L150 10"/></g></svg>
      <button id="action" data-object="action">Navigate</button>
      <div id="panel" data-object="panel"><button id="embedded">Edit</button></div>
      <div id="stage" style="position:relative;width:200px;height:200px"><canvas width="200" height="200"></canvas></div>
    </main>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const { describeObject, sceneObjects, semanticObjects3D, T } = semantic;
      const root = document.querySelector('main'),
        vector = document.querySelector('#vector');
      const meaning = {
        label: 'A vector',
        interactive: false,
        value: () => [3, 2],
        inputs: () => ['x', 'y'],
        provenance: () => ({ precision: 'exact' }),
        source: { file: 'scene.js', line: 4 },
      };
      const first = describeObject(vector, meaning);
      describeObject(document.querySelector('#action'), { label: 'Navigate' });
      describeObject(document.querySelector('#panel'), { label: 'Editor', interactive: false });
      const objects = sceneObjects(root),
        events = [];
      root.addEventListener('pointerup', (event) =>
        events.push(['pointerup', event.defaultPrevented]),
      );
      root.addEventListener('keydown', (event) => events.push(['keydown', event.defaultPrevented]));
      document.querySelector('#embedded').addEventListener('click', () => events.push(['edit']));
      const scene = new T.Scene(),
        camera = new T.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.z = 4;
      camera.updateMatrixWorld(true);
      const mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
      scene.add(mesh);
      const stage = document.querySelector('#stage');
      const spatial = semanticObjects3D(
        stage,
        stage.querySelector('canvas'),
        scene,
        camera,
        () => {},
      );
      spatial.describe(mesh, 'cell', { label: 'A value', value: () => 12, interactive: false });
      spatial.render();
      window.lab = {
        objects,
        events,
        first,
        vector,
        meaning,
        spatial,
        mesh,
        promote: () => describeObject(vector, { ...meaning, interactive: true }),
        demote: () => describeObject(vector, meaning),
      };
    });
    const vector = page.locator('#vector');
    const presentation = () =>
      vector.evaluate((node) => ({
        role: node.getAttribute('role'),
        tab: node.getAttribute('tabindex'),
        pressed: node.getAttribute('aria-pressed'),
        label: node.getAttribute('aria-label'),
        selected: node.hasAttribute('data-selected'),
        highlight: node.hasAttribute('data-selection-highlight'),
      }));
    const objects = await page.evaluate(() => lab.objects.objects());
    assert.deepEqual(
      objects.map((object) => object.id),
      ['vector', 'action', 'panel', 'cell'],
    );
    assert.deepEqual(objects[0], {
      id: 'vector',
      label: 'A vector',
      value: [3, 2],
      inputs: ['x', 'y'],
      provenance: { precision: 'exact' },
      source: { file: 'scene.js', line: 4 },
      visible: true,
      unit: undefined,
      implementation: undefined,
    });
    await page.evaluate(() => lab.objects.select(['vector']));
    assert.deepEqual(await presentation(), {
      role: null,
      tab: null,
      pressed: null,
      label: 'A vector',
      selected: true,
      highlight: true,
    });
    await vector.click();
    await vector.dispatchEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await vector.dispatchEvent('click', { detail: 0, bubbles: true, cancelable: true });
    await page.locator('#embedded').click();
    assert.deepEqual(await page.evaluate(() => lab.objects.selected), ['vector']);
    assert.deepEqual(await page.evaluate(() => lab.events), [
      ['pointerup', false],
      ['keydown', false],
      ['pointerup', false],
      ['edit'],
    ]);
    await page.locator('#action').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => lab.objects.selected), ['action']);
    await page.evaluate(() => {
      const previous = lab.promote();
      lab.release = lab.demote();
      lab.first();
      previous();
      lab.objects.select(['vector']);
    });
    assert.deepEqual(await presentation(), {
      role: null,
      tab: null,
      pressed: null,
      label: 'A vector',
      selected: true,
      highlight: true,
    });
    const cell = page.locator('[data-object="cell"]');
    assert.equal(await cell.evaluate((node) => node.tagName), 'DIV');
    for (const name of ['role', 'tabindex', 'aria-pressed'])
      assert.equal(await cell.getAttribute(name), null);
    await page.evaluate(() => lab.objects.select(['cell']));
    await page.locator('canvas').click({ position: { x: 100, y: 100 } });
    assert.deepEqual(await page.evaluate(() => lab.objects.selected), ['cell']);
    assert.deepEqual(await page.evaluate(() => lab.events.at(-1)), ['pointerup', false]);
    assert.equal(await cell.getAttribute('data-selection-highlight'), '');
    await page.evaluate(() => {
      lab.objects.dispose();
      lab.spatial.dispose();
      lab.release();
      lab.mesh.geometry.dispose();
      lab.mesh.material.dispose();
    });
    assert.equal(await vector.getAttribute('aria-label'), null);
    assert.equal(await vector.getAttribute('data-selected'), null);
    assert.equal(await cell.count(), 0);
  } finally {
    await browser.close();
  }
});

test('manual SVG camera survives a hidden host and preserves its framing on resize', async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import { ViewportSVG } from './src/viewport/svg.ts'; window.mountCamera = ViewportSVG.mount;",
      resolveDir: resolve('.'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="host" style="width:400px;height:300px"><svg style="width:100%;height:100%" viewBox="0 0 400 300"><g data-camera-world data-camera-transform><rect width="100" height="100"/></g></svg></div>',
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      window.cameraView = window.mountCamera(document.querySelector('svg'));
      cameraView.shot({ target: { x: 0, y: 0, w: 100, h: 100 } });
    });
    await page.locator('svg').focus();
    await page.keyboard.press('ArrowLeft');
    const before = await page.evaluate(() => cameraView.pose);
    const layout = async (style) =>
      page.evaluate(async (style) => {
        Object.assign(document.querySelector('#host').style, style);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, style);
    await layout({ display: 'none' });
    await layout({ display: 'block' });
    assert.deepEqual(await page.evaluate(() => cameraView.pose), before);
    assert(await page.locator('svg rect').isVisible(), 'the drawing remains visible after return');
    await layout({ width: '800px', height: '600px' });
    assert.deepEqual(await page.evaluate(() => cameraView.pose), {
      s: before.s * 2,
      x: before.x * 2,
      y: before.y * 2,
    });
    assert(await page.locator('svg rect').isVisible());
    await page.evaluate(() => cameraView.dispose());
  } finally {
    await browser.close();
  }
});

test('SVG and chapter owners release drawing observers and theme subscriptions through their sole scene handle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-lifetime-'));
  let browser, server;
  try {
    for (const name of ['scene-shell', 'chapters'])
      await buildScene(resolve('tests/fixtures', name), join(directory, name), {
        sourcePackage: true,
      });
    server = await serve(directory);
    browser = await chromium.launch(chromiumLaunchOptions());
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const Native = ResizeObserver,
        active = new Set();
      window.liveObservers = active;
      window.ResizeObserver = class extends Native {
        observe(...args) {
          active.add(this);
          return super.observe(...args);
        }
        disconnect() {
          active.delete(this);
          return super.disconnect();
        }
      };
    });
    for (const name of ['scene-shell', 'chapters']) {
      await page.goto(`${server.url}/${name}/index.html`);
      await page.waitForFunction(() => !!document.querySelector('.ve-scene')?.scene);
      assert(await page.evaluate(() => liveObservers.size > 0));
      assert.equal(await page.evaluate(() => typeof window.explainer), 'undefined');
      const result = await page.evaluate(() => {
        const root = document.querySelector('.ve-scene'),
          scene = root.scene;
        scene.seek(2);
        const time = scene.currentTime;
        scene.dispose();
        scene.dispose();
        return {
          time,
          observers: liveObservers.size,
          connected: root.isConnected,
          published: !!root.scene,
          children: root.childElementCount,
        };
      });
      assert.deepEqual(result, {
        time: 2,
        observers: 0,
        connected: true,
        published: false,
        children: 0,
      });
    }
  } finally {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('attached presentation resources dispose once even when a subject fails to release', async () => {
  const bundle = await build({
    stdin: {
      contents: "import {mountScene} from './src/scene-handle.ts'; window.mountSubject=mountScene;",
      resolveDir: resolve('.'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="subject"></main>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(() => {
      const root = document.querySelector('#subject');
      const calls = [];
      const scene = mountSubject(root, {
        dispose() {
          calls.push('subject');
          throw new Error('Release failed');
        },
      });
      scene.onDispose(() => calls.push('frame'));
      const unregister = scene.onDispose(() => calls.push('removed'));
      unregister();
      scene.onDispose(() => calls.push('overflow'));
      let error;
      try {
        scene.dispose();
      } catch (cause) {
        error = cause.message;
      }
      scene.dispose();
      return { calls, error, published: Boolean(root.scene) };
    });
    assert.deepEqual(result, {
      calls: ['subject', 'frame', 'overflow'],
      error: 'Release failed',
      published: false,
    });
  } finally {
    await browser.close();
  }
});
