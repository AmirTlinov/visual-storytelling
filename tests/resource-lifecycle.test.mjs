import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { releaseResources } from '../dist/lifecycle.js';
import { physicsRuntime } from '../dist/physics/runtime.js';
import { bodyLifetime } from '../dist/physics/body.js';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';
import { serve } from '../tools/site.mjs';

test('release errors retain their identity and every remaining owner runs', () => {
  const first = new Error('first'),
    second = new Error('second'),
    calls = [];
  assert.throws(
    () =>
      releaseResources(
        [
          () => {
            calls.push(1);
            throw first;
          },
          () => {
            calls.push(2);
            throw second;
          },
          () => calls.push(3),
        ],
        'release',
      ),
    (error) =>
      error instanceof AggregateError && error.errors[0] === first && error.errors[1] === second,
  );
  assert.deepEqual(calls, [1, 2, 3]);
  assert.throws(
    () =>
      releaseResources(
        [
          () => {
            throw first;
          },
        ],
        'release',
      ),
    (error) => error === first,
  );
});

test('physics world frees native bodies and world once after cleanup failures', () => {
  const calls = [],
    first = new Error('world callback'),
    second = new Error('body callback');
  const raw = {
    timestep: 0,
    step() {},
    takeSnapshot: () => new Uint8Array(),
    free: () => calls.push('free'),
  };
  const world = physicsRuntime(raw, () => raw);
  const body = bodyLifetime(world, 'body', {
    awake: () => true,
    remove() {
      assert.equal(world.raw, raw, 'native owner remains accessible during body release');
      calls.push('native');
    },
  });
  body.onDispose(() => {
    calls.push('body first');
    throw second;
  });
  body.onDispose(() => calls.push('body last'));
  world.onDispose(() => {
    calls.push('world first');
    throw first;
  });
  world.onDispose(() => calls.push('world last'));
  assert.throws(
    () => world.dispose(),
    (error) =>
      error instanceof AggregateError && error.errors[0] === first && error.errors[1] === second,
  );
  world.dispose();
  body.dispose();
  assert.deepEqual(calls, [
    'world first',
    'world last',
    'body first',
    'body last',
    'native',
    'free',
  ]);
  assert.equal(world.disposed, true);
  assert.equal(body.disposed, true);
  assert.equal(world.size, 0);
});

test('world cleanup releases a participant registered during disposal', () => {
  const calls = [],
    first = new Error('world cleanup'),
    second = new Error('late body');
  const raw = {
    timestep: 0,
    step() {},
    takeSnapshot: () => new Uint8Array(),
    free: () => calls.push('free'),
  };
  const world = physicsRuntime(raw, () => raw);
  let late;
  world.onDispose(() => {
    late = bodyLifetime(world, 'late', { awake: () => false, remove: () => calls.push('native') });
    late.onDispose(() => {
      calls.push('late callback');
      throw second;
    });
    throw first;
  });
  assert.throws(
    () => world.dispose(),
    (error) =>
      error instanceof AggregateError && error.errors[0] === first && error.errors[1] === second,
  );
  assert.equal(late.disposed, true);
  assert.equal(world.size, 0);
  world.dispose();
  late.dispose();
  assert.deepEqual(calls, ['late callback', 'native', 'free']);
});

test('drawing owners finish disposal and accepted math replacement survives old cleanup failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'resource-lifetime-'));
  let browser, server;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import './dist/style.css';
      import {surface, SceneShell, MathMorph} from './dist/index.js';
      import {Viewport3D, ThreeKit as T} from './dist/viewport/index.js';
      import {characterRenderer} from './dist/characters/renderer.js';
      import {chibi} from './dist/characters/packs/chibi.js';
      window.api={surface,SceneShell,MathMorph,Viewport3D,T,characterRenderer,chibi};
      window.ready=SceneShell.ready();
    `,
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'index.js'),
      loader: { '.woff2': 'dataurl' },
      plugins: [assetURLs()],
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="index.css"></head><body><main style="width:900px;height:700px"></main><script src="index.js"></script></body></html>',
    );
    server = await serve(directory);
    browser = await chromium.launch(chromiumLaunchOptions());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const Native = ResizeObserver,
        active = new Set();
      window.activeObservers = active;
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
    await page.goto(server.url);
    await page.evaluate(() => window.ready);
    const result = await page.evaluate(async () => {
      const { surface, SceneShell, MathMorph, Viewport3D, T, characterRenderer, chibi } = api;
      const parent = document.querySelector('main'),
        calls = [];
      const surfaceError = new Error('surface');
      const sheet = surface(parent, {
        id: 'failure-sheet',
        width: 300,
        height: 200,
        title: 'Sheet',
        description: 'Lifecycle',
        grid: false,
      });
      sheet.onDispose(() => {
        calls.push('surface first');
        throw surfaceError;
      });
      sheet.onDispose(() => calls.push('surface last'));
      let sameSurfaceError = false;
      try {
        sheet.dispose();
      } catch (error) {
        sameSurfaceError = error === surfaceError;
      }
      sheet.dispose();
      const view = Viewport3D.mount(parent),
        geometry = new T.BoxGeometry(),
        material = new T.MeshBasicMaterial();
      view.setObject(new T.Mesh(geometry, material));
      geometry.addEventListener('dispose', () => calls.push('geometry'));
      material.addEventListener('dispose', () => calls.push('material'));
      const releaseRenderer = view.renderer.dispose.bind(view.renderer);
      view.renderer.dispose = () => {
        calls.push('renderer');
        releaseRenderer();
      };
      const viewError = new Error('viewport');
      view.onDispose(() => {
        calls.push('view first');
        throw viewError;
      });
      view.onDispose(() => calls.push('view last'));
      let sameViewError = false;
      try {
        view.dispose();
      } catch (error) {
        sameViewError = error === viewError;
      }
      view.dispose();
      const released = {
        svg: parent.querySelectorAll('svg').length,
        canvas: parent.querySelectorAll('canvas').length,
        observers: activeObservers.size,
      };
      const mountForFailure = Viewport3D.mount,
        initializationError = new Error('initial sample'),
        cleanupError = new Error('failed mount cleanup');
      Viewport3D.mount = (...args) => {
        const view = mountForFailure(...args);
        view.onDispose(() => {
          throw cleanupError;
        });
        return view;
      };
      let retainedInitializationErrors = false;
      try {
        const failedPlan = {
          ...MathMorph.plan(MathMorph.add(2, 4)),
          sample() {
            throw initializationError;
          },
        };
        await MathMorph.mount(parent, failedPlan);
      } catch (error) {
        retainedInitializationErrors =
          error instanceof AggregateError &&
          error.errors[0] === initializationError &&
          error.errors[1] === cleanupError;
      } finally {
        Viewport3D.mount = mountForFailure;
      }
      const failedMountReleased = parent.childElementCount === 0 && activeObservers.size === 0;
      const shell = SceneShell.mount(parent, { title: 'Replacement' });
      const mount = Viewport3D.mount,
        oldError = new Error('retired view');
      Viewport3D.mount = (...args) => {
        const view = mount(...args);
        view.onDispose(() => {
          calls.push('old view');
          throw oldError;
        });
        return view;
      };
      let math;
      try {
        math = await MathMorph.mount(shell.stage, MathMorph.add(2, 4));
      } finally {
        Viewport3D.mount = mount;
      }
      const replacement = MathMorph.integral('x^2', 0, 3);
      let sameRetirementError = false;
      try {
        math.setOperation(replacement);
      } catch (error) {
        sameRetirementError = error === oldError;
      }
      const frame = math.render(1);
      const accepted = math.plan === replacement && frame.formula.length > 0;
      const presentations = math.element.children.length;
      const oldCanvas = math.element.querySelectorAll('.ve-math-view canvas').length;
      math.dispose();
      math.dispose();
      shell.dispose();
      const graphics = await characterRenderer(chibi),
        assetError = new Error('character geometry');
      const geometries = new Set(),
        materials = new Set();
      graphics.data.object.traverse((node) => {
        if (node.isSkinnedMesh) {
          geometries.add(node.geometry);
          materials.add(node.material);
        }
      });
      let releasedGeometry = 0,
        releasedMaterials = 0,
        releasedTextures = 0,
        releasedCompositor = 0;
      for (const geometry of geometries)
        geometry.addEventListener('dispose', () => releasedGeometry++);
      for (const material of materials)
        material.addEventListener('dispose', () => releasedMaterials++);
      for (const texture of graphics.data.pages)
        texture.addEventListener('dispose', () => releasedTextures++);
      geometries
        .values()
        .next()
        .value.addEventListener('dispose', () => {
          throw assetError;
        });
      const disposeCompositor = graphics.renderer.dispose;
      graphics.renderer.dispose = () => {
        releasedCompositor++;
        disposeCompositor();
      };
      let sameAssetError = false;
      try {
        graphics.dispose();
      } catch (error) {
        sameAssetError = error === assetError;
      }
      graphics.dispose();
      const character = {
        sameAssetError,
        releasedGeometry,
        expectedGeometry: geometries.size,
        releasedMaterials,
        expectedMaterials: materials.size,
        releasedTextures,
        expectedTextures: graphics.data.pages.length,
        releasedCompositor,
      };
      return {
        calls,
        sameSurfaceError,
        sameViewError,
        retainedInitializationErrors,
        failedMountReleased,
        released,
        sameRetirementError,
        accepted,
        presentations,
        oldCanvas,
        finalObservers: activeObservers.size,
        children: parent.childElementCount,
        character,
      };
    });
    assert.equal(result.sameSurfaceError, true);
    assert.equal(result.sameViewError, true);
    assert.equal(result.retainedInitializationErrors, true);
    assert.equal(result.failedMountReleased, true);
    assert.deepEqual(result.released, { svg: 0, canvas: 0, observers: 0 });
    assert.equal(result.sameRetirementError, true);
    assert.equal(result.accepted, true);
    assert.equal(result.presentations, 1);
    assert.equal(result.oldCanvas, 0);
    assert.equal(result.finalObservers, 0);
    assert.equal(result.children, 0);
    assert.equal(result.character.sameAssetError, true);
    assert.equal(result.character.releasedGeometry, result.character.expectedGeometry);
    assert.equal(result.character.releasedMaterials, result.character.expectedMaterials);
    assert.equal(result.character.releasedTextures, result.character.expectedTextures);
    assert.equal(result.character.releasedCompositor, 1);
    for (const name of [
      'surface first',
      'surface last',
      'view first',
      'view last',
      'geometry',
      'material',
      'renderer',
      'old view',
    ])
      assert.equal(result.calls.filter((value) => value === name).length, 1, name);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
