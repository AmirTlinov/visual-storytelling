import { test, expect, type Page, type Frame } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openFixture } from '../support/fixture.mjs';
import { assetURLs } from '../../tools/asset-urls.mjs';

async function mount(page: Page | Frame, amountType = 'range') {
  await openFixture(page, 'scene-shell');
  const source = await build({
    stdin: {
      contents: `import { SceneShell, surface, SvgLayout } from './dist/index.js';
        export function mount() {
          const root = document.querySelector('.ve-scene');
          const shell = SceneShell.mount(root, {
            title: 'Как изменение одного условия влияет на результат вычисления',
            parameters: [
              { key: 'amount', type: '${amountType}', label: 'Значение первого слагаемого перед вычислением', value: 2, min: -10, max: 10 },
              { key: 'method', label: 'Способ сравнения результата', type: 'select', value: 'sum', options: [
                { value: 'sum', label: 'Сложить исходные значения' },
                { value: 'difference', label: 'Найти разность между исходным и вычисленным значением' },
              ] },
            ],
          });
          const drawing = surface(shell.stage, { width: 960, height: 400, grid: false });
          const result = SvgLayout.element('text', { 'text-anchor': 'middle', fill: 'var(--ve-ink)' });
          drawing.layer.append(result);
          const story = shell.attachStory({
            script: { duration: 20, cues: {}, segments: [
              { id: 'inputs', title: 'Сначала заметим исходные значения', text: '', start: 0, end: 10 },
              { id: 'result', title: 'Затем сравним результат вычисления', text: '', start: 10, end: 20 },
            ] },
            stateAt: () => ({ amount: 2, method: 'sum' }),
            render(values) {
              const { width, height, scale } = shell.layout;
              drawing.resize(width, height);
              result.textContent = values.amount + ' + 3 = ' + (values.amount + 3);
              result.setAttribute('font-size', Math.max(40, 24 / scale));
              result.setAttribute('x', width / 2);
              result.setAttribute('y', height / 2);
            },
          });
          shell.setMode('explore');
          shell.onDispose(() => drawing.dispose());
          return { shell, story, root };
        }`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'ChromeContract',
    plugins: [assetURLs()],
    define: { 'import.meta.url': 'document.baseURI' },
  });
  await page.addScriptTag({ content: source.outputFiles[0]!.text });
  await page.evaluate(() => {
    (window as any).chromeContract = (window as any).ChromeContract.mount();
  });
  await expect(page.locator('.ve-heading')).toContainText('изменение одного условия');
}

async function metrics(page: Page) {
  return page.evaluate(() => {
    const physicalFont = (element: Element) => {
      const sheet = element.closest<HTMLElement>('.ve-scene-content');
      const scale = sheet ? sheet.getBoundingClientRect().width / sheet.offsetWidth : 1;
      return parseFloat(getComputedStyle(element).fontSize) * scale;
    };
    const frame = document.querySelector('[data-scene-frame]')!.getBoundingClientRect();
    const stage = document.querySelector('.ve-stage')!.getBoundingClientRect();
    const controls = [
      ...document.querySelectorAll(
        '.ve-scene-header button,.ve-scene-toolbar button,.ve-parameters input,.ve-parameters button',
      ),
    ].filter((node) => node.checkVisibility({ visibilityProperty: true }));
    return {
      ratio: frame.width / frame.height,
      stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
      heading: physicalFont(document.querySelector('.ve-heading')!),
      controls: controls.map((node) => ({
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        font: node.matches('input[type=range]') ? undefined : physicalFont(node),
      })),
      labels: [...document.querySelectorAll('.ve-control-title,.ve-choices')]
        .filter(
          (node) =>
            node.checkVisibility({ visibilityProperty: true }) &&
            !node.closest('.ve-chapter-navigation'),
        )
        .map(physicalFont),
      overflow: document.documentElement.scrollWidth > innerWidth,
      panelOverflow: [
        ...document.querySelectorAll(
          '.ve-scene-conditions:popover-open,.ve-select-list:popover-open',
        ),
      ].some((node) => node.scrollWidth > node.clientWidth + 1),
    };
  });
}

test('shared heading and controls remain physically readable while the complete frame fits', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await mount(page);
  await mkdir(resolve('artifacts/frame-consistency'), { recursive: true });
  for (const width of [390, 960, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.ve-scene-content')).toHaveAttribute(
      'data-compact-chrome',
      String(width === 390),
    );
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const before = await metrics(page);
      expect(before.ratio).toBeCloseTo(16 / 9, 5);
      expect(before.heading).toBeGreaterThanOrEqual(19.99);
      await page.locator('[data-scene-frame]').screenshot({
        path: resolve('artifacts/frame-consistency', `chrome-${width}-${colorScheme}-frame.png`),
      });
      if (width === 390) {
        expect(before.stage.height).toBeGreaterThanOrEqual(139);
        await page.getByRole('button', { name: 'Условия', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Условия объяснения' })).toBeVisible();
        expect((await metrics(page)).stage).toEqual(before.stage);
      }
      const measured = await metrics(page);
      expect(measured.controls.length).toBeGreaterThan(3);
      for (const control of measured.controls) {
        expect(control.height).toBeGreaterThanOrEqual(43.99);
        expect(control.width).toBeGreaterThanOrEqual(43.99);
        if (control.font !== undefined) expect(control.font).toBeGreaterThanOrEqual(15.99);
      }
      expect(measured.labels.every((size) => size >= 15.99)).toBe(true);
      expect(measured.overflow || measured.panelOverflow).toBe(false);
      await page.screenshot({
        path: resolve('artifacts/frame-consistency', `chrome-${width}-${colorScheme}.png`),
      });
      if (width === 390) {
        const svg = await page.evaluate(() =>
          (window as any).chromeContract.root.scene.exportSVG(),
        );
        expect(svg).toContain('Условия');
        expect(svg).not.toContain('Значение первого слагаемого перед вычислением');
        await page.getByRole('button', { name: 'Закрыть условия' }).click();
      }
    }
  }
});

test('compact conditions retain the same field, value, history and clock across reflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 1000 });
  await mount(page);
  const range = page.getByRole('slider', { name: 'Значение первого слагаемого перед вычислением' });
  await range.fill('6');
  await range.focus();
  const before = await page.evaluate(() => {
    const { root } = (window as any).chromeContract;
    (window as any).editingField = document.activeElement;
    return {
      checkpoint: root.scene.capture({ basis: 'requested' }),
      history: root.scene.experimentHistory,
      playing: root.scene.inspect({ presentation: false }).playing,
    };
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(page.getByRole('dialog', { name: 'Условия объяснения' })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement === (window as any).editingField)).toBe(
    true,
  );
  await expect(range).toHaveValue('6');
  const select = page.getByRole('combobox', { name: 'Способ сравнения результата' });
  await select.focus();
  await select.press('ArrowDown');
  const options = page.getByRole('option', {
    name: 'Найти разность между исходным и вычисленным значением',
  });
  await expect(options).toBeVisible();
  expect(
    await options.evaluate((node) => node.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  expect(
    await options.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await select.press('End');
  await select.press('Enter');
  await expect(select).toContainText('Найти разность');
  await select.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Условия объяснения' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Условия', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Условия', exact: true }).press('Enter');
  await range.focus();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('dialog', { name: 'Условия объяснения' })).toBeHidden();
  expect(await page.evaluate(() => document.activeElement === (window as any).editingField)).toBe(
    true,
  );
  const after = await page.evaluate(() => {
    const { root } = (window as any).chromeContract;
    return {
      checkpoint: root.scene.capture({ basis: 'requested' }),
      history: root.scene.experimentHistory,
      playing: root.scene.inspect({ presentation: false }).playing,
    };
  });
  expect(after.checkpoint.values.amount).toBe(6);
  expect(after.checkpoint.values.method).toBe('difference');
  expect(after.checkpoint.time).toBe(before.checkpoint.time);
  expect(after.playing).toBe(before.playing);
  expect(after.playing).toBe(false);
  expect(before.history.undo).toBe(true);
  expect(after.history.undo).toBe(true);
  expect(await page.locator('[data-player]').count()).toBe(1);
  await page.getByRole('button', { name: 'Рассказ', exact: true }).focus();
  await page.evaluate(() => (window as any).chromeContract.shell.setPresentation('stage'));
  await expect(page.locator('.ve-scene-frame')).toHaveCSS('aspect-ratio', '1280 / 720');
  // History remains outside the composition on the stage as well.
  await expect(page.getByRole('button', { name: 'Условия', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Условия объяснения' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Рассказ', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.matches('.ve-conditions-trigger'))).toBe(
    false,
  );
});

test('resizing preserves an unfinished numeric edit in the same native field', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 1000 });
  await mount(page, 'number');
  const input = page.getByRole('spinbutton', {
    name: 'Значение первого слагаемого перед вычислением',
  });
  await input.fill('6');
  await input.press('ControlOrMeta+A');
  await input.press('-');
  const draft = () =>
    input.evaluate((node: HTMLInputElement) => ({
      value: node.value,
      badInput: node.validity.badInput,
    }));
  await expect.poll(draft).toEqual({ value: '', badInput: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.ve-scene-content')).toHaveAttribute(
      'data-compact-chrome',
      String(width === 390),
    );
    await expect(input).toBeFocused();
    expect(await draft()).toEqual({ value: '', badInput: true });
    expect(
      await page.evaluate(
        () =>
          (window as any).chromeContract.root.scene.capture({ basis: 'requested' }).values.amount,
      ),
    ).toBe(6);
  }
  await input.press('5');
  await expect(input).toHaveValue('-5');
  await input.press('Tab');
  await page.evaluate(() => (window as any).chromeContract.root.scene.undoExperiment());
  await expect(input).toHaveValue('2');
});

test('an inactive iframe retains its condition without taking focus from the host', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 1100 });
  await openFixture(page, 'scene-shell');
  await page.evaluate(() => {
    (document.querySelector('.ve-scene') as any).scene.dispose();
    const hostButton = document.createElement('button');
    hostButton.textContent = 'Управление Codex';
    const iframe = document.createElement('iframe');
    iframe.title = 'Визуальное объяснение';
    iframe.style.cssText = 'display:block;width:960px;height:1000px;border:0';
    document.body.replaceChildren(hostButton, iframe);
  });
  const iframe = page.locator('iframe'),
    frame = await (await iframe.elementHandle())!.contentFrame();
  expect(frame).not.toBeNull();
  await mount(frame!, 'number');
  const input = frame!.getByRole('spinbutton', {
    name: 'Значение первого слагаемого перед вычислением',
    includeHidden: true,
  });
  await input.fill('6');
  await input.focus();
  await expect(input).toBeFocused();
  const hostButton = page.getByRole('button', { name: 'Управление Codex' });
  await hostButton.click();
  expect(await frame!.evaluate(() => document.hasFocus())).toBe(false);
  for (const width of [390, 960]) {
    await iframe.evaluate((node, value) => (node.style.width = `${value}px`), width);
    await expect(frame!.locator('.ve-scene-content')).toHaveAttribute(
      'data-compact-chrome',
      String(width === 390),
    );
    await expect(hostButton).toBeFocused();
    await expect(frame!.getByRole('dialog', { name: 'Условия объяснения' })).toBeHidden();
    await expect(input).toHaveValue('6');
    expect(
      await frame!.evaluate(() => {
        const scene = (window as any).chromeContract.root.scene;
        return {
          amount: scene.capture({ basis: 'requested' }).values.amount,
          playing: scene.inspect({ presentation: false }).playing,
        };
      }),
    ).toEqual({ amount: 6, playing: false });
  }
});
