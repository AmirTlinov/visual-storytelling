import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { PNG } from 'pngjs';
import { develop } from '../tools/dev.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('replacing a 3D subject retains shared resources and their theme until final disposal', async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import { Viewport3D } from './src/viewport/three.ts'; import * as T from './src/viewport/engine.ts'; window.mount3D = Viewport3D.mount; window.Kit = T;",
      resolveDir: resolve('.'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    plugins: [assetURLs()],
    define: { 'import.meta.url': 'document.baseURI' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="host" style="width:400px;height:300px;--ve-surface:white;--ve-ink:black;--ve-blue:#0000ff"></div>',
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const T = Kit;
      window.resourceCounts = {};
      const watch = (name, resource) => {
        resourceCounts[name] = 0;
        resource.addEventListener('dispose', () => resourceCounts[name]++);
        return resource;
      };
      const texture = (name) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        context.fillStyle = 'white';
        context.fillRect(0, 0, 1, 1);
        return watch(name, new T.CanvasTexture(canvas));
      };
      window.view = mount3D(document.querySelector('#host'));
      const geometry = watch('sharedGeometry', new T.BoxGeometry());
      const sharedTexture = texture('sharedTexture'),
        otherTexture = texture('otherTexture');
      window.material = watch(
        'sharedMaterial',
        view.ink(new T.MeshBasicMaterial({ map: sharedTexture }), 'blue'),
      );
      const oldGeometry = watch('oldGeometry', new T.SphereGeometry());
      const oldMaterial = watch(
        'oldMaterial',
        view.ink(new T.MeshBasicMaterial({ map: otherTexture })),
      );
      const old = new T.Group();
      old.add(new T.Mesh(geometry, material), new T.Mesh(oldGeometry, oldMaterial));
      view.setObject(old);
      // This texture remains in use outside the replaced subject, through another material.
      view.scene.add(
        new T.Mesh(new T.PlaneGeometry(), new T.MeshBasicMaterial({ map: otherTexture })),
      );
      const next = new T.Mesh(geometry, material);
      view.setObject(next);
      // Wrapping the current subject does not remove it or its resources.
      const wrapper = new T.Group();
      wrapper.add(next);
      view.setObject(wrapper);
      document.querySelector('#host').style.setProperty('--ve-blue', '#00ff00');
    });
    await page.waitForFunction(() => view.palette.blue.getHexString() === '00ff00');
    assert.equal(await page.evaluate(() => material.color.getHexString()), '00ff00');
    assert.deepEqual(await page.evaluate(() => resourceCounts), {
      sharedGeometry: 0,
      sharedTexture: 0,
      otherTexture: 0,
      sharedMaterial: 0,
      oldGeometry: 1,
      oldMaterial: 1,
    });
    const releases = await page.evaluate(() => {
      view.dispose();
      view.dispose();
      return resourceCounts;
    });
    assert(
      Object.values(releases).every((count) => count === 1),
      JSON.stringify(releases),
    );
  } finally {
    await browser.close();
  }
});

test('transparent packed annotations neither displace visible labels nor enlarge their shot', async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import { Viewport3D } from './src/viewport/three.ts'; import * as T from './src/viewport/engine.ts'; window.Kit = { Viewport3D, T };",
      resolveDir: resolve('.'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    plugins: [assetURLs()],
    define: { 'import.meta.url': 'document.baseURI' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<main class="ve-scene" style="position:relative;width:400px;height:300px;--ve-surface:white;--ve-ink:black"></main>',
    );
    await page.addStyleTag({ path: 'src/styles/scene-shell.css' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const initial = await page.evaluate(async () => {
      const { Viewport3D, T } = Kit;
      const view = Viewport3D.mount(document.querySelector('main'));
      const cube = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
      view.setObject(cube);
      const current = view.label('Текущий шаг', cube, { avoidOverlap: true, order: 1, size: 20 });
      const sample = async (reduced = false) => {
        view.shot({ target: cube, direction: [0, 0, 1], reduced });
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        return {
          top: current.element.parentElement.getBoundingClientRect().top,
          position: view.camera.position.toArray(),
          target: view.controls.target.toArray(),
        };
      };
      window.lab = { view, cube, current, sample, T };
      return sample();
    });
    const transparent = await page.evaluate(async () => {
      const { view, cube, T, sample } = lab;
      const next = view.label('Следующий шаг', cube, { avoidOverlap: true, order: 0, size: 20 });
      next.opacity(0);
      const far = new T.Object3D();
      far.position.y = 100;
      cube.add(far);
      const future = view.label('Далёкий будущий шаг', far, { avoidOverlap: true, size: 20 });
      future.opacity(0);
      Object.assign(lab, { next, future });
      const shot = await sample();
      return { shot, hidden: [next.element.hidden, future.element.hidden] };
    });
    assert.deepEqual(transparent.shot, initial, 'transparent labels must not reserve screen space');
    assert.deepEqual(transparent.hidden, [true, true]);

    const frames = new Map();
    for (const alpha of [0, 0.000001, 0.01, 0.25, 0.5, 1, 0.5, 0.25, 0.01, 0.000001, 0]) {
      const frame = await page.evaluate(async (alpha) => {
        lab.next.opacity(alpha);
        const shot = await lab.sample();
        const style = getComputedStyle(lab.next.element.parentElement);
        const lower = lab.current.element.parentElement.getBoundingClientRect();
        const upper = lab.next.element.parentElement.getBoundingClientRect();
        return {
          shot,
          hidden: lab.next.element.hidden,
          alpha: style.display === 'none' ? 0 : Number(style.opacity),
          clearance: lower.top - upper.bottom,
        };
      }, alpha);
      assert.equal(frame.hidden, alpha === 0);
      if (alpha > 0) {
        assert.equal(frame.alpha, alpha, 'fractional fades retain their authored opacity');
      } else assert.deepEqual(frame.shot, initial);
      if (frames.has(alpha)) assert.deepEqual(frame, frames.get(alpha), 'rewind is history-free');
      frames.set(alpha, frame);
    }
    assert.ok(
      Math.abs(frames.get(0.000001).shot.top - initial.top) < 0.1,
      'an imperceptible neighbour cannot abruptly move the visible label',
    );
    let displacement = 0;
    for (const alpha of [0.01, 0.25, 0.5, 1]) {
      const next = frames.get(alpha).shot.top - initial.top;
      assert.ok(next > displacement, 'clearance grows continuously with visible opacity');
      displacement = next;
    }
    assert.ok(frames.get(0.01).shot.top - initial.top < 0.5);
    assert.ok(frames.get(1).clearance >= 7.9, 'opaque annotations retain the full readable gap');
    const refitted = await page.evaluate(async () => {
      lab.future.opacity(1);
      const visible = await lab.sample();
      lab.future.opacity(0);
      return { visible, hidden: await lab.sample(), reduced: await lab.sample(true) };
    });
    assert(refitted.visible.position[2] > initial.position[2] * 10);
    assert.deepEqual(refitted.hidden, initial);
    assert.deepEqual(refitted.reduced, initial);
    await page.evaluate(() => lab.view.dispose());
    assert.equal(await page.locator('.ve-annotation').count(), 0);
  } finally {
    await browser.close();
  }
});

test('a fixed shot envelope reserves hidden titles without exposing them or following moving geometry', async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import { Viewport3D } from './src/viewport/three.ts'; import * as T from './src/viewport/engine.ts'; window.Kit = { Viewport3D, T };",
      resolveDir: resolve('.'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    plugins: [assetURLs()],
    define: { 'import.meta.url': 'document.baseURI' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<main class="ve-scene" style="position:relative;width:390px;height:600px;font-family:sans-serif;--ve-surface:white;--ve-ink:black"></main>',
    );
    await page.addStyleTag({ path: 'src/styles/scene-shell.css' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const initial = await page.evaluate(async () => {
      const { Viewport3D, T } = Kit;
      const stage = document.querySelector('main');
      const view = Viewport3D.mount(stage);
      const root = new T.Group();
      const moving = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
      const future = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
      moving.position.set(-2, -1, 0);
      future.position.set(2, 3, 0);
      future.visible = false;
      root.add(moving, future);
      const offset = [0, 0];
      const title = view.label(
        'Будущий результат сохраняет исходные адреса измерений',
        {
          object: future,
          position: () => {
            offset[1] = -(title.element.offsetHeight / 2 + 12);
            return new T.Vector3(0, 0.5, 0);
          },
        },
        { size: 20, avoidOverlap: true, offset },
      );
      view.setObject(root, { fitView: false });
      const bounds = new T.Box3(new T.Vector3(-3, -3, -1), new T.Vector3(3, 3.5, 1));
      const shot = () => view.shot({ target: root, bounds, direction: [0, 0, 1], padding: 24 });
      const frame = () =>
        new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const visibility = () => ({
        textHidden: title.element.hidden,
        groupHidden: title.element.parentElement.hidden,
        display: getComputedStyle(title.element.parentElement).display,
        visibility: title.element.parentElement.style.visibility,
      });
      const pose = () => ({
        position: view.camera.position.toArray(),
        target: view.controls.target.toArray(),
      });
      shot();
      await frame();
      const before = visibility();
      shot();
      const after = visibility();
      window.lab = { stage, view, moving, future, title, shot, frame, visibility, pose };
      return { before, after, pose: pose() };
    });
    assert.deepEqual(
      initial.before,
      initial.after,
      'framing restores hidden/display state synchronously',
    );
    assert.deepEqual(initial.after, {
      textHidden: true,
      groupHidden: true,
      display: 'none',
      visibility: '',
    });
    for (const state of [
      { object: true, title: false, opacity: 1, x: 0, scale: 2 },
      { object: true, title: true, opacity: 0, x: -1, scale: 1 },
      { object: true, title: true, opacity: 1, x: 1, scale: 1.5 },
      { object: false, title: true, opacity: 1, x: -2, scale: 1 },
    ]) {
      const current = await page.evaluate(async (state) => {
        const { future, moving, title, shot, frame, pose, visibility, stage } = lab;
        future.visible = state.object;
        title.show(state.title);
        title.opacity(state.opacity);
        moving.position.x = state.x;
        moving.scale.setScalar(state.scale);
        shot();
        await frame();
        const before = visibility();
        shot();
        const after = visibility();
        const bounds = title.element.parentElement.getBoundingClientRect();
        const host = stage.getBoundingClientRect();
        return {
          pose: pose(),
          before,
          after,
          height: bounds.height,
          inside:
            bounds.left >= host.left + 23 &&
            bounds.right <= host.right - 23 &&
            bounds.top >= host.top + 23 &&
            bounds.bottom <= host.bottom - 23,
        };
      }, state);
      assert.deepEqual(
        current.pose,
        initial.pose,
        'neither geometry nor title visibility changes a fixed shot',
      );
      assert.deepEqual(current.before, current.after, 'measuring a title never exposes its DOM');
      const visible = state.object && state.title && state.opacity > 0;
      assert.equal(current.after.textHidden, !visible);
      assert.equal(current.after.groupHidden, !visible);
      if (visible) {
        assert(current.height > 40, 'the title is measured as multiple wrapped lines');
        assert(current.inside, 'the complete future title was reserved from the opening frame');
      }
    }
    await page.evaluate(() => lab.view.dispose());
    assert.equal(await page.locator('.ve-annotation').count(), 0);
  } finally {
    await browser.close();
  }
});

test('computed local labels share framing, semantics and lifetime with their reparented object', async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import { Viewport3D } from './src/viewport/three.ts'; import * as T from './src/viewport/engine.ts'; window.lib = { Viewport3D, T };",
      resolveDir: resolve('.'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    plugins: [assetURLs()],
    define: { 'import.meta.url': 'document.baseURI' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(
      '<main class="ve-scene" style="position:relative;width:800px;height:400px;--ve-surface:white;--ve-ink:black"></main>',
    );
    await page.addStyleTag({ path: 'src/styles/scene-shell.css' });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(async () => {
      const { Viewport3D, T } = lib;
      const stage = document.querySelector('main'),
        view = Viewport3D.mount(stage);
      const root = new T.Group(),
        left = new T.Group(),
        right = new T.Group();
      root.add(left, right);
      root.rotation.set(0.1, 0.2, 0.15);
      root.position.set(0.4, -0.2, 0.3);
      left.rotation.y = 0.3;
      left.scale.set(1.2, 0.8, 1.1);
      right.position.x = 1;
      right.rotation.z = -0.2;
      const cube = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
      cube.position.set(0.2, 0.1, 0);
      left.add(cube);
      view.setObject(root);
      view.describe(left, 'left', { label: 'First subject' });
      view.describe(right, 'right', { label: 'Second subject' });
      const point = new T.Vector3(0.1, 1.5, 0);
      const anchor = { object: cube, position: () => point };
      const label = view.label('Вычисляемая локальная позиция', anchor, {
        size: 18,
        frame: { padding: [13, 6] },
      });
      const ink = view.label(
        'Локальная надпись',
        { object: cube, position: point },
        { space: 'world', height: 0.2 },
      );
      const independent = view.label('World', () => new T.Vector3(), { visible: () => false });
      const settle = () =>
        new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const shot = () => view.shot({ target: cube, direction: [0, 0, 1], padding: 24 });
      function snapshot() {
        const world = cube.localToWorld(point.clone());
        const p = world.clone().project(view.camera);
        const box = label.element.parentElement.getBoundingClientRect(),
          frame = stage.getBoundingClientRect();
        return {
          hidden: [label.element.hidden, ink.element.hidden],
          subject: label.element.dataset.object,
          drift: Math.hypot(
            box.x + box.width / 2 - frame.x - ((p.x + 1) * frame.width) / 2,
            box.y + box.height / 2 - frame.y - ((1 - p.y) * frame.height) / 2,
          ),
          inkDrift: ink.object.getWorldPosition(new T.Vector3()).distanceTo(world),
          inkLocal: ink.object.position.toArray(),
          point: point.toArray(),
          gaps: [
            box.left - frame.left,
            frame.right - box.right,
            box.top - frame.top,
            frame.bottom - box.bottom,
          ],
        };
      }
      window.lab = {
        stage,
        view,
        root,
        left,
        right,
        cube,
        point,
        label,
        ink,
        independent,
        shot,
        snapshot,
        settle,
        T,
      };
      shot();
      await settle();
    });
    const check = async (subject = 'left') => {
      const sample = await page.evaluate(async () => {
        await lab.settle();
        return lab.snapshot();
      });
      assert.deepEqual(sample.hidden, [false, false]);
      assert.equal(sample.subject, subject);
      assert(sample.drift < 0.1, JSON.stringify(sample));
      assert(sample.inkDrift < 1e-9, JSON.stringify(sample));
      assert.deepEqual(sample.inkLocal, sample.point, 'Sampling must not mutate the local point');
      assert(
        sample.gaps.every((gap) => gap >= 23.9),
        JSON.stringify(sample),
      );
    };
    await check();
    for (const width of [375, 520, 800]) {
      await page.evaluate(
        (width) =>
          new Promise((done) => {
            const stop = lab.view.onRender(() => {
              if (lab.view.camera.aspect === width / lab.stage.clientHeight) {
                stop();
                done();
              }
            });
            lab.stage.style.width = width + 'px';
          }),
        width,
      );
      await check();
    }
    await page.evaluate(() => {
      lab.point.set(-0.4, 1.1, 0.2);
      lab.shot();
    });
    await check();
    for (const visible of [false, true]) {
      await page.evaluate((visible) => {
        lab.left.visible = visible;
        lab.view.invalidate();
      }, visible);
      await page.evaluate(() => lab.settle());
      assert.deepEqual(await page.evaluate(() => lab.snapshot().hidden), [!visible, !visible]);
    }
    await page.evaluate(() => {
      lab.right.add(lab.cube);
      lab.shot();
    });
    await check('right');
    await page.evaluate(() => {
      lab.cube.removeFromParent();
      lab.view.invalidate();
    });
    await page.evaluate(() => lab.settle());
    assert.deepEqual(await page.evaluate(() => lab.snapshot().hidden), [true, true]);
    await page.evaluate(() => {
      lab.right.add(lab.cube);
      // Promoting a retained subtree must keep the same annotation and GPU resources.
      lab.view.setObject(lab.right, { fitView: false });
      lab.shot();
    });
    await check('right');
    const nextShot = await page.evaluate(async () => {
      lab.label.opacity(0);
      lab.point.set(-0.7, 3, 0.3);
      lab.ink.set('Свежая надпись после переноса локальной точки');
      lab.shot();
      await lab.settle();
      const plane = lab.ink.object.children[0];
      return [-0.5, 0.5].flatMap((x) =>
        [-0.5, 0.5].map((y) => {
          const p = new lab.T.Vector3(x, y, 0)
            .applyMatrix4(plane.matrixWorld)
            .project(lab.view.camera);
          return [
            ((p.x + 1) * lab.stage.clientWidth) / 2,
            ((1 - p.y) * lab.stage.clientHeight) / 2,
          ];
        }),
      );
    });
    assert(
      nextShot.every(([x, y]) => x >= 23.9 && x <= 800 - 23.9 && y >= 23.9 && y <= 400 - 23.9),
      'The next shot must measure the moved inscription and its new text: ' +
        JSON.stringify(nextShot),
    );
    const replaced = await page.evaluate(async () => {
      const { view, ink, label, independent, T } = lab;
      const counts = [];
      for (const resource of [
        ink.object.children[0].geometry,
        ink.object.children[0].material,
        ink.object.children[0].material.map,
      ]) {
        const count = { value: 0 };
        counts.push(count);
        resource.addEventListener('dispose', () => count.value++);
      }
      view.setObject(new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()));
      await lab.settle();
      const result = {
        label: label.element.isConnected,
        ink: ink.element.isConnected,
        independent: independent.element.isConnected,
        released: counts.map((c) => c.value),
      };
      view.dispose();
      label.remove();
      ink.remove();
      return {
        ...result,
        releasedAfterDispose: counts.map((c) => c.value),
        remaining: lab.stage.querySelectorAll('.ve-annotation,.ve-surface-label').length,
      };
    });
    assert.deepEqual(replaced, {
      label: false,
      ink: false,
      independent: true,
      released: [1, 1, 1],
      releasedAfterDispose: [1, 1, 1],
      remaining: 0,
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('3D annotations stay readable, attached and non-intercepting during orbit and pan', async () => {
  const source = await mkdtemp(join(tmpdir(), 'story-annotations-'));
  let server, browser;
  try {
    await writeFile(
      join(source, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"></head><body class="ve-standalone"><main class="ve-scene"></main><script type="module" src="scene.js"></script></body></html>',
    );
    await writeFile(
      join(source, 'scene.js'),
      `
      import { SceneShell } from '@visual-storytelling/core';
      import { Viewport3D, ThreeKit as T } from '@visual-storytelling/core/three';
      import '@visual-storytelling/core/style.css';
      window.galleryReady = (async () => {
        await SceneShell.ready();
        const shell = SceneShell.mount(document.querySelector('main'), {title:'Annotations'});
        const view = Viewport3D.mount(shell.stage), group = new T.Group();
        const cube = new T.Mesh(new T.BoxGeometry(1,1,1), view.ink(new T.MeshBasicMaterial(), 'blue-wash'));
        const anchor = new T.Object3D(); anchor.position.y = 1.3;
        cube.add(anchor); group.add(cube); view.setObject(group);
        view.shot({target: new T.Box3(new T.Vector3(-2,-2,-2), new T.Vector3(2,2,2)), direction:[0,0,1]});
        const number = view.label('−12.34', cube, {face:['front','back']});
        const formula = view.label('ReLU: x < 0 → 0', anchor, {tone:'purple', frame:{padding:[15,8]}});
        const cover = new T.Mesh(new T.BoxGeometry(1.1,1.1,.05), view.ink(new T.MeshBasicMaterial(), 'orange'));
        cover.position.z = .4; cover.visible = false; group.add(cover);
        window.lab = {view, group, cube, anchor, cover, number, formula, T};
      })();
    `,
    );
    server = await develop(source, 0, { sourcePackage: true });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 650 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.lab);
    await page.evaluate(() => window.galleryReady);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    const attachments = await page.evaluate(() =>
      lab.number.object.children.map((p) => ({ id: p.uuid, local: p.matrix.toArray() })),
    );
    // A subject's registered annotations belong to its shot without authored pixel bounds.
    for (const width of [800, 375]) {
      await page.setViewportSize({ width, height: 650 });
      for (const direction of [
        [-2, 5, 8],
        [0, 0, 1],
        [4, -2, 8],
      ]) {
        await page.evaluate((direction) => {
          lab.formula.set('Две единицы');
          lab.view.shot({ target: lab.cube, direction, padding: 24 });
        }, direction);
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
        const framing = await page.evaluate(() => {
          const frame = lab.formula.element.parentElement.getBoundingClientRect();
          const stage = lab.formula.element.closest('.ve-stage').getBoundingClientRect();
          return {
            visible: !lab.formula.element.hidden,
            gaps: [
              frame.left - stage.left,
              stage.right - frame.right,
              frame.top - stage.top,
              stage.bottom - frame.bottom,
            ],
          };
        });
        assert(framing.visible && framing.gaps.every((gap) => gap >= 23), JSON.stringify(framing));
      }
    }
    const isolation = await page.evaluate(() => {
      const shot = () => {
        lab.view.shot({ target: lab.cube, direction: [0, 0, 1], padding: 24 });
        return lab.view.camera.position.toArray();
      };
      const before = shot();
      const other = new lab.T.Object3D();
      other.position.x = 100;
      lab.group.add(other);
      const unrelated = lab.view.label('Другой предмет', other);
      const future = new lab.T.Object3D();
      future.position.y = 100;
      future.visible = false;
      lab.cube.add(future);
      const hidden = lab.view.label('Будущий шаг', future);
      const after = shot();
      unrelated.remove();
      hidden.remove();
      other.removeFromParent();
      future.removeFromParent();
      return { before, after };
    });
    assert.deepEqual(isolation.after, isolation.before);
    await page.setViewportSize({ width: 800, height: 650 });
    await page.evaluate(() => {
      lab.formula.set('ReLU: x < 0 → 0');
      lab.view.shot({
        target: new lab.T.Box3(new lab.T.Vector3(-2, -2, -2), new lab.T.Vector3(2, 2, 2)),
        direction: [0, 0, 1],
      });
    });
    for (const angle of [0, 0.7, 1.55, 2.3, Math.PI]) {
      await page.evaluate((a) => {
        lab.group.rotation.y = a;
        lab.view.invalidate();
      }, angle);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const result = await page.evaluate(() => {
        const text = lab.formula.element.getBoundingClientRect(),
          frame = lab.formula.element.parentElement.getBoundingClientRect();
        return {
          visible: !lab.formula.element.hidden && !lab.number.element.hidden,
          inside:
            text.left >= frame.left &&
            text.right <= frame.right &&
            text.top >= frame.top &&
            text.bottom <= frame.bottom,
          errors: document.querySelectorAll('[data-layout-error]').length,
          hit: document.elementFromPoint(frame.x + frame.width / 2, frame.y + frame.height / 2)
            ?.tagName,
        };
      });
      assert.deepEqual(result, { visible: angle !== 1.55, inside: true, errors: 0, hit: 'CANVAS' });
      assert.deepEqual(
        await page.evaluate(() =>
          lab.number.object.children.map((p) => ({ id: p.uuid, local: p.matrix.toArray() })),
        ),
        attachments,
      );
    }
    // A readable annotation must project the same local point throughout vertical orbit.
    // Screen-space extrema drift even when the supporting object itself is stationary.
    await page.evaluate(() => {
      lab.group.rotation.set(0, 0.6, 0);
      lab.group.position.set(0.4, -0.2, 0.3);
      lab.cube.rotation.z = 0.15;
      lab.cube.scale.setScalar(1.2);
    });
    for (const direction of [1, -1]) {
      for (let step = 0; step <= 16; step++) {
        const elevation = direction * (-1.3 + (2.6 * step) / 16);
        await page.evaluate((elevation) => {
          lab.view.camera.position.set(
            7 * Math.cos(elevation),
            12 * Math.sin(elevation),
            10 * Math.cos(elevation),
          );
          lab.view.controls.target.set(0, 0, 0);
          lab.view.controls.update();
        }, elevation);
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
        const drift = await page.evaluate(() => {
          const point = lab.anchor.getWorldPosition(new lab.T.Vector3()).project(lab.view.camera),
            stage = lab.formula.element.closest('.ve-stage').getBoundingClientRect(),
            frame = lab.formula.element.parentElement.getBoundingClientRect();
          return {
            hidden: lab.formula.element.hidden,
            pixels: Math.hypot(
              frame.x + frame.width / 2 - stage.x - ((point.x + 1) * stage.width) / 2,
              frame.y + frame.height / 2 - stage.y - ((1 - point.y) * stage.height) / 2,
            ),
          };
        });
        assert.equal(drift.hidden, false);
        assert(
          drift.pixels < 0.1,
          `Annotation left its local anchor at elevation ${elevation}: ${drift.pixels}px`,
        );
      }
    }
    // Compare actual glyph pixels with an unobstructed reference at the film's depth range.
    // Internal visibility flags cannot detect a supporting face erasing parts of the ink.
    await page.evaluate(() => {
      lab.view.camera.near = 0.01;
      lab.view.camera.far = 1000;
      lab.view.camera.updateProjectionMatrix();
      lab.group.position.set(0, 0, 0);
      lab.cube.rotation.set(0, 0, 0);
      lab.cube.scale.setScalar(0.5);
      lab.formula.show(false);
    });
    async function letteringPixels(depthTest) {
      await page.evaluate((depthTest) => {
        for (const plane of lab.number.object.children) plane.material.depthTest = depthTest;
        lab.view.invalidate();
      }, depthTest);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      return PNG.sync.read(await page.locator('canvas').screenshot()).data;
    }
    for (const distance of [17, 30, 50]) {
      for (const angle of [0.35, 0.65, 2.6]) {
        await page.evaluate(
          ({ distance, angle }) => {
            lab.group.rotation.set(0.2, angle, 0);
            lab.view.camera.position.set(0, 0, distance);
            lab.view.controls.target.set(0, 0, 0);
            lab.view.controls.update();
          },
          { distance, angle },
        );
        const actual = await letteringPixels(true),
          reference = await letteringPixels(false);
        assert(
          actual.equals(reference),
          `Ink lost against its own face: distance ${distance}, angle ${angle}`,
        );
      }
    }
    // Replacing a value must replace its GPU pixels, including when the inscription
    // grows or shrinks. A newly created label is the reference for the same value.
    await page.evaluate(() => {
      lab.view.camera.position.set(0, 0, 17);
      lab.view.controls.update();
      lab.group.rotation.set(0.2, 0.65, 0);
    });
    for (const value of ['3', '1', '−1', '−12.34', '0', '3']) {
      await page.evaluate((value) => lab.number.set(value), value);
      const updated = await letteringPixels(true);
      await page.evaluate((value) => {
        lab.number.show(false);
        lab.reference = lab.view.label(value, lab.cube, { face: ['front', 'back'] });
      }, value);
      const fresh = await letteringPixels(true);
      assert(updated.equals(fresh), `Updated inscription ${value} differs from a fresh one`);
      await page.evaluate(() => {
        lab.reference.remove();
        lab.number.show(true);
      });
    }
    // A genuinely closer object must still cover the inscription.
    await page.evaluate(() => {
      lab.group.rotation.set(0, 0, 0);
      lab.view.camera.position.set(0, 0, 17);
      lab.view.controls.update();
      lab.cover.visible = true;
    });
    const covered = await letteringPixels(true);
    await page.evaluate(() => lab.number.show(false));
    assert(
      covered.equals(await letteringPixels(true)),
      'Ink must remain hidden behind the covering object',
    );
    await page.evaluate(() => {
      lab.number.show(true);
      lab.formula.show(true);
      lab.cover.visible = false;
    });
    await page.evaluate(() => {
      lab.group.visible = false;
      lab.view.invalidate();
    });
    await page.waitForFunction(() => lab.formula.element.hidden && lab.number.element.hidden);
    await page.evaluate(() => {
      lab.group.visible = true;
      lab.view.invalidate();
    });
    const canvas = await page.locator('canvas').boundingBox();
    const start = [canvas.x + canvas.width / 2, canvas.y + canvas.height / 2];
    const initial = await page.evaluate(() => ({
      position: lab.view.camera.position.toArray(),
      target: lab.view.controls.target.toArray(),
    }));
    const poses = [];
    for (const button of ['middle', 'left']) {
      await page.evaluate((p) => {
        lab.view.camera.position.fromArray(p.position);
        lab.view.controls.target.fromArray(p.target);
        lab.view.controls.update();
      }, initial);
      if (button === 'left') await page.keyboard.down('Shift');
      await page.mouse.move(...start);
      await page.mouse.down({ button });
      await page.mouse.move(start[0] + 80, start[1] + 40, { steps: 8 });
      await page.mouse.up({ button });
      if (button === 'left') await page.keyboard.up('Shift');
      poses.push(
        await page.evaluate(() => ({
          position: lab.view.camera.position.toArray(),
          target: lab.view.controls.target.toArray(),
        })),
      );
    }
    assert.notDeepEqual(poses[0], initial);
    for (const key of ['position', 'target'])
      poses[0][key].forEach((v, i) => assert(Math.abs(v - poses[1][key][i]) < 1e-9));
    for (let i = 0; i < 3; i++)
      assert(
        Math.abs(
          poses[0].position[i] - poses[0].target[i] - (initial.position[i] - initial.target[i]),
        ) < 1e-9,
      );
    const releases = await page.evaluate(() => {
      const counts = new Map();
      lab.group.traverse((object) => {
        for (const resource of [object.geometry, object.material, object.material?.map]) {
          if (!resource || counts.has(resource)) continue;
          counts.set(resource, 0);
          resource.addEventListener('dispose', () =>
            counts.set(resource, counts.get(resource) + 1),
          );
        }
      });
      lab.view.dispose();
      lab.number.remove();
      lab.view.dispose();
      return [...counts.values()];
    });
    assert(
      releases.length > 0 && releases.every((count) => count === 1),
      'each GPU resource is released once',
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(source, { recursive: true, force: true });
  }
});
