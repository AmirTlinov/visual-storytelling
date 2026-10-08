import { test, expect, type Page } from '@playwright/test';
import type { SceneCommand } from '../../src/scene-access.js';

async function openScene(page: Page, name: 'tensor-slices' | 'math-workbench') {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/${name}/index.html`);
  await page.evaluate(() => window.galleryReady);
  return errors;
}

async function control(page: Page, commands: SceneCommand[]) {
  await page.evaluate(async (commands) => {
    await (document.querySelector('main') as any).scene.control(commands);
    // Semantic hit regions are projected by the viewport's next rendered frame.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }, commands);
}

const tensorState = (page: Page) =>
  page.evaluate(() => {
    const scene = (document.querySelector('main') as any).scene;
    return { ...scene.tensorState(), objects: scene.objects(), selectedIds: scene.selected };
  });

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

test('an extracted day follows changed source values and selected cell provenance on a narrow page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openScene(page, 'tensor-slices');
  await control(page, [
    { type: 'pause' },
    { type: 'theme', value: 'light' },
    { type: 'seek', time: 10 },
  ]);
  const selectedCell = page.locator('[data-object="selected-day:0,0"]');
  await expect(selectedCell).toBeVisible();
  await selectedCell.press('Enter');
  await expect(selectedCell).toHaveAttribute('data-selected');

  await control(page, [{ type: 'parameters', values: { first: 25 } }]);
  let state = await tensorState(page);
  expect(state.values[0]).toBe(25);
  expect(state.selected).toEqual([25, 14, 16, 10, 13, 15]);
  expect(state.selectedIds).toEqual(['selected-day:0,0']);
  expect(state.objects.find((object: any) => object.id === 'selected-day:0,0')).toMatchObject({
    value: 25,
    inputs: ['measurements:0,0,0'],
    provenance: { tensor: 'measurements', address: [0, 0, 0], value: 25 },
    visible: true,
  });
  expect(state.objects.find((object: any) => object.id === 'measurements:0,0,0').value).toBe(25);
  expect(
    await page.evaluate(() => {
      const scene = (document.querySelector('main') as any).scene;
      return [
        scene.source.cell(0, 0, 0).text.element.textContent,
        scene.slice.result.cell(0, 0).text.element.textContent,
      ];
    }),
  ).toEqual(['25', '25']);

  await control(page, [{ type: 'parameters', values: { day: 2 } }]);
  state = await tensorState(page);
  expect(state.selected).toEqual([14, 16, 18, 12, 15, 17]);
  expect(state.origins.map((origin: any) => origin.address)).toEqual([
    [2, 0, 0],
    [2, 0, 1],
    [2, 0, 2],
    [2, 1, 0],
    [2, 1, 1],
    [2, 1, 2],
  ]);
  expect(state.objects.find((object: any) => object.id === 'selected-day:0,0')).toMatchObject({
    value: 14,
    inputs: ['measurements:2,0,0'],
    provenance: { address: [2, 0, 0] },
  });
  await selectedCell.press('Escape');
  await expect(selectedCell).not.toHaveAttribute('data-selected');
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('tensor calculation and delivery keep one visible result through rewind and rapid operation changes', async ({
  page,
}) => {
  const errors = await openScene(page, 'math-workbench');
  const receiver = page.locator('[data-object="answer:scalar"]');
  const computed = page.locator('[data-object^="calculation:"]:not([hidden])');
  await control(page, [{ type: 'pause' }, { type: 'seek', time: 22 }]);
  let state = await tensorState(page);
  expect(state.selected).toEqual([2, 4, 3, 5]);
  expect(state.result).toBe(4.25);
  expect(state.stored).toBe(4.25);
  await expect(receiver).toBeVisible();
  await expect(computed).toHaveCount(0);

  // The same finished value returns from its destination before rewinding its calculation.
  await control(page, [{ type: 'seek', time: 19.5 }]);
  await expect(receiver).toBeHidden();
  await expect(computed).toHaveCount(1);
  expect((await tensorState(page)).result).toBe(4.25);
  await control(page, [{ type: 'seek', time: 0 }]);
  await expect(receiver).toBeHidden();
  await expect(computed).toHaveCount(0);
  await control(page, [{ type: 'seek', time: 21 }]);
  await expect(receiver).toBeVisible();
  await expect(computed).toHaveCount(0);

  await control(page, [{ type: 'parameters', values: { first: 10 } }]);
  expect((await tensorState(page)).result).toBe(6.25);
  await control(page, [{ type: 'parameters', values: { channel: 1 } }]);
  state = await tensorState(page);
  expect(state.result).toBe(7.75);
  expect(state.stored).toBe(7.75);
  expect(state.selected).toEqual([8, 6, 7, 9]);
  expect(state.origins.map((origin: any) => origin.address)).toEqual([
    [0, 0, 1],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 1],
  ]);
  const byId = new Map<string, any>(state.objects.map((object: any) => [object.id, object]));
  expect(byId.get('answer:scalar')).toMatchObject({
    value: 7.75,
    inputs: ['calculation'],
    visible: true,
  });
  expect(new Set(byId.get('calculation').inputs)).toEqual(
    new Set([
      'samples:0,0,1',
      'samples:0,1,1',
      'samples:1,0,1',
      'samples:1,1,1',
      'weights:0',
      'weights:1',
      'weights:2',
      'weights:3',
    ]),
  );
  for (const input of byId.get('calculation').inputs) expect(byId.has(input)).toBe(true);

  const transitions = await page.evaluate(async () => {
    const scene = (document.querySelector('main') as any).scene;
    const states = [];
    for (const kind of ['add', 'multiply', 'dot', 'multiply', 'add', 'dot']) {
      await scene.control([{ type: 'parameters', values: { kind } }]);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const objects = scene.objects();
      states.push({
        kind,
        result: scene.tensorState().result,
        receiverVisible: objects.find((object: any) => object.id === 'answer:scalar').visible,
        computed: objects.filter(
          (object: any) => object.id.startsWith('calculation:') && object.visible,
        ).length,
      });
    }
    return states;
  });
  for (const transition of transitions) {
    expect(transition.result).toEqual(
      transition.kind === 'dot'
        ? 7.75
        : transition.kind === 'add'
          ? [8.25, 6.5, 6.75, 9.5]
          : [2, 3, -1.75, 4.5],
    );
    expect(transition.receiverVisible).toBe(transition.kind === 'dot');
    expect(transition.computed).toBe(transition.kind === 'dot' ? 0 : 4);
  }
  await expect(receiver).toBeVisible();
  await expect(computed).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('orbit and Home keep tensor playback running, and the result remains keyboard accessible after a narrow dark resize', async ({
  page,
}) => {
  const errors = await openScene(page, 'math-workbench');
  await control(page, [
    { type: 'pause' },
    { type: 'theme', value: 'light' },
    { type: 'seek', time: 7 },
    { type: 'play' },
  ]);
  const viewState = () =>
    page.evaluate(() => {
      const scene = (document.querySelector('main') as any).scene;
      const { time, playing, viewTransition } = scene.inspect({ presentation: false });
      return { time, playing, viewTransition, ...scene.view.capture() };
    });
  const initial = await viewState();
  expect(initial.playing).toBe(true);
  const canvas = page.locator('.ve-stage > canvas');
  const area = (await canvas.boundingBox())!;
  const x = area.x + area.width * 0.82,
    y = area.y + area.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 65, y + 35, { steps: 8 });
  await page.mouse.up();
  const rotated = await viewState();
  expect(rotated.following).toBe(false);
  expect(rotated.position).not.toEqual(initial.position);
  expect(rotated.playing).toBe(true);
  await expect.poll(async () => (await viewState()).time).toBeGreaterThan(initial.time);
  await canvas.press('Home');
  await expect.poll(async () => (await viewState()).viewTransition).toBe('idle');
  const restored = await viewState();
  expect(restored.following).toBe(true);
  expect(restored.playing).toBe(true);
  restored.position.forEach((value: number, index: number) =>
    expect(value).toBeCloseTo(initial.position[index], 5),
  );
  await expectNoHorizontalOverflow(page);

  await control(page, [{ type: 'pause' }, { type: 'seek', time: 22 }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await control(page, [{ type: 'theme', value: 'dark' }]);
  const receiver = page.locator('[data-object="answer:scalar"]');
  await expect(receiver).toBeVisible();
  await receiver.press('Enter');
  await expect(receiver).toHaveAttribute('data-selected');
  expect((await tensorState(page)).selectedIds).toEqual(['answer:scalar']);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('elementwise multiplication exposes the same pairs it animates after input changes and reverse seek', async ({
  page,
}) => {
  const errors = await openScene(page, 'math-workbench');
  await control(page, [
    { type: 'pause' },
    { type: 'parameters', values: { kind: 'multiply', time: 17 } },
  ]);
  const read = () =>
    page.evaluate(() => {
      const scene = (document.querySelector('main') as any).scene;
      const frame = scene.calculation.plan.sample(0.3);
      return {
        results: scene
          .objects()
          .filter((object: any) => object.visible && object.id.startsWith('calculation:')),
        pairs: frame.targets.map((target: any) => ({
          ids: target.inputIds,
          moving: frame.sources
            .filter((input: any) => input.material === target.material)
            .map((input: any) => input.id),
        })),
      };
    });
  const initial = await read();
  expect(initial.results.map((object: any) => object.value)).toEqual([0.5, 2, -0.75, 2.5]);
  for (const [index, object] of initial.results.entries()) {
    expect(object.provenance.originPrecision).toBe('exact');
    expect(object.provenance.origins.map((origin: any) => [origin.operand, origin.index])).toEqual([
      [0, index],
      [1, index],
    ]);
  }
  for (const pair of initial.pairs) expect(new Set(pair.moving)).toEqual(new Set(pair.ids));
  await control(page, [{ type: 'parameters', values: { first: 10 } }]);
  expect((await read()).results.map((object: any) => object.value)).toEqual([2.5, 2, -0.75, 2.5]);
  await control(page, [{ type: 'parameters', values: { time: 7 } }]);
  await control(page, [{ type: 'parameters', values: { time: 17, first: 2 } }]);
  expect(await read()).toEqual(initial);
  const result = page.locator('[data-object="calculation:step:0:0"]');
  await result.press('Enter');
  await expect(result).toHaveAttribute('data-selected');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await control(page, [{ type: 'theme', value: 'dark' }]);
  await expect(result).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('a narrow physical equation remains readable and framed through input changes and reverse seek', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await openScene(page, 'math-workbench');
  await control(page, [
    { type: 'pause' },
    { type: 'parameters', values: { kind: 'multiply', first: 10, time: 17 } },
  ]);
  const read = () =>
    page.evaluate(() => {
      const scene = (document.querySelector('main') as any).scene;
      const calculation = scene.calculation,
        camera = scene.view.camera,
        stage = scene.view.renderer.domElement.getBoundingClientRect();
      let formula: any;
      calculation.object.traverse((object: any) => {
        if (
          object.name === 'surface-lettering' &&
          object.userData.visualReview().text.includes('[')
        )
          formula = object;
      });
      const plane = formula.children[0],
        image = plane.material.map.image;
      const corners = [-0.5, 0.5].flatMap((x) =>
        [-0.5, 0.5].map((y) => plane.position.clone().set(x, y, 0).applyMatrix4(plane.matrixWorld)),
      );
      const framed = corners.every((point: any) =>
        calculation.bounds.containsPoint(calculation.object.worldToLocal(point.clone())),
      );
      const projected = corners.map((point: any) => point.clone().project(camera));
      const top = Math.min(...projected.map((point: any) => ((1 - point.y) * stage.height) / 2)),
        bottom = Math.max(...projected.map((point: any) => ((1 - point.y) * stage.height) / 2));
      const weightBottom = Math.max(
        ...[...document.querySelectorAll<HTMLElement>('[data-object^="weights:"]')]
          .filter((element) => !element.hidden)
          .map((element) => element.getBoundingClientRect().bottom - stage.top),
      );
      return {
        text: formula.userData.visualReview().text.replaceAll('\u00a0', ' '),
        fontPixels: ((bottom - top) * parseFloat(image.getContext('2d').font)) / image.height,
        framed,
        withinStage: projected.every(
          (point: any) => Math.abs(point.x) < 1 && Math.abs(point.y) < 1,
        ),
        gap: top - weightBottom,
        camera: camera.position.toArray(),
        color: plane.material.color.getHexString(),
        pigment: scene.view.palette.purple.getHexString(),
      };
    });
  for (const theme of ['dark', 'light'] as const) {
    await control(page, [{ type: 'theme', value: theme }]);
    const sample = await read();
    expect(sample.text).toContain('[2.5; 2; −0.75; 2.5]');
    expect(sample.fontPixels).toBeGreaterThanOrEqual(18);
    expect(sample.framed).toBe(true);
    expect(sample.withinStage).toBe(true);
    expect(sample.gap).toBeGreaterThan(8);
    expect(sample.color).toBe(sample.pigment);
  }
  const completed = await read();
  await control(page, [{ type: 'parameters', values: { first: -4, time: 11.5 } }]);
  expect((await read()).fontPixels).toBeGreaterThanOrEqual(18);
  await control(page, [{ type: 'parameters', values: { first: 10, time: 17 } }]);
  expect(await read()).toEqual(completed);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
