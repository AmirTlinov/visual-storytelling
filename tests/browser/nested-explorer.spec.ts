import { test, expect } from '@playwright/test';
import { openFixture } from '../support/fixture.mjs';
import { build } from 'esbuild';

test('nested camera transitions keep one path, align HTML targets and cancel obsolete travel', async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import {ExplorerSurface,SvgCamera,ScenePath} from './dist/index.js';import './dist/style.css';window.fixture={ExplorerSurface,SvgCamera,ScenePath};`,
    },
    bundle: true,
    write: false,
    outdir: '.',
    format: 'iife',
    loader: { '.woff2': 'dataurl' },
  });
  await openFixture(page, 'scene-shell');
  await page.evaluate(() => document.querySelector<HTMLElement>('.ve-scene')!.scene!.dispose());
  await page.setContent('<main style="width:640px;height:400px;position:relative"></main>');
  await page.addStyleTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.css'))!.text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
  await page.evaluate(() => {
    const { ExplorerSurface, SvgCamera, ScenePath } = (window as any).fixture;
    const surface = ExplorerSurface.mount(document.querySelector('main'), {
      label: 'Nested subject',
      description: 'Owner fixture',
    });
    const camera = new SvgCamera(surface.viewport, surface.svg, surface.hits);
    const root = { id: 'root' },
      child = { id: 'child' },
      leaf = { id: 'leaf' };
    const path = new ScenePath(root, (node: any) => node.id);
    const subjects = new Map([
      [
        root,
        {
          body: '<rect data-object="child" x="40" y="30" width="160" height="100"/>',
          box: { x: 0, y: 0, w: 240, h: 160 },
          hits: [
            { key: 'child', label: 'Child', node: child, box: { x: 40, y: 30, w: 160, h: 100 } },
          ],
        },
      ],
      [
        child,
        {
          body: '<rect data-object="leaf" x="20" y="20" width="60" height="40"/>',
          box: { x: 0, y: 0, w: 100, h: 80 },
          hits: [
            { key: 'leaf', label: 'Leaf', node: leaf, box: { x: 20, y: 20, w: 60, h: 40 } },
            { key: 'back', label: 'Root', node: root, box: { x: 0, y: 0, w: 10, h: 10 } },
          ],
        },
      ],
      [
        leaf,
        { body: '<circle cx="5" cy="5" r="4"/>', box: { x: 0, y: 0, w: 10, h: 10 }, hits: [] },
      ],
    ]);
    const install = () => {
      const scene = subjects.get(path.current)!;
      surface.hits.replaceChildren(
        ...scene.hits.map((hit: any) => {
          const button = document.createElement('button');
          button.className = 'explorer-hit';
          button.textContent = hit.label;
          button.dataset.hitKey = hit.key;
          button.addEventListener('click', () => enter(hit.key));
          return button;
        }),
      );
      camera.show(scene);
      (surface.hits.firstElementChild as HTMLElement | null)?.focus();
    };
    function enter(key: string) {
      const parent = subjects.get(path.current)!,
        hit = parent.hits.find((item: any) => item.key === key)!;
      const ancestor = path.destination(hit) < path.length;
      path.enter(hit);
      if (ancestor) install();
      else camera.moveInto(parent, subjects.get(path.current), hit, install);
    }
    function back() {
      const child = subjects.get(path.current)!,
        entry = path.pop();
      if (!entry) return;
      const parent = subjects.get(path.current)!;
      camera.moveOut(
        parent,
        child,
        parent.hits.find((hit: any) => hit.key === entry.via),
        install,
      );
    }
    install();
    (window as any).lab = { camera, surface, path, subjects, root, enter, back, install };
  });
  const target = page.getByRole('button', { name: 'Child', exact: true });
  await target.focus();
  await target.press('Enter');
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).lab.camera.travel)))
    .toBe(false);
  expect(await page.evaluate(() => (window as any).lab.path.keys)).toEqual(['child']);
  await expect(page.getByRole('button', { name: 'Leaf', exact: true })).toBeFocused();
  const aligned = await page.evaluate(() => {
    const drawing = document.querySelector('[data-object="leaf"]')!.getBoundingClientRect();
    const control = document.querySelector('[data-hit-key="leaf"]')!.getBoundingClientRect();
    return Math.max(
      Math.abs(drawing.x - control.x),
      Math.abs(drawing.y - control.y),
      Math.abs(drawing.width - control.width),
      Math.abs(drawing.height - control.height),
    );
  });
  expect(aligned).toBeLessThan(1);
  await page.getByRole('button', { name: 'Root', exact: true }).click();
  expect(await page.evaluate(() => (window as any).lab.path.keys)).toEqual([]);
  await page.evaluate(() => {
    const lab = (window as any).lab;
    lab.enter('child');
    lab.camera.cancel();
    lab.path.reset();
    lab.install();
  });
  await page.waitForTimeout(450);
  expect(
    await page.evaluate(() => ({
      path: (window as any).lab.path.keys,
      travels: document.querySelectorAll('[data-child-scene]').length,
    })),
  ).toEqual({ path: [], travels: 0 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await target.press('Enter');
  await page.evaluate(() => (window as any).lab.back());
  await expect(target).toBeVisible();
  expect(await page.evaluate(() => (window as any).lab.path.keys)).toEqual([]);
  await page.evaluate(() => {
    const lab = (window as any).lab;
    lab.camera.cancel();
    lab.surface.dispose();
  });
  await expect(page.locator('main')).toBeEmpty();
});
