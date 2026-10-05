import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assetURLs } from '../tools/asset-urls.mjs';

test('SVG instances retain their fitted size, paint order and authored visibility', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: resolve('.'),
      contents: `
        import { Viewport3D } from './src/viewport/three.ts';
        import { SvgArtwork3D } from './src/viewport/artwork.ts';
        import { InkStroke3D } from './src/viewport/ink-line.ts';
        import { Box3, Group, Vector3, BufferGeometry, Material, InstancedMesh } from 'three';
        window.Kit = { Viewport3D, SvgArtwork3D, InkStroke3D, Box3, Group, Vector3, BufferGeometry, Material, InstancedMesh };`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    plugins: [assetURLs()],
    define: { 'import.meta.url': 'document.baseURI' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 500, height: 400 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(
      '<div id="host" style="width:480px;height:360px;--ve-surface:white;--ve-ink:black"></div>',
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const sizes = await page.evaluate(() => {
      const { Viewport3D, SvgArtwork3D, Box3, Group, Vector3 } = Kit;
      const view = Viewport3D.mount(document.querySelector('#host'));
      const source =
        '<svg xmlns="http://www.w3.org/2000/svg"><rect x="10" y="20" width="100" height="80" fill="#0000ff"/><g id="detail"><rect x="20" y="25" width="30" height="50" fill="#ff0000"/></g></svg>';
      const art = SvgArtwork3D.create(view, source, { width: 6, height: 2 });
      const front = SvgArtwork3D.create(
        view,
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="80" fill="#00ff00"/></svg>',
        { height: 2 },
      );
      const group = new Group();
      group.add(art.root, front.root);
      front.root.visible = false;
      view.setObject(group, { fitView: false });
      view.shot({
        target: new Box3(new Vector3(-2, -1.5, -1), new Vector3(2, 1.5, 1)),
        direction: [0, 0, 1],
      });
      window.lab = { view, art, front, source };
      window.pixel = (point = [-0.625, 0.375, 0]) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            off();
            reject(new Error('Artwork change did not redraw the paused viewport'));
          }, 1000);
          const off = view.onRender(() => {
            off();
            clearTimeout(timer);
            const p = new Vector3(...point).project(view.camera),
              gl = view.renderer.getContext();
            const rgba = new Uint8Array(4);
            gl.readPixels(
              Math.floor(((p.x + 1) * gl.drawingBufferWidth) / 2),
              Math.floor(((p.y + 1) * gl.drawingBufferHeight) / 2),
              1,
              1,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              rgba,
            );
            resolve([...rgba]);
          });
        });
      return [1, 0.5, 1.4, 0, 1, 0.5].map((scale) => {
        art.root.scale.setScalar(scale);
        const bounds = new Box3().setFromObject(art.root);
        return {
          scale,
          size: bounds.getSize(new Vector3()).toArray(),
          centre: bounds.getCenter(new Vector3()).toArray(),
        };
      });
    });
    for (const { scale, size, centre } of sizes) {
      assert.ok(Math.abs(size[0] - 2.5 * scale) < 1e-7);
      assert.ok(Math.abs(size[1] - 2 * scale) < 1e-7);
      assert.ok(centre.every((value) => Math.abs(value) < 1e-7));
    }
    // Native SVG paint order survives an oblique camera, and whole illustrations
    // cross in depth without rear details punching through the foreground.
    for (const direction of [
      [0, 0, 1],
      [3, 2, 8],
      [-3, -2, 8],
    ]) {
      await page.evaluate((direction) => {
        lab.art.root.scale.setScalar(1);
        lab.view.shot({
          target: new Kit.Box3(new Kit.Vector3(-2, -1.5, -1), new Kit.Vector3(2, 1.5, 1)),
          direction,
        });
      }, direction);
      for (const depth of [0.4, -0.4, 0.4]) {
        const rgba = await page.evaluate((depth) => {
          lab.front.root.visible = true;
          lab.front.root.position.z = depth;
          lab.view.invalidate();
          return pixel();
        }, depth);
        assert.deepEqual(rgba, depth > 0 ? [0, 255, 0, 255] : [255, 0, 0, 255]);
      }
    }
    const visibility = await page.evaluate(async () => {
      lab.front.root.visible = false;
      const samples = [];
      lab.art.root.visible = false;
      lab.art.opacity(1);
      samples.push((await pixel())[3]);
      lab.art.opacity(0);
      lab.art.root.visible = true;
      samples.push((await pixel())[3]);
      lab.art.opacity(1);
      samples.push((await pixel())[3]);
      // Layer visibility belongs to the author too; fading must not reset it.
      for (const mesh of lab.art.layers.get('detail')) mesh.visible = false;
      lab.art.opacity(0.5);
      const faded = await pixel();
      lab.art.opacity(1);
      const restored = await pixel();
      return { samples, faded, restored };
    });
    assert.deepEqual(visibility.samples, [0, 0, 255]);
    assert.ok(visibility.faded[3] >= 127 && visibility.faded[3] <= 128);
    assert.deepEqual(visibility.restored, [0, 0, 255, 255]);
    const semantics = await page.evaluate(async () => {
      lab.view.describe(lab.art.root, 'back', { label: 'Back drawing' });
      lab.view.describe(lab.front.root, 'front', { label: 'Front drawing' });
      const button = document.querySelector('[data-object="back"]');
      const meshes = lab.art.root.children[0].children;
      const samples = [];
      const sample = async () => {
        lab.view.invalidate();
        await pixel();
        samples.push(button.hidden);
      };
      lab.art.opacity(0);
      await sample();
      lab.art.opacity(1);
      await sample();
      lab.art.root.visible = false;
      await sample();
      lab.art.root.visible = true;
      for (const mesh of meshes) mesh.material.visible = false;
      await sample();
      for (const mesh of meshes) {
        mesh.material.visible = true;
        mesh.material.opacity = 0;
      }
      await sample();
      lab.art.opacity(1);
      for (const mesh of meshes) mesh.geometry.setDrawRange(0, 0);
      await sample();
      for (const mesh of meshes) mesh.geometry.setDrawRange(0, Infinity);
      await sample();
      // MathMorph's logical parts retain their explicit bounds/visibility owner.
      const logical = new Kit.Group();
      lab.view.scene.add(logical);
      lab.logical = logical;
      let shown = true;
      let logicalBounds = new Kit.Box3(new Kit.Vector3(1.6, 0, 0), new Kit.Vector3(1.8, 0.2, 0.2));
      lab.view.describe(
        logical,
        'logical',
        { label: 'Logical part' },
        {
          bounds: () => logicalBounds,
          visible: () => shown,
        },
      );
      const logicalButton = document.querySelector('[data-object="logical"]');
      const logicalSamples = [];
      for (const state of [true, false, true]) {
        shown = state;
        lab.view.invalidate();
        await pixel();
        logicalSamples.push(logicalButton.hidden);
      }
      // A camera envelope may include an unrelated object after a delivery.
      logicalBounds = new Kit.Box3(new Kit.Vector3(-2, -1, -0.1), new Kit.Vector3(2, 1, 0.1));
      lab.front.root.visible = true;
      lab.front.root.position.z = 0.4;
      // Keep the tree visible: the material alone makes the front plane disappear.
      lab.front.opacity(1);
      lab.front.root.children[0].children[0].material.opacity = 0;
      lab.view.shot({
        target: new Kit.Box3(new Kit.Vector3(-2, -1.5, -1), new Kit.Vector3(2, 1.5, 1)),
        direction: [0, 0, 1],
      });
      await pixel();
      window.hits = [];
      for (const element of document.querySelectorAll('[data-object]'))
        element.addEventListener('click', () => hits.push(element.dataset.object));
      const rect = lab.view.renderer.domElement.getBoundingClientRect();
      return {
        samples,
        logicalSamples,
        frontHidden: document.querySelector('[data-object="front"]').hidden,
        point: [rect.x + rect.width / 2, rect.y + rect.height / 2],
      };
    });
    assert.deepEqual(semantics.samples, [true, false, true, true, true, true, false]);
    assert.deepEqual(semantics.logicalSamples, [false, true, false]);
    assert.equal(semantics.frontHidden, true);
    await page.mouse.click(...semantics.point);
    assert.deepEqual(await page.evaluate(() => hits), ['back']);
    await page.evaluate(async () => {
      // A logical part of this shared surface still takes precedence over its root.
      lab.art.root.add(lab.logical);
      lab.view.invalidate();
      await pixel();
    });
    await page.mouse.click(...semantics.point);
    assert.deepEqual(await page.evaluate(() => hits), ['back', 'logical']);
    const instances = await page.evaluate(async () => {
      const stroke = Kit.InkStroke3D.create(lab.view, [
        [-1.9, -0.5, 0],
        [-1.5, 0.5, 0],
      ]);
      lab.view.scene.add(stroke.root);
      lab.view.describe(stroke.root, 'stroke', { label: 'Growing stroke' });
      const source = lab.front.root.children[0].children[0];
      const material = source.material.clone();
      material.opacity = 1;
      const repeated = new Kit.InstancedMesh(source.geometry, material, 1);
      repeated.scale.setScalar(0.004);
      repeated.position.set(-1.6, -0.4, 0);
      lab.view.scene.add(repeated);
      lab.view.describe(repeated, 'repeated', { label: 'Instanced drawing' });
      const samples = [];
      for (const progress of [0, 1, 0, 1]) {
        stroke.draw(progress);
        repeated.count = progress;
        await pixel();
        samples.push(
          ['stroke', 'repeated'].map(
            (id) => document.querySelector(`[data-object="${id}"]`).hidden,
          ),
        );
      }
      return samples;
    });
    assert.deepEqual(instances, [
      [true, true],
      [false, false],
      [true, true],
      [false, false],
    ]);
    const invalid = await page.evaluate(() =>
      [
        ...[0, -1, Infinity, NaN].flatMap((value) =>
          ['width', 'height'].map(
            (key) => () => Kit.SvgArtwork3D.create(lab.view, lab.source, { [key]: value }),
          ),
        ),
        () => lab.art.opacity(NaN),
      ].map((make) => {
        try {
          make();
          return false;
        } catch (error) {
          return /finite/.test(error.message);
        }
      }),
    );
    assert.ok(invalid.every(Boolean));
    const failed = await page.evaluate(() => {
      const { BufferGeometry, Material, SvgArtwork3D } = Kit;
      const first = '<rect width="10" height="10" fill="#0000ff"/>';
      const svg = (contents) => `<svg xmlns="http://www.w3.org/2000/svg">${contents}</svg>`;
      return [
        { source: svg('') },
        { source: svg('<rect width="0" height="10"/>') },
        // Float32 underflow leaves indexed triangles but no drawable area.
        { source: svg('<rect width="10" height="1e-50"/>') },
        { source: svg(first + '<rect x="1e39" width="1e38" height="10"/>') },
        { source: svg(first + '<rect width="10" height="10" opacity="bad"/>') },
        {
          source: svg(first + '<rect width="10" height="10" fill="#ff0000"/>'),
          options: { colors: { '#ff0000': 'missing-pigment' } },
        },
      ].map(({ source, options }) => {
        const geometries = new Map(),
          materials = new Map();
        const disposeGeometry = BufferGeometry.prototype.dispose;
        const disposeMaterial = Material.prototype.dispose;
        BufferGeometry.prototype.dispose = function () {
          geometries.set(this, (geometries.get(this) ?? 0) + 1);
          return disposeGeometry.call(this);
        };
        Material.prototype.dispose = function () {
          materials.set(this, (materials.get(this) ?? 0) + 1);
          return disposeMaterial.call(this);
        };
        let message;
        try {
          SvgArtwork3D.create(lab.view, source, options);
        } catch (error) {
          message = error.message;
        } finally {
          BufferGeometry.prototype.dispose = disposeGeometry;
          Material.prototype.dispose = disposeMaterial;
        }
        return {
          message,
          geometries: [...geometries.values()],
          materials: [...materials.values()],
        };
      });
    });
    for (const failure of failed.slice(0, 3)) assert.match(failure.message, /no drawable paths/);
    assert.match(failed[3].message, /coordinates must be finite/);
    assert.match(failed[4].message, /opacity must be finite/);
    assert.match(failed[5].message, /Unknown 3D pigment/);
    assert.deepEqual(
      failed.map(({ geometries, materials }) => [geometries.length, materials.length]),
      [
        [0, 0],
        [0, 0],
        [1, 0],
        [2, 1],
        [2, 1],
        [2, 2],
      ],
    );
    for (const failure of failed)
      assert.ok([...failure.geometries, ...failure.materials].every((count) => count === 1));
    const releases = await page.evaluate(() => {
      const resources = new Map();
      lab.view.scene.traverse((object) => {
        for (const resource of [object.geometry, object.material]) {
          if (!resource || resources.has(resource)) continue;
          resources.set(resource, 0);
          resource.addEventListener('dispose', () =>
            resources.set(resource, resources.get(resource) + 1),
          );
        }
      });
      lab.view.dispose();
      lab.view.dispose();
      return [...resources.values()];
    });
    assert.ok(releases.length && releases.every((count) => count === 1));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
