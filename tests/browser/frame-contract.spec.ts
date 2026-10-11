import { openFixture } from '../support/fixture.mjs';
import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assetURLs } from '../../tools/asset-urls.mjs';

test('notebook paper keeps a calm physical grid through scaling, themes and vector export', async ({
  page,
}) => {
  await openFixture(page, 'scene-shell');
  const source = await build({
    stdin: {
      contents: `import { SceneShell, surface, lettering } from './dist/index.js';
        export function mount() {
          const root = document.querySelector('.ve-scene');
          const shell = SceneShell.mount(root, { title: 'Бумага', heading: false });
          const drawing = surface(shell.stage, { width: 1216, height: 688, grid: false });
          const label = lettering(drawing.layer, 'Спокойная сетка', { x: 50, y: 110, size: 60, anchor: 'start' });
          drawing.pen.arrow(drawing.layer, 'direction', [100, 360], [1020, 360]);
          shell.onDispose(() => { label.dispose(); drawing.dispose(); });
          return { shell, drawing, root };
        }`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'PaperContract',
    plugins: [assetURLs()],
    define: { 'import.meta.url': 'document.baseURI' },
  });
  await page.addScriptTag({ content: source.outputFiles[0]!.text });
  await page.evaluate(() => {
    (window as any).paperContract = (window as any).PaperContract.mount();
  });
  const content = page.locator('.ve-scene-content');
  const frame = page.locator('[data-scene-frame]');
  await mkdir(resolve('artifacts/frame-consistency'), { recursive: true });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect
        .poll(() =>
          content.evaluate((node: HTMLElement) => {
            const scale = node.getBoundingClientRect().width / node.offsetWidth;
            const sizes = getComputedStyle(node)
              .backgroundSize.split(',')
              .map((size) => parseFloat(size));
            return Math.max(Math.abs(sizes[0]! * scale - 100), Math.abs(sizes[2]! * scale - 20));
          }),
        )
        .toBeLessThan(0.01);
      const exported = await page.evaluate(async () => {
        const { root } = (window as any).paperContract;
        const content = root.querySelector('.ve-scene-content');
        const scale = content.getBoundingClientRect().width / content.offsetWidth;
        const xml = new DOMParser().parseFromString(await root.scene.exportSVG(), 'image/svg+xml');
        const pattern = xml.querySelector('pattern[id^="export-paper"]')!;
        const columns = [...pattern.querySelectorAll('rect[x]')].map((node) =>
          Number(node.getAttribute('x')),
        );
        return {
          scale,
          major: Number(pattern.getAttribute('width')),
          minor: columns[1]! - columns[0]!,
          count: columns.length,
        };
      });
      expect(exported.major * exported.scale).toBeCloseTo(100, 2);
      expect(exported.minor * exported.scale).toBeCloseTo(20, 2);
      expect(exported.count).toBe(5);
      await frame.screenshot({
        path: resolve('artifacts/frame-consistency', `paper-${width}-${colorScheme}.png`),
      });
    }
  }
  await page.evaluate(() => (window as any).paperContract.shell.setPresentation('stage'));
  await expect(content).toHaveCSS('background-image', 'none');
  expect(
    await page.evaluate(async () =>
      (await (window as any).paperContract.root.scene.exportSVG()).includes('id="export-paper"'),
    ),
  ).toBe(false);
  const originalGrid = await page.evaluate(() => {
    const { shell, drawing } = (window as any).paperContract;
    shell.setPresentation('explanation');
    drawing.resize(1216, 688, { step: 72, x: 170, y: 200 });
    return drawing.element.querySelector('.vs-grid').innerHTML;
  });
  await expect(content).toHaveCSS('background-image', 'none');
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.locator('.vs-grid').innerHTML()).toBe(originalGrid);
    await expect(page.locator('.vs-grid > path').first()).toBeVisible();
  }
});

test('3D lettering is rasterized at the displayed frame density through resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openFixture(page, 'arithmetic', 'tensor.html');
  await page.evaluate(() => window.galleryReady);
  await page.locator('[data-seek]').fill('6');
  const canvas = page.locator('.ve-stage > canvas');
  for (const width of [1440, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        canvas.evaluate((node: HTMLCanvasElement) =>
          Math.abs(node.width - node.getBoundingClientRect().width * Math.min(devicePixelRatio, 2)),
        ),
      )
      .toBeLessThan(2);
    expect(Number(await page.locator('[data-seek]').inputValue())).toBe(6);
  }
});

test('independently bundled SVG and HTML share one host connection', async ({ page }) => {
  const bundle = async (name: string) =>
    (
      await build({
        entryPoints: ['dist/host/adapter.js'],
        bundle: true,
        write: false,
        format: 'iife',
        globalName: name,
      })
    ).outputFiles[0]!.text;
  await page.setContent('<main></main>');
  await page.addScriptTag({ content: await bundle('SVGHost') });
  await page.addScriptTag({ content: await bundle('HTMLHost') });
  expect(
    await page.evaluate(() => {
      const w = window as any;
      let changed = 0;
      const stop = w.HTMLHost.watchSceneHost(() => changed++);
      const first = { widgetState: { read: () => ({ privateContent: 'first' }) } };
      const second = { widgetState: { read: () => ({ privateContent: 'second' }) } };
      const disconnectFirst = w.SVGHost.connectSceneHost(first);
      const shared = w.HTMLHost.sceneHost() === first;
      const disconnectSecond = w.HTMLHost.connectSceneHost(second);
      disconnectFirst();
      const retained = w.SVGHost.sceneHost() === second;
      disconnectSecond();
      stop();
      return { shared, retained, changed, empty: !w.SVGHost.sceneHost() };
    }),
  ).toEqual({ shared: true, retained: true, changed: 3, empty: true });
});

test('playback remains readable outside the drawing at every surface width', async ({ page }) => {
  for (const width of [375, 390, 820, 1440])
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await openFixture(page, 'scene-shell');
      await page.evaluate(() => window.galleryReady);
      const result = await page.evaluate(() => {
        const frame = document.querySelector('[data-scene-frame]')!;
        const player = document.querySelector('.ve-player')!;
        const box = frame.getBoundingClientRect();
        return {
          ratio: box.width / box.height,
          outside: !frame.contains(player),
          players: document.querySelectorAll('.ve-player').length,
          controls: [...player.querySelectorAll('button,input,select')]
            .filter((n) => n.checkVisibility())
            .map((n) => ({
              height: n.getBoundingClientRect().height,
              width: n.getBoundingClientRect().width,
            })),
          type: [...player.querySelectorAll('output,select')].map((n) =>
            parseFloat(getComputedStyle(n).fontSize),
          ),
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(result.ratio).toBeCloseTo(16 / 9, 5);
      expect(result.outside).toBe(true);
      expect(result.players).toBe(1);
      for (const control of result.controls) {
        expect(control.height).toBeGreaterThanOrEqual(44);
        expect(control.width).toBeGreaterThanOrEqual(44);
      }
      expect(result.type.every((size) => size >= 16)).toBe(true);
      expect(result.scrollWidth).toBeLessThanOrEqual(width);
    }
});

test('the measuring grid covers the aperture after camera movement and reverse seek', async ({
  page,
}) => {
  await openFixture(page, 'scene-shell', 'camera.html');
  await page.evaluate(() => window.galleryReady);
  for (const time of [19, 8, 0, 19]) {
    await page.locator('[data-seek]').fill(String(time));
    const svg = page.locator('svg.vs-canvas');
    await svg.focus();
    await svg.press('ArrowRight');
    expect(
      await svg.evaluate((node) => {
        const line = node.querySelector('.vs-grid path') as SVGPathElement;
        const numbers = line
          .getAttribute('d')!
          .match(/-?[\d.]+/g)!
          .slice(0, 4)
          .map(Number);
        const matrix = line.getScreenCTM()!;
        const a = new DOMPoint(numbers[0], numbers[1]).matrixTransform(matrix);
        const b = new DOMPoint(numbers[2], numbers[3]).matrixTransform(matrix);
        const frame = node.getBoundingClientRect();
        return (
          getComputedStyle(line).display !== 'none' &&
          Math.min(a.y, b.y) <= frame.top + 1 &&
          Math.max(a.y, b.y) >= frame.bottom - 1
        );
      }),
    ).toBe(true);
    await svg.press('Home');
  }
});

test('wrapper geometry always fits after wide, narrow and short surface transitions', async ({
  page,
}) => {
  await openFixture(page, 'scene-shell');
  await page.evaluate(() => window.galleryReady);
  const frame = page.locator('[data-scene-frame]').first();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1800, height: 1400 },
    { width: 980, height: 400 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        frame.evaluate((node) => {
          const outer = node.getBoundingClientRect(),
            inner = node.firstElementChild!.getBoundingClientRect(),
            root = node.parentElement!,
            style = getComputedStyle(root),
            availableWidth =
              root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            chrome = root.getBoundingClientRect().height - outer.height,
            body = getComputedStyle(document.body),
            availableHeight =
              innerHeight -
              outer.top -
              chrome -
              (parseFloat(body.marginBottom) || 0) -
              (parseFloat(body.paddingBottom) || 0),
            expectedWidth = Math.min(availableWidth, (availableHeight * 16) / 9);
          return Math.max(
            Math.abs(outer.width - expectedWidth),
            Math.abs(outer.width - inner.width),
            Math.abs(outer.height - inner.height),
            -outer.left,
            -outer.top,
            outer.right - innerWidth,
            outer.bottom - innerHeight,
          );
        }),
      )
      .toBeLessThan(1);
    expect(await frame.evaluate((node) => [node.scrollLeft, node.scrollTop])).toEqual([0, 0]);
    expect(await frame.evaluate((node) => getComputedStyle(node).overflow)).toBe('clip');
    const bounds = await frame.boundingBox();
    expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 5);
    expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.height).toBeLessThanOrEqual(viewport.height);
  }
});

test('subject layout follows its displayed surface without an authored resize observer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openFixture(page, 'scene-shell');
  await page.evaluate(() => window.galleryReady);
  const source = await build({
    stdin: {
      contents: `import { SceneShell } from './dist/index.js';
        export function mount() {
          const root = document.querySelector('.ve-scene');
          root.scene.dispose();
          root.style.width = '820px';
          const shell = SceneShell.mount(root, { title: 'Читаемая композиция', heading: false, navigation: false,
            parameters: [{ key: 'input', label: 'Условие', value: 0, min: 0, max: 1, step: .1 }],
          });
          shell.showParameters([]);
          const text = document.createElement('span');
          text.textContent = 'Те же числа, другой размер кадра';
          text.dataset.layoutSample = '';
          shell.stage.append(text);
          const controller = shell.attachStory({
            script: { duration: 2, cues: {}, segments: [] },
            stateAt: () => ({ input: 0 }),
            render() {
              const layout = shell.layout;
              root.dataset.compact = String(layout.compact);
              root.dataset.renderedWidth = String(layout.displayWidth);
              text.style.fontSize = Math.max(20, 16 / layout.scale) + 'px';
            },
          });
          return { shell, controller };
        }`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'FrameContract',
    define: { 'import.meta.url': 'document.baseURI' },
  });
  await page.addScriptTag({ content: source.outputFiles[0]!.text });
  await page.evaluate(() => {
    (window as any).layoutContract = (window as any).FrameContract.mount();
  });
  const root = page.locator('.ve-scene');
  expect(
    await page.locator('.ve-parameters').evaluate((node) => getComputedStyle(node).display),
  ).toBe('none');
  await expect(root).toHaveAttribute('data-compact', 'false');
  const original = await page.evaluate(() => (window as any).layoutContract.shell.layout);
  for (const width of [390, 820, 375]) {
    // Only the parent aperture changes: no viewport event and no observer in the subject.
    await root.evaluate((node: HTMLElement, value) => (node.style.width = `${value}px`), width);
    await expect(root).toHaveAttribute('data-compact', String(width < 640));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const layout = (window as any).layoutContract.shell.layout;
          return Math.abs(
            Number(document.querySelector<HTMLElement>('.ve-scene')!.dataset.renderedWidth) -
              layout.displayWidth,
          );
        }),
      )
      .toBeLessThan(1);
    const measured = await page.evaluate(() => {
      const layout = (window as any).layoutContract.shell.layout;
      const text = document.querySelector('[data-layout-sample]')!;
      return { layout, pixels: parseFloat(getComputedStyle(text).fontSize) * layout.scale };
    });
    expect(measured.layout.width).toBeCloseTo(original.width, 3);
    expect(measured.layout.height).toBeCloseTo(original.height, 3);
    expect(measured.layout.displayWidth).toBeLessThanOrEqual(width);
    expect(measured.layout.displayWidth).toBeCloseTo(measured.layout.width * measured.layout.scale);
    expect(measured.pixels).toBeGreaterThanOrEqual(15.99);
  }
  const lastVisible = await page.evaluate(() => (window as any).layoutContract.shell.layout);
  await root.evaluate((node: HTMLElement) => (node.hidden = true));
  const hidden = await page.evaluate(() => (window as any).layoutContract.shell.layout);
  expect(hidden.width).toBe(lastVisible.width);
  expect(hidden.height).toBe(lastVisible.height);
  expect(hidden.displayWidth).toBe(0);
  expect(hidden.displayHeight).toBe(0);
  expect(hidden.scale).toBe(1);
  await root.evaluate((node: HTMLElement) => (node.hidden = false));
  await expect(root).toBeVisible();
});

test('a long chapter title fits the standalone stage controls on a narrow surface', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 950 });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await openFixture(page, 'chapters');
    await page.evaluate(() => window.galleryReady);
    const chapter = page.getByRole('combobox', { name: 'Глава' });
    const bounds = await chapter.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
    await chapter.focus();
    await expect(chapter).toBeFocused();
  }
});

test('a short surface gives playback and errors the full shell width independently of the drawing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 400 });
  await openFixture(page, 'scene-shell');
  await page.evaluate(() => (window as any).galleryReady);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const message =
    'Не удалось подготовить звук для выбранной главы. Проверьте доступность локального файла и повторите воспроизведение; положение рассказа и условия опыта сохранены.';
  await page.evaluate(async (message) => {
    const scene = (document.querySelector('.ve-scene') as any).scene;
    scene.drawing.resize = () => {
      throw new Error(message);
    };
    try {
      scene.seek(2);
    } catch {
      /* The owner reports the actual render failure. */
    }
  }, message);
  await expect(page.locator('.ve-scene > .ve-status')).toHaveText(message);
  for (const height of [400, 360, 400]) {
    await page.setViewportSize({ width: 980, height });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const root = document.querySelector('.ve-scene')!;
          const box = root.getBoundingClientRect();
          const frame = root.querySelector('[data-scene-frame]')!.getBoundingClientRect();
          const player = root.querySelector('[data-player]')!.getBoundingClientRect();
          const status = root.querySelector(':scope > .ve-status')!.getBoundingClientRect();
          const bottom = parseFloat(getComputedStyle(document.body).paddingBottom);
          return {
            playerUsesShellWidth: Math.abs(player.width - box.width) < 0.1,
            statusUsesShellWidth: Math.abs(status.width - box.width) < 0.1,
            drawingIsSmaller: frame.width < box.width,
            fitsHeight: Math.abs(box.bottom + bottom - innerHeight) < 0.1,
            ratio: Math.abs(frame.width / frame.height - 16 / 9) < 0.001,
          };
        }),
      )
      .toEqual({
        playerUsesShellWidth: true,
        statusUsesShellWidth: true,
        drawingIsSmaller: true,
        fitsHeight: true,
        ratio: true,
      });
  }
});
