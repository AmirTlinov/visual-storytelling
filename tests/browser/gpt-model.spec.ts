import { test, expect, type Page } from '@playwright/test';
import type { SceneCommand } from '../../src/scene-access';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function ready(page: Page) {
  await page.goto('/gpt-model/index.html');
  await page.evaluate(() => window.galleryReady);
}
async function command(page: Page, commands: SceneCommand[]): Promise<any> {
  return page.evaluate(async (commands) => {
    const scene = document.querySelector<HTMLElement>('main.ve-scene')!.scene!;
    if (commands.length) await scene.control(commands);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      ...(scene.snapshot() as Record<string, unknown>),
      time: scene.inspect().time,
      playing: scene.inspect().playing,
    };
  }, commands);
}
const parameters = (values: Record<string, string | number | boolean>): SceneCommand[] => [
  { type: 'parameters', values },
];

test('embedding captions stay outside every vector row during the story and manual exploration', async ({
  page,
}) => {
  await ready(page);
  for (const width of [960, 1200]) {
    await page.setViewportSize({ width, height: 960 });
    for (const commands of [
      [
        { type: 'mode', value: 'story' },
        { type: 'seek', time: 20.5 },
      ],
      parameters({ view: 'embedding', token: 3 }),
    ] as SceneCommand[][]) {
      await command(page, commands);
      const geometry = await page.evaluate(() => {
        const captions = ['Таблица слова «на»', 'Таблица позиции 3', 'Начало residual stream'];
        const drawing = document.querySelector('#gpt-drawing')!;
        return {
          captions: captions.map((text) => ({
            text,
            box: drawing
              .querySelector<SVGElement>(`[aria-label='${text}']`)!
              .getBoundingClientRect()
              .toJSON(),
          })),
          cells: [...drawing.querySelectorAll<SVGElement>('[data-object^="embedding:"]')].map(
            (node) => node.getBoundingClientRect().toJSON(),
          ),
        };
      });
      expect(geometry.cells).toHaveLength(24);
      for (const caption of geometry.captions)
        for (const cell of geometry.cells) {
          const overlaps =
            caption.box.left < cell.right &&
            caption.box.right > cell.left &&
            caption.box.top < cell.bottom &&
            caption.box.bottom > cell.top;
          expect(overlaps, `${caption.text} at ${width}px overlaps a vector cell`).toBe(false);
        }
    }
  }
});

test('the calculation aperture clears its controls and keeps screen annotations readable in a fitted frame', async ({
  page,
}) => {
  await ready(page);
  for (const width of [390, 1200, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await command(page, parameters({ view: 'attention', perspective: 'algebra', phase: 1 }));
    const geometry = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.gpt-computation')!;
      const box = host.getBoundingClientRect();
      const button = document
        .querySelector<SVGElement>('[data-action="math-step"]')!
        .getBoundingClientRect();
      const labels = [...host.querySelectorAll<HTMLElement>('.ve-label')].filter(
        (n) => !n.hidden && n.getBoundingClientRect().height > 0,
      );
      return {
        bottom: box.bottom,
        buttonTop: button.top,
        labels: labels.map((n) => ({
          text: n.textContent,
          pixels: (parseFloat(getComputedStyle(n).fontSize) * box.width) / host.clientWidth,
        })),
      };
    });
    expect(geometry.bottom).toBeLessThan(geometry.buttonTop - 1);
    expect(geometry.labels.map((n) => n.text)).toContain('Оценка связи');
    for (const label of geometry.labels)
      expect(label.pixels, label.text ?? '').toBeGreaterThanOrEqual(17.9);
  }
  expect(
    await page.evaluate(() => {
      const label = [...document.querySelectorAll<HTMLElement>('.gpt-computation .ve-label')].find(
        (n) => !n.hidden,
      )!;
      const original = label.style.fontSize;
      label.style.fontSize = '10px';
      try {
        return document.querySelector<HTMLElement>('main.ve-scene')!.scene!.presentation()
          .unreadableText.length;
      } finally {
        label.style.fontSize = original;
      }
    }),
  ).toBeGreaterThan(0);
});

test('a short review viewport fits measured button lettering and retains subject navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await ready(page);
  await command(page, parameters({ view: 'overview' }));
  const bounds = await page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>('main.ve-scene')!.scene!;
    const buttons = [...document.querySelectorAll<SVGElement>('#gpt-drawing [data-action]')];
    return {
      errors: [...document.querySelectorAll<HTMLElement>('[data-layout-error]')].map(
        (node) => node.dataset.layoutError,
      ),
      presentation: scene.presentation(),
      stage: document.querySelector('.ve-stage')!.getBoundingClientRect().toJSON(),
      buttons: buttons.map((node) => ({
        action: node.dataset.action,
        box: node.getBoundingClientRect().toJSON(),
        label: node
          .parentElement!.querySelector('[data-lettering-size]')!
          .getBoundingClientRect()
          .toJSON(),
      })),
    };
  });
  expect(bounds.errors).toEqual([]);
  expect(bounds.presentation.outsideViewport).toBe(false);
  for (const { action, box, label } of bounds.buttons) {
    expect(box.left, action).toBeGreaterThanOrEqual(bounds.stage.left - 1);
    expect(box.right, action).toBeLessThanOrEqual(bounds.stage.right + 1);
    expect(box.top, action).toBeGreaterThanOrEqual(bounds.stage.top - 1);
    expect(box.bottom, action).toBeLessThanOrEqual(bounds.stage.bottom + 1);
    expect(label.left, action).toBeGreaterThanOrEqual(box.left + 1);
    expect(label.right, action).toBeLessThanOrEqual(box.right - 1);
    expect(label.top, action).toBeGreaterThanOrEqual(box.top + 1);
    expect(label.bottom, action).toBeLessThanOrEqual(box.bottom - 1);
  }
  await page.screenshot({ path: resolve('artifacts/gpt-acceptance/gpt-960x540-after.png') });
  await page.setViewportSize({ width: 390, height: 900 });
  for (const perspective of ['algebra', 'diagram']) {
    await command(page, parameters({ view: 'attention', perspective }));
    await expect(page.locator('.ve-conditions-trigger')).toBeVisible();
    await expect(page.locator('.ve-scene-header')).toBeVisible();
    expect(await page.locator('.ve-conditions-trigger').count()).toBe(1);
    expect(await page.locator('.ve-player').count()).toBe(1);
  }
});

test('the selected token, prediction and next pass use the same genuine model', async ({
  page,
}) => {
  await ready(page);
  let state = await command(page, parameters({ view: 'output', checked: false, token: 1 }));
  expect(state.trace.tokens[state.token]).toBe('кот');
  await expect(page.getByRole('button', { name: 'сидит', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'сидит', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить →', exact: true }).click();
  state = await command(page, []);
  expect(state.checked).toBe(true);
  expect(state.guess).toBe('сидит');
  expect(
    state.trace.probabilities[state.token].indexOf(
      Math.max(...state.trace.probabilities[state.token]),
    ),
  ).toBe(state.trace.ids[2]);
  await page.getByRole('button', { name: 'К последнему токену →', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить «ковре» →', exact: true }).click();
  state = await command(page, []);
  expect(state.trace.tokens.at(-1)).toBe('ковре');
  expect(state.token).toBe(state.trace.tokens.length - 1);
  expect(state.trace.tokens.length).toBe(5);
  expect(state.view).toBe('overview');
  const next = await command(page, parameters({ preset: 'bird-place' }));
  expect(next.generated).toBe(false);
  expect(next.trace.next.token).toBe('ветке');
  expect(next.checked).toBe(false);
  expect(next.guess).toBe('');
});

test('one frame and one player stay usable at all supported widths, themes and viewpoints', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const artifacts = resolve('artifacts/gpt-acceptance');
  await mkdir(artifacts, { recursive: true });
  for (const width of [375, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark'] as const) {
      await command(page, [
        { type: 'theme', value: theme },
        { type: 'reduced', value: true },
      ]);
      for (const [view, perspective] of [
        ['overview', 'diagram'],
        ['embedding', 'diagram'],
        ['model', 'diagram'],
        ['block', 'diagram'],
        ['attention', 'diagram'],
        ['scores', 'diagram'],
        ['norm', 'diagram'],
        ['residual', 'diagram'],
        ['mlp', 'diagram'],
        ['output', 'diagram'],
        ['projection', 'diagram'],
        ['logits', 'diagram'],
        ['logits', 'algebra'],
        ['merge', 'diagram'],
        ['attention', 'algebra'],
        ['attention', 'geometry'],
        ['attention', 'hardware'],
        ['residual', 'geometry'],
        ['mlp', 'geometry'],
        ['mlp', 'hardware'],
        ['residual', 'hardware'],
      ] as const) {
        await command(
          page,
          parameters({
            view,
            perspective,
            checked: view === 'output',
            kind: 'score',
            phase: 0.3,
            generated: false,
          }),
        );
        const geometry = await page.evaluate(() => {
          const scene = document.querySelector<HTMLElement>('main.ve-scene')!.scene!;
          const frame = document.querySelector('[data-scene-frame]')!.getBoundingClientRect();
          const buttons = [
            ...document.querySelectorAll('[data-action],.ve-player button,.ve-player select'),
          ].filter((node) => node.checkVisibility());
          return {
            presentation: scene.presentation(),
            overflow: document.documentElement.scrollWidth > innerWidth,
            buttons: buttons.map((node) => ({
              action: node.getAttribute('data-action') ?? node.getAttribute('aria-label'),
              bounds: node.getBoundingClientRect().toJSON(),
            })),
            frame: frame.toJSON(),
            controlCollisions: buttons.flatMap((node, i) => {
              const a = node.getBoundingClientRect();
              return buttons
                .slice(i + 1)
                .filter((other) => {
                  const b = other.getBoundingClientRect();
                  return (
                    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
                    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
                  );
                })
                .map((other) => [
                  node.getAttribute('data-action'),
                  other.getAttribute('data-action'),
                ]);
            }),
            labelCollisions: [...document.querySelectorAll('#gpt-drawing [data-lettering-size]')]
              .filter((node) => node.checkVisibility() && !node.closest('[aria-hidden="true"]'))
              .flatMap((node) => {
                const a = node.getBoundingClientRect();
                return buttons
                  .filter((control) => control.hasAttribute('data-action'))
                  .filter((control) => {
                    const b = control.getBoundingClientRect();
                    return (
                      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
                      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2
                    );
                  })
                  .map((control) => [
                    node.getAttribute('aria-label'),
                    control.getAttribute('data-action'),
                  ]);
              }),
          };
        });
        expect(geometry.overflow, `${width}/${theme}/${view}/${perspective}`).toBe(false);
        expect(geometry.presentation.outsideViewport).toBe(false);
        expect
          .soft(geometry.labelCollisions, `${width}/${theme}/${view}/${perspective}`)
          .toEqual([]);
        expect
          .soft(geometry.controlCollisions, `${width}/${theme}/${view}/${perspective}`)
          .toEqual([]);
        expect(geometry.frame.width / geometry.frame.height).toBeCloseTo(16 / 9, 4);
        for (const button of geometry.buttons) {
          expect(button.bounds.height, `${width}/${view}: ${button.action}`).toBeGreaterThanOrEqual(
            43.5,
          );
          expect(button.bounds.width, `${width}/${view}: ${button.action}`).toBeGreaterThanOrEqual(
            43.5,
          );
          expect(button.bounds.x).toBeGreaterThanOrEqual(-0.5);
          expect(button.bounds.x + button.bounds.width).toBeLessThanOrEqual(width + 0.5);
        }
        await expect(page.locator('.ve-player:visible')).toHaveCount(1);
        if (
          view === 'overview' ||
          (width === 1440 && ['block', 'attention', 'residual'].includes(view)) ||
          (width === 375 && perspective !== 'diagram')
        )
          await page.screenshot({
            path: resolve(artifacts, `${width}-${theme}-${view}-${perspective}.png`),
          });
      }
    }
  }
  expect(errors).toEqual([]);
});

test('embedding reveals token, position and their sum without changing the drawn geometry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  const drawing = () =>
    page.locator('#gpt-drawing').evaluate((root) => {
      const groups = [...root.querySelectorAll('[data-story-step]')];
      return {
        visible: [
          ...new Set(
            groups
              .filter((group) =>
                group.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
              )
              .map((group) => group.getAttribute('data-story-step')),
          ),
        ],
        geometry: groups.map((group) => ({
          step: group.getAttribute('data-story-step'),
          paths: [...group.querySelectorAll('path')].map((path) => path.getAttribute('d')),
        })),
      };
    });
  let geometry: Awaited<ReturnType<typeof drawing>>['geometry'] | undefined;
  for (const reduced of [false, true]) {
    await command(page, [{ type: 'reduced', value: reduced }]);
    for (const [time, visible] of [
      [11, ['embedding.word']],
      [15, ['embedding.word', 'embedding.position']],
      [19, ['embedding.word', 'embedding.position', 'embedding.sum']],
      [11, ['embedding.word']],
    ] as const) {
      await command(page, [{ type: 'seek', time }]);
      const frame = await drawing();
      expect(frame.visible, `${time}s, reduced=${reduced}`).toEqual(visible);
      geometry ??= frame.geometry;
      expect(frame.geometry, `${time}s, reduced=${reduced}`).toEqual(geometry);
    }
  }
});

test('residual annotations avoid measured text and vector strokes across coordinate planes', async ({
  page,
}) => {
  test.setTimeout(60000);
  await ready(page);
  // Three real inputs cover wide, intermediate and compact composition. Each
  // visits all adjacent planes of the eight-dimensional residual stream.
  for (const [preset, width, theme] of [
    ['cat-place', 1440, 'dark'],
    ['bird-place', 820, 'light'],
    ['position', 375, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await command(page, [
      { type: 'theme', value: theme },
      { type: 'reduced', value: true },
      ...parameters({ preset, view: 'residual', perspective: 'geometry', generated: false }),
    ]);
    for (let axis = 0; axis < 7; axis++) {
      await command(page, parameters({ axis, block: axis % 2 }));
      const geometry = await page.locator('#gpt-drawing').evaluate((root) => {
        const annotations = [...root.querySelectorAll<SVGGraphicsElement>('[data-layout-label]')];
        const labels = [
          ...root.querySelectorAll<SVGGraphicsElement>('[data-lettering-size]'),
        ].filter(
          (node) =>
            node.checkVisibility({ visibilityProperty: true }) &&
            !node.closest('[aria-hidden="true"]'),
        );
        const paths = [
          ...root.querySelectorAll<SVGPathElement>('[data-object^="line-"] path'),
        ].filter(
          (path) => path.checkVisibility({ visibilityProperty: true }) && !path.closest('defs'),
        );
        const points = paths.flatMap((path) => {
          const length = path.getTotalLength(),
            matrix = path.getScreenCTM()!;
          const count = Math.ceil(length / 2);
          return Array.from({ length: count + 1 }, (_, i) => {
            const point = path.getPointAtLength((length * i) / Math.max(1, count));
            return new DOMPoint(point.x, point.y).matrixTransform(matrix);
          });
        });
        return {
          labels: annotations.map((node) => ({
            name: node.dataset.layoutLabel,
            status: node.dataset.layoutStatus,
            visible: node.checkVisibility({ visibilityProperty: true }),
          })),
          paths: paths.length,
          labelCollisions: annotations.flatMap((node) => {
            const a = node.getBoundingClientRect();
            return labels
              .filter((other) => {
                if (other === node) return false;
                const b = other.getBoundingClientRect();
                return (
                  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.25 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.25
                );
              })
              .map((other) => [node.dataset.layoutLabel, other.getAttribute('aria-label')]);
          }),
          strokeCollisions: annotations
            .filter((node) => {
              const box = node.getBoundingClientRect();
              // Sample the actual pen paths, including arrowheads. A diagonal's
              // bounding rectangle must not reserve the empty space around it.
              return points.some(
                ({ x, y }) => x > box.left && x < box.right && y > box.top && y < box.bottom,
              );
            })
            .map((node) => node.dataset.layoutLabel),
        };
      });
      const context = `${preset}/${width}/plane ${axis + 1},${axis + 2}`;
      expect.soft(geometry.labels, context).toEqual([
        { name: 'vector-before', status: 'placed', visible: true },
        { name: 'vector-result', status: 'placed', visible: true },
        { name: 'vector-delta', status: 'placed', visible: true },
      ]);
      expect(geometry.paths, context).toBeGreaterThanOrEqual(5);
      expect.soft(geometry.labelCollisions, context).toEqual([]);
      expect.soft(geometry.strokeCollisions, context).toEqual([]);
    }
  }
});

test('ten surface transitions and reverse seeks preserve one paused subject and no wrapper zoom', async ({
  page,
}) => {
  test.setTimeout(60000);
  await ready(page);
  await page.setViewportSize({ width: 390, height: 1000 });
  await command(
    page,
    parameters({
      preset: 'bird-place',
      view: 'residual',
      perspective: 'geometry',
      block: 1,
      token: 2,
      axis: 2,
    }),
  );
  const before = await page.evaluate(() =>
    document.querySelector<HTMLElement>('main.ve-scene')!.scene!.capture(),
  );
  const control = page.locator('.ve-player [data-play]');
  await control.focus();
  for (let i = 0; i < 10; i++) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      expect(
        await page.evaluate(() =>
          document.querySelector<HTMLElement>('main.ve-scene')!.scene!.capture(),
        ),
      ).toEqual(before);
      await expect(control).toBeFocused();
      await expect(page.locator('.ve-player:visible')).toHaveCount(1);
      expect(
        await page.evaluate(() => document.querySelector('[data-scene-frame]')!.scrollLeft),
      ).toBe(0);
    }
  }
  await expect(
    page.getByRole('button', { name: /^(Читать крупнее|Открыть крупнее|Весь кадр)$/ }),
  ).toHaveCount(0);
  const a = await command(page, [{ type: 'seek', time: 47 }]);
  await command(page, [{ type: 'seek', time: 85 }]);
  const b = await command(page, [{ type: 'seek', time: 47 }]);
  expect(b).toEqual(a);
  const inspection = await page.evaluate(() =>
    document.querySelector<HTMLElement>('main.ve-scene')!.scene!.inspect(),
  );
  expect(inspection.playing).toBe(false);
});

test('prediction waits for an attempt and preserves a wrong choice on narrow and wide surfaces', async ({
  page,
}) => {
  await ready(page);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await command(page, parameters({ preset: 'cat-place', checked: false }));
    let state = await command(page, [{ type: 'seek', time: 74 }, { type: 'play' }]);
    expect(state.time).toBe(74);
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLElement>('main.ve-scene')!.scene!.inspect().playing,
      ),
    ).toBe(false);
    await page.getByRole('button', { name: 'ветке', exact: true }).click();
    state = await command(page, [{ type: 'play' }]);
    expect(state.guess).toBe('ветке');
    expect(state.checked).toBe(false);
    await page.getByRole('button', { name: 'Проверить →', exact: true }).click();
    state = await command(page, []);
    expect(state.checked).toBe(true);
    expect(state.waiting).toBeUndefined();
    await expect(page.getByRole('img', { name: 'ваш выбор', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ветке →', exact: true })).toBeVisible();
  }
});

test('opening the result directly keeps an unanswered prediction closed when Play is pressed', async ({
  page,
}) => {
  await ready(page);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await command(page, parameters({ view: 'overview', checked: false, guess: '' }));
    await page
      .getByRole('button', {
        name: width < 640 ? 'Результат →' : 'Следующее слово',
        exact: true,
      })
      .click();
    await page.locator('.ve-player [data-play]').click();
    let state = await command(page, []);
    expect(state.view).toBe('output');
    expect(state.checked).toBe(false);
    expect(state.time).toBe(74);
    await expect(page.locator('[data-action^="output-word-"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Проверить →', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'ветке', exact: true }).click();
    await page.locator('.ve-player [data-play]').click();
    state = await command(page, []);
    expect(state.guess).toBe('ветке');
    expect(state.checked).toBe(false);
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLElement>('main.ve-scene')!.scene!.inspect().playing,
      ),
    ).toBe(false);
    await expect(page.getByRole('button', { name: 'Проверить →', exact: true })).toBeVisible();
    await expect(page.locator('[data-action^="output-word-"]')).toHaveCount(0);
  }
});

for (const width of [375, 390]) {
  test(`compact ${width}px navigation exposes model details, all attention inputs and the output calculation`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    await ready(page);
    await command(page, [
      { type: 'theme', value: width === 390 ? 'dark' : 'light' },
      { type: 'reduced', value: width === 390 },
    ]);
    await mkdir(resolve('artifacts/gpt-acceptance'), { recursive: true });
    const click = async (name: string, expected: Record<string, unknown> = {}) => {
      await page.getByRole('button', { name, exact: true }).click();
      const state = await command(page, []);
      expect(state).toMatchObject(expected);
      await expect(page.locator('.ve-player:visible')).toHaveCount(1);
      return state;
    };
    const details = async (labels: string[], pageNumber = 0) => {
      const state = await click('Детали', { detailPage: 0 });
      if (pageNumber) {
        const next = page.getByRole('button', { name: 'Ещё · 1/2 →', exact: true });
        await next.focus();
        await next.press('Enter');
        await expect(page.getByRole('button', { name: 'Ещё · 2/2 →', exact: true })).toBeFocused();
        expect(await command(page, [])).toMatchObject({ view: state.view, detailPage: pageNumber });
      }
      await expect(page.locator('[data-action^="detail-"]')).toHaveCount(labels.length);
      for (const label of labels)
        await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
      const targets = await page.locator('[data-action]').evaluateAll((nodes) =>
        nodes
          .filter((node) => node.checkVisibility())
          .map((node) => ({
            label: node.getAttribute('aria-label'),
            rect: node.getBoundingClientRect().toJSON(),
          })),
      );
      for (const [index, target] of targets.entries()) {
        expect(target.rect.width, target.label ?? '').toBeGreaterThanOrEqual(43.5);
        expect(target.rect.height, target.label ?? '').toBeGreaterThanOrEqual(43.5);
        expect(target.rect.left, target.label ?? '').toBeGreaterThanOrEqual(-0.5);
        expect(target.rect.right, target.label ?? '').toBeLessThanOrEqual(width + 0.5);
        for (const other of targets.slice(index + 1)) {
          const overlap =
            Math.min(target.rect.right, other.rect.right) -
              Math.max(target.rect.left, other.rect.left) >
              2 &&
            Math.min(target.rect.bottom, other.rect.bottom) -
              Math.max(target.rect.top, other.rect.top) >
              2;
          expect(overlap, `${target.label} / ${other.label}`).toBe(false);
        }
      }
      if (pageNumber)
        await page.screenshot({
          path: resolve(
            'artifacts/gpt-acceptance',
            `${width}-${state.view}-details-${pageNumber + 1}.png`,
          ),
        });
    };

    await click('кот', { token: 1 });
    await click('Детали модели', { view: 'overview', detailPage: 0 });
    await click('Токен + позиция', { view: 'embedding', detailPage: -1, token: 1 });
    await details(['«на»: другая позиция', 'Вся модель', 'Устройство модели']);
    await click('Устройство модели', { view: 'model', token: 1 });
    await click('←', { view: 'overview', token: 1 });
    await click('2 блока GPT', { view: 'block', block: 0 });
    await details(['Attention', 'MLP', 'Residual stream', 'Блок 1 →']);
    await click('Ещё · 1/2 →', { detailPage: 1 });
    await expect(page.locator('[data-action^="detail-"]')).toHaveCount(2);
    await click('Ещё · 2/2 →', { detailPage: 0 });
    await expect(page.locator('[data-action^="detail-"]')).toHaveCount(4);
    await click('Ещё · 1/2 →', { detailPage: 1 });
    await click('LN до attention', { view: 'norm', normKind: 'ln1', block: 0 });
    await details(['LN до attention', 'LN до MLP', 'Блок GPT']);
    await click('LN до MLP', { view: 'norm', normKind: 'ln2', block: 0 });
    await click('←', { view: 'block' });
    await details(['Attention', 'MLP', 'Residual stream', 'Блок 1 →']);
    await click('Блок 1 →', { view: 'block', block: 1, detailPage: -1 });
    await details(['LN до attention', 'LN до MLP'], 1);
    await click('LN до MLP', { view: 'norm', normKind: 'ln2', block: 1 });
    await click('←', { view: 'block', block: 1 });
    await click('Attention', { view: 'attention', block: 1 });

    const attentionDetails = ['Оценки → веса', 'Q, K и V', 'Сумма вес × V', 'Объединить головы'];
    await details(attentionDetails);
    await click('Оценки → веса', { view: 'scores' });
    await details(['Q, K и V', 'Attention', 'Токен: кот →', 'Источник: кот →']);
    let state = await click('Источник: кот →', { view: 'scores', token: 1, source: 2 });
    expect(state.trace.blocks[state.block].attention.heads[state.head].probabilities[1][2]).toBe(0);
    await expect(
      page.getByRole('img', { name: '«сидит»: −∞ · будущее', exact: true }),
    ).toBeVisible();
    await details(['Q, K и V', 'Attention', 'Токен: кот →', 'Источник: сидит →']);
    await click('Q, K и V', { view: 'projection', source: 2, projection: 'q' });
    await click('Q →', { projection: 'k', source: 2 });
    await details(['Проекция Q', 'Проекция K', 'Проекция V', 'Координата 1 →']);
    await click('Проекция V', { view: 'projection', projection: 'v', token: 1, source: 2 });
    await click('Вычислить →', { view: 'projection', perspective: 'algebra', kind: 'projection' });
    await click('←', { view: 'projection', perspective: 'diagram', projection: 'v' });
    await click('←', { view: 'attention', token: 1, source: 2 });
    await details(['Токен: кот →', 'Источник: сидит →', 'Голова 1 →', 'Отключить голову'], 1);
    await click('Голова 1 →', { view: 'attention', head: 1, token: 1, source: 2 });
    await details(['Токен: кот →', 'Источник: сидит →', 'Голова 2 →', 'Отключить голову'], 1);
    state = await click('Источник: сидит →', { view: 'attention', head: 1, token: 1, source: 3 });
    expect(state.trace.blocks[1].attention.heads[1].probabilities[1][3]).toBe(0);
    await details(attentionDetails);
    await click('Оценки → веса', { view: 'scores', head: 1, source: 3 });
    await expect(page.getByRole('img', { name: '«на»: −∞ · будущее', exact: true })).toBeVisible();
    await click('←', { view: 'attention', head: 1, source: 3 });
    await details(attentionDetails);
    await click('Сумма вес × V', {
      view: 'attention',
      perspective: 'algebra',
      kind: 'mix',
      source: 3,
    });
    state = await click('Шаг →', { kind: 'mix', source: 3 });
    expect(state.phase).toBeGreaterThan(0);
    await click('←', { view: 'attention', perspective: 'diagram', kind: 'mix' });
    await details(attentionDetails);
    state = await click('Объединить головы', { view: 'merge', block: 1, token: 1 });
    expect(state.trace.blocks[1].attention.concat[1]).toHaveLength(8);
    await expect(
      page.getByRole('img', { name: '2 головы × 4 числа → 8 чисел', exact: true }),
    ).toBeVisible();
    await details(['Attention', 'Residual stream', 'Голова 2 →', 'Отключить голову']);
    await click('Residual stream', { view: 'residual', block: 1, token: 1 });
    await click('←', { view: 'block', block: 1 });
    await click('←', { view: 'overview', token: 1 });

    await click('Результат →', { view: 'output', checked: false });
    await click('сидит', { guess: 'сидит', checked: false });
    await click('Проверить →', { checked: true });
    state = await click('сидит →', { view: 'logits', token: 1 });
    expect(state.candidate).toBe(state.trace.ids[2]);
    const candidate = state.candidate;
    const score = state.trace.logits[1][candidate].toFixed(3).replace('-', '−');
    await expect(page.getByRole('img', { name: `оценка = ${score}`, exact: true })).toBeVisible();
    await click('Раскрыть 8 произведений →', {
      view: 'logits',
      perspective: 'algebra',
      kind: 'logit',
      candidate,
    });
    state = await click('Шаг →', { view: 'logits', kind: 'logit', candidate });
    expect(state.phase).toBeGreaterThan(0);
    await click('←', { view: 'logits', perspective: 'diagram', candidate });
    await click('←', { view: 'output', checked: true, guess: 'сидит' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    expect(
      await page.evaluate(
        () => document.querySelector<HTMLElement>('main.ve-scene')!.scene!.inspect().playing,
      ),
    ).toBe(false);
  });
}

test('deeper views retain position, masked sources and the selected arithmetic subject', async ({
  page,
}) => {
  await ready(page);
  const a = await command(page, parameters({ view: 'embedding', preset: 'cat-place' }));
  await page.getByRole('button', { name: '«на»: другая позиция →', exact: true }).click();
  const b = await command(page, []);
  expect(a.trace.tokens[a.token]).toBe(b.trace.tokens[b.token]);
  expect(a.trace.embedding.token[a.token]).toEqual(b.trace.embedding.token[b.token]);
  expect(a.trace.embedding.position[a.token]).not.toEqual(b.trace.embedding.position[b.token]);
  const masked = await command(page, parameters({ view: 'scores', token: 1, source: 3 }));
  expect(masked.source).toBe(3);
  expect(masked.trace.blocks[masked.block].attention.heads[masked.head].probabilities[1][3]).toBe(
    0,
  );
  const mix = await command(
    page,
    parameters({ view: 'attention', perspective: 'algebra', kind: 'mix' }),
  );
  const geometry = await command(page, parameters({ perspective: 'geometry' }));
  const hardware = await command(page, parameters({ perspective: 'hardware' }));
  expect([mix.kind, geometry.kind, hardware.kind]).toEqual(['mix', 'mix', 'mix']);
  expect([mix.source, geometry.source, hardware.source]).toEqual([3, 3, 3]);
  await command(page, parameters({ view: 'mlp', perspective: 'geometry', channel: 6, term: 31 }));
  await page.getByRole('button', { name: 'Нейрон 32 из 32 →', exact: true }).click();
  const neuron = await command(page, []);
  expect(neuron.term).toBe(0);
  expect(neuron.channel).toBe(6);
});

test('warm local input reaches the next displayed frame within the interaction budget', async ({
  page,
}) => {
  await ready(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await command(page, parameters({ view: 'attention' }));
  const timings = [];
  for (let i = 0; i < 35; i++) {
    const field = i % 2 === 0 ? 'token' : 'source';
    const value = field === 'token' ? 1 + (Math.floor(i / 2) % 3) : Math.floor(i / 2) % 4;
    const action = `${field}-${value}`;
    // Measure the actual input owner from its trusted click, excluding automation
    // dispatch. scene.control also builds an agent inspection and has a separate budget.
    const pending = await page.evaluateHandle(
      ({ action, field }) => {
        const root = document.querySelector<HTMLElement>('main.ve-scene')!;
        const scene = root.scene!;
        const abort = new AbortController();
        let start = 0,
          trusted = false;
        const matches = (event: Event) =>
          (event.target as Element).getAttribute('data-action') === action;
        const result = new Promise<any>((resolve, reject) => {
          root.addEventListener(
            'click',
            (event) => {
              if (!matches(event)) return;
              start = performance.now();
              trusted = event.isTrusted;
            },
            { capture: true, signal: abort.signal },
          );
          root.addEventListener(
            'click',
            (event) => {
              if (!matches(event)) return;
              const handlerEnd = performance.now();
              abort.abort();
              void (async () => {
                await scene.ready!();
                const ready = performance.now();
                const frames: number[] = [];
                await new Promise<void>((painted) =>
                  requestAnimationFrame(() => {
                    frames.push(performance.now());
                    requestAnimationFrame(() => {
                      frames.push(performance.now());
                      painted();
                    });
                  }),
                );
                const end = performance.now();
                const state = scene.snapshot() as Record<string, unknown>;
                resolve({
                  trusted,
                  action,
                  elapsed: end - start,
                  handler: handlerEnd - start,
                  preparation: ready - handlerEnd,
                  raf1: frames[0]! - ready,
                  raf2: frames[1]! - frames[0]!,
                  frameCount: frames.length,
                  phase: scene.rendering?.phase,
                  requested: scene.rendering?.requested.values[field],
                  presented: scene.rendering?.presented?.values[field],
                  value: state[field],
                  pressed: root
                    .querySelector(`[data-action="${action}"]`)
                    ?.getAttribute('aria-pressed'),
                  focus: (document.activeElement as HTMLElement | null)?.dataset.action,
                  playing: scene.inspect({ presentation: false }).playing,
                });
              })().catch(reject);
            },
            { signal: abort.signal },
          );
        });
        return { result };
      },
      { action, field },
    );
    try {
      await page.locator(`#gpt-drawing [data-action="${action}"]`).click();
      const measured = await pending.evaluate(({ result }) => result);
      expect(measured.trusted, action).toBe(true);
      expect(measured.phase, action).toBe('ready');
      expect([measured.requested, measured.presented, measured.value], action).toEqual([
        value,
        value,
        value,
      ]);
      expect(measured.pressed, action).toBe('true');
      expect(measured.focus, action).toBe(action);
      expect(measured.playing, action).toBe(false);
      expect(measured.frameCount, action).toBe(2);
      if (i >= 5) timings.push(measured);
    } finally {
      await pending.dispose();
    }
  }
  const samples = timings.map((sample) => sample.elapsed).sort((a, b) => a - b);
  const report = {
    samples,
    timings,
    p95: samples[Math.ceil(samples.length * 0.95) - 1],
    surface: await page.evaluate(() => [innerWidth, innerHeight]),
    input: 'trusted token/source click → subject ready → two animation frames',
    excludes: ['first preparation', 'LLM'],
  };
  await mkdir(resolve('artifacts/gpt-acceptance'), { recursive: true });
  await writeFile(
    resolve('artifacts/gpt-acceptance/performance.json'),
    JSON.stringify(report, null, 2),
  );
  expect(report.p95).toBeLessThan(100);
});

test('custom prompts drive the prediction choices and generated token on both surfaces', async ({
  page,
}) => {
  for (const width of [390, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    for (const prompt of ['кот говорит', 'сейчас кот сидит на']) {
      let state = await command(page, parameters({ prompt, view: 'output', token: 7 }));
      const next = state.trace.next.token;
      await expect(page.locator(`[data-action="guess-${next}"]`)).toBeVisible();
      await page.locator(`[data-action="guess-${next}"]`).click();
      await page.locator('[data-action="check-prediction"]').click();
      state = await command(page, []);
      const original = state.trace.tokens;
      await page.locator('[data-action="generate"]').click();
      state = await command(page, []);
      expect(state.trace.tokens).toEqual([...original, next]);
      expect(state.token).toBe(original.length);
      await command(page, parameters({ view: 'output' }));
      await page.locator('[data-action="generate"]').click();
      state = await command(page, []);
      expect(state.trace.tokens).toEqual(original);
      expect(state.token).toBe(original.length - 1);
    }
  }
});

test('a full teaching context remains readable and editable through the same document owner', async ({
  page,
}) => {
  for (const width of [375, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    const prompt = 'сейчас кот сидит на ковре кот говорит';
    let state = await command(page, parameters({ prompt, view: 'attention' }));
    expect(state.trace.tokens.length).toBe(8);
    const p = await page.evaluate(() =>
      document.querySelector<HTMLElement>('main.ve-scene')!.scene!.presentation(),
    );
    expect(p.clipped).toEqual([]);
    expect(p.unreadableText).toEqual([]);
    expect(p.layoutOverflow).toEqual([]);
    const overlaps = await page.locator('[data-action^="source-"]').evaluateAll((nodes) =>
      nodes.flatMap((a, i) =>
        nodes
          .slice(i + 1)
          .filter((b) => {
            const x = a.getBoundingClientRect(),
              y = b.getBoundingClientRect();
            return (
              Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1 &&
              Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1
            );
          })
          .map((b) => [a.getAttribute('data-action'), b.getAttribute('data-action')]),
      ),
    );
    expect(overlaps).toEqual([]);
    await command(page, parameters({ view: 'output' }));
    await command(page, parameters({ checked: true }));
    await expect(page.locator('[data-action="generate"]')).toHaveCount(0);
    const result = await page.evaluate(async () => {
      const root = document.querySelector<HTMLElement>('main.ve-scene')!,
        scene = root.scene!,
        author = scene.authoring!;
      const doc = author.prepare(author.document, [
        {
          op: 'set-inputs',
          modelId: 'gpt',
          values: { prompt: 'пёс говорит', token: 2, checked: false, generated: false, guess: '' },
        },
      ]);
      await author.replace(doc, {
        authoredInputs: ['prompt', 'token', 'checked', 'generated', 'guess'],
      });
      const edited = author.prepare(author.document, [
        {
          op: 'set-chapters',
          chapters: (author.document as any).chapters.map((c: any, i: number) =>
            i
              ? c
              : {
                  ...c,
                  beats: c.beats.map((b: any, j: number) =>
                    j ? b : { ...b, seconds: b.seconds + 2 },
                  ),
                },
          ),
        },
      ]);
      await author.replace(edited);
      let rejected = false;
      try {
        author.prepare(author.document, [
          { op: 'set-inputs', modelId: 'gpt', values: { prompt: 'внесловарное' } },
        ]);
      } catch {
        rejected = true;
      }
      return {
        same: root.scene === scene,
        rejected,
        document: author.document,
        state: scene.snapshot(),
        duration: scene.inspect().duration,
      };
    });
    expect(result.same).toBe(true);
    expect(result.rejected).toBe(true);
    expect((result.document as any).models[0].inputs.prompt).toBe('пёс говорит');
    expect((result.state as any).trace.next.token).toBe('гав');
    expect(result.duration).toBe(96);
    expect(await page.locator('.ve-player').count()).toBe(1);
    state = await command(page, parameters({ view: 'overview' }));
    expect(state.trace.tokens).toEqual(['<начало>', 'пёс', 'говорит']);
  }
});

test('a validated prompt keeps a draft while typing and commits only a complete vocabulary phrase', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await ready(page);
  await page.getByRole('button', { name: 'Условия', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Своя фраза', exact: true });
  await input.pressSequentially('кот говорит');
  expect((await command(page, [])).prompt).toBe('');
  await expect(input).toHaveValue('кот говорит');
  await input.press('Enter');
  expect((await command(page, [])).trace.next.token).toBe('мяу');
  await input.press('Backspace');
  await input.pressSequentially('т');
  await input.press('Tab');
  expect((await command(page, [])).prompt).toBe('кот говорит');
  await input.fill('пёс говорит');
  await input.press('Escape');
  await expect(input).toHaveValue('кот говорит');
  await input.fill('кот говорит неизвестное');
  await input.press('Enter');
  await expect(page.locator('main.ve-scene > .ve-status')).not.toBeEmpty();
  expect((await command(page, [])).prompt).toBe('кот говорит');
  await expect(input).toHaveValue('кот говорит');
});

test('checkpoints and source episode edits preserve the complete accepted GPT attempt', async ({
  page,
}) => {
  await ready(page);
  await command(page, parameters({ view: 'attention', token: 1, source: 0, head: 1 }));
  const checkpoint = await page.evaluate(() =>
    document.querySelector<HTMLElement>('main.ve-scene')!.scene!.capture(),
  );
  await command(page, parameters({ token: 2, source: 2 }));
  await page.evaluate(
    (saved) => document.querySelector<HTMLElement>('main.ve-scene')!.scene!.restore(saved),
    checkpoint,
  );
  let state = await command(page, []);
  expect(state.token).toBe(1);
  expect(state.source).toBe(0);
  expect(state.head).toBe(1);
  await command(page, parameters({ view: 'output', token: 3 }));
  await command(page, parameters({ checked: true, guess: 'полу' }));
  await page.locator('[data-action="generate"]').click();
  const before = await command(page, []);
  await page.evaluate(async () => {
    const author = document.querySelector<HTMLElement>('main.ve-scene')!.scene!.authoring!;
    const source = author.document as any;
    const next = author.prepare(source, [
      {
        op: 'set-chapters',
        chapters: source.chapters.map((c: any) => ({
          ...c,
          id: 'episode-' + c.id,
          beats: c.beats.map((b: any) => ({ ...b, id: 'beat-' + b.id })),
        })),
      },
    ]);
    await author.replace(next);
  });
  state = await command(page, []);
  for (const key of ['prompt', 'token', 'source', 'head', 'checked', 'generated', 'guess'])
    expect(state[key], key).toEqual(before[key]);
  expect(state.trace).toEqual(before.trace);
  await command(page, [
    { type: 'mode', value: 'story' },
    { type: 'seek', time: 15 },
  ]);
  expect((await command(page, [])).view).toBe('embedding');
  await command(page, parameters({ view: 'output' }));
  await command(page, parameters({ checked: true }));
  expect((await command(page, [])).time).toBe(82);
});

test('changing a declared representation changes the model, its semantic object and its label', async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>('main.ve-scene')!,
      scene = root.scene!,
      author = scene.authoring!;
    const doc = author.document as any;
    const next = author.prepare(doc, [
      {
        op: 'set-views',
        views: doc.views.map((v: any, i: number) => (i ? v : { ...v, kind: 'mlp' })),
      },
    ]);
    await author.replace(next);
    await scene.control([
      { type: 'mode', value: 'story' },
      { type: 'seek', time: 0 },
    ]);
    return { state: scene.snapshot(), objects: scene.inspect({ presentation: false }).objects };
  });
  expect((result.state as any).view).toBe('mlp');
  expect(result.objects!.find((o) => o.id === 'gpt.view.overview')!.label).toContain('MLP');
  await command(page, parameters({ view: 'attention', token: 1 }));
  const objects = await page.evaluate(() =>
    document.querySelector<HTMLElement>('main.ve-scene')!.scene!.objects!(),
  );
  expect(objects.find((o) => o.id === 'gpt:token-1')!.provenance).toMatchObject({
    model: 'gpt',
    position: 1,
    token: 'кот',
  });
  await command(page, [{ type: 'select', ids: ['gpt:token-1'] }]);
});

test('cold math paints without RAF and cancelling its preparation preserves the accepted SVG', async ({
  page,
}) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const scene = document.querySelector<HTMLElement>('main.ve-scene')!.scene!;
    const raf = window.requestAnimationFrame,
      cancel = window.cancelAnimationFrame;
    const callbacks = new Map<number, FrameRequestCallback>();
    let serial = 100000;
    window.requestAnimationFrame = (callback) => {
      callbacks.set(++serial, callback);
      return serial;
    };
    window.cancelAnimationFrame = (id) => {
      callbacks.delete(id);
    };
    try {
      await scene.control([
        { type: 'parameters', values: { view: 'attention', perspective: 'algebra' } },
      ]);
      await scene.ready!();
      const canvas = document.querySelector<HTMLCanvasElement>('.gpt-computation canvas')!,
        gl = canvas.getContext('webgl2')!;
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return {
        painted: pixels.some((v, i) => i % 4 === 3 && v > 0),
        phase: scene.rendering?.phase,
        state: scene.snapshot(),
      };
    } finally {
      window.requestAnimationFrame = raf;
      window.cancelAnimationFrame = cancel;
    }
  });
  expect(result.painted).toBe(true);
  expect(result.phase).toBe('ready');
  await ready(page);
  const cancelled = await page.evaluate(async () => {
    const scene = document.querySelector<HTMLElement>('main.ve-scene')!.scene!;
    const before = scene.snapshot(),
      svg = document.querySelector('#gpt-drawing')!.outerHTML;
    const queue = window.queueMicrotask,
      held: VoidFunction[] = [];
    window.queueMicrotask = (fn) => held.push(fn);
    try {
      const pending = scene.control([
        { type: 'parameters', values: { view: 'attention', perspective: 'algebra' } },
      ]);
      const preparing = scene.rendering?.phase;
      const preparingHost = document.querySelector<HTMLElement>('.gpt-computation')!;
      const concealed =
        preparingHost.hasAttribute('data-presentation-pending') && preparingHost.inert;
      await scene.control([
        { type: 'parameters', values: { view: 'overview', perspective: 'diagram' } },
      ]);
      held.splice(0).forEach((fn) => queue(fn));
      await pending;
      const host = document.querySelector<HTMLElement>('.gpt-computation')!;
      return {
        preparing,
        concealed,
        sameSVG: svg === document.querySelector('#gpt-drawing')!.outerHTML,
        hidden: host.hidden,
        pending: host.hasAttribute('data-presentation-pending'),
        state: scene.snapshot(),
        before,
      };
    } finally {
      window.queueMicrotask = queue;
      held.splice(0).forEach((fn) => queue(fn));
    }
  });
  expect(cancelled.preparing).toBe('preparing');
  expect(cancelled.concealed).toBe(true);
  expect(cancelled.sameSVG).toBe(true);
  expect(cancelled.hidden).toBe(true);
  expect(cancelled.pending).toBe(false);
});
