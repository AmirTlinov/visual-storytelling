import { test, expect } from '@playwright/test';

test('interval inscriptions stay clear of the line at the edge and after reverse changes', async ({
  page,
}) => {
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => window.galleryReady);
  for (const width of [736, 390, 1040]) {
    await page.setViewportSize({ width, height: 1000 });
    const frames = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const scene = (document.querySelector('.ve-scene') as any).scene;
      await scene.control([{ type: 'mode', value: 'explore' }]);
      const frames = [];
      for (const speed of [2, 1, 4, 2])
        for (const time of [10, 3, 0.1, 10]) {
          await scene.control([{ type: 'parameters', values: { speed, time, detail: true } }]);
          const labels = [
            ...document.querySelectorAll<SVGGraphicsElement>(
              '[data-object="distance-plot:slope"] .vs-lettering',
            ),
          ].filter((node) => node.checkVisibility({ visibilityProperty: true }));
          const curve = document.querySelector<SVGPathElement>(
            '[data-object="distance-plot:speed"] [data-stroke] path',
          )!;
          const matrix = curve.getScreenCTM()!;
          const length = curve.getTotalLength();
          const gap =
            4 *
            Number(
              (document.querySelector('[data-scene-frame]') as HTMLElement).dataset.frameScale,
            );
          const collisions = labels
            .filter((label) => {
              const box = label.getBoundingClientRect();
              for (let i = 0; i <= 300; i++) {
                const p = curve.getPointAtLength((length * i) / 300).matrixTransform(matrix);
                if (
                  p.x >= box.left - gap &&
                  p.x <= box.right + gap &&
                  p.y >= box.top - gap &&
                  p.y <= box.bottom + gap
                )
                  return true;
              }
              return false;
            })
            .map((node) => node.getAttribute('aria-label'));
          frames.push({
            speed,
            time,
            collisions,
            labels: labels.map((node) => ({
              text: node.getAttribute('aria-label'),
              box: node.getBoundingClientRect().toJSON(),
            })),
          });
        }
      return frames;
    });
    for (const frame of frames) {
      expect(frame.collisions, `${width}px: ${frame.speed}m/s at ${frame.time}s`).toEqual([]);
      for (const { box } of frame.labels) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
    }
    if (width > 390) expect(frames[0]!.labels.map((label) => label.text)).toContain('6 м');
    const first = frames[0]!,
      last = frames.at(-1)!;
    expect(last.labels.map((label) => label.text)).toEqual(first.labels.map((label) => label.text));
    // Chromium may quantize transformed glyph boxes within a fraction of a physical pixel.
    last.labels.forEach((label, index) => {
      const before = first.labels[index]!.box;
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(Math.abs(label.box[key] - before[key])).toBeLessThan(0.1);
    });
  }
});

test('a single 16:9 graph preserves keyboard input, themes and rapid changes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  const speed = page.getByRole('slider', { name: 'Скорость, м/с', exact: true });
  await speed.focus();
  await speed.press('End');
  await page.getByRole('slider', { name: 'Время, с', exact: true }).fill('8');
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '32');
  await page.getByRole('switch', { name: 'Вторая скорость: вдвое меньше' }).check();
  await expect(page.locator('[data-plot-point="half-speed"]')).toHaveAttribute('data-value', '16');
  const geometry = await page.locator('svg#distance').getAttribute('viewBox');
  for (const width of [390, 1040])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 850 });
      const inspection = await page.evaluate(async (theme) => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        await scene.control([{ type: 'theme', value: theme }]);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return scene.presentation();
      }, theme);
      expect(inspection.clipped).toEqual([]);
      expect(inspection.frame.width / inspection.frame.height).toBeCloseTo(16 / 9, 5);
      if (width >= 1040) expect(inspection.unreadableText).toEqual([]);
      await expect(page.locator('svg#distance')).toHaveAttribute('viewBox', geometry!);
      await expect(page.locator('details,.ve-explanation-notes,.ve-captions')).toHaveCount(0);
    }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const times = await page.evaluate(async () => {
    const input = document.querySelector('input[aria-label="Время, с"]') as HTMLInputElement;
    const scene = (document.querySelector('.ve-scene') as any).scene;
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const started = performance.now();
      input.value = String((i % 10) + 0.5);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(requestAnimationFrame);
      times.push(performance.now() - started);
    }
    return { input: times.sort((a, b) => a - b), snapshot: scene.snapshot() };
  });
  expect(times.snapshot.distance).toBe(38);
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '38');
  await testInfo.attach('input-to-frame-ms', {
    body: JSON.stringify({ p95: times.input[28], samples: times.input }),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

test('prediction is placed on the plot and remains one undoable condition through resize and seek', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 800 });
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Отметить будущую точку', exact: true }).click();
  const speed = page.getByRole('slider', { name: 'Скорость, м/с', exact: true });
  await expect(speed).toBeDisabled();
  const choice = page.getByRole('button', { name: 'Прогноз: 18 м', exact: true });
  await choice.focus();
  await choice.press('Enter');
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 800 });
  const run = page.getByRole('button', { name: 'Пройти ещё 2 секунды', exact: true });
  await run.focus();
  await run.press('Enter');
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '18');
  await expect(page.locator('[data-object="prediction-result"]')).toBeFocused();
  await expect(page.locator('[data-object="prediction-result"]')).toHaveAttribute(
    'aria-label',
    'Прогноз 18 м. Получилось 18 м.',
  );
  await expect(page.locator('[data-object="speed-ratio:rise"] .vs-lettering')).toHaveAttribute(
    'aria-label',
    '6 м',
  );
  await expect(speed).toBeDisabled();
  const completed = await page.evaluate(() =>
    (document.querySelector('.ve-scene') as any).scene.capture(),
  );
  expect(completed.values).toMatchObject({
    speed: 3,
    time: 6,
    compare: false,
    practice: true,
    checked: true,
  });
  await page.getByRole('button', { name: 'Отменить условие', exact: true }).click();
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '12');
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '18');
  await page.getByRole('button', { name: 'Вернуться к графику', exact: true }).click();
  await expect(speed).toBeEnabled();
  const replay = await page.evaluate(async () => {
    const scene = (document.querySelector('.ve-scene') as any).scene;
    const take = async (time: number) => {
      await scene.control([{ type: 'seek', time }]);
      return {
        value: scene.snapshot(),
        lines: [...document.querySelectorAll('[data-stroke] path')].map((p) => p.getAttribute('d')),
      };
    };
    const first = await take(12);
    await take(0);
    return { first, again: await take(12) };
  });
  expect(replay.again).toEqual(replay.first);
  expect(replay.first.value).toMatchObject({ time: 10, distance: 30, comparison: 15 });
  for (const guess of [12, 24]) {
    await page.getByRole('button', { name: 'Отметить будущую точку', exact: true }).click();
    await page.getByRole('button', { name: `Прогноз: ${guess} м`, exact: true }).click();
    await page.getByRole('button', { name: 'Пройти ещё 2 секунды', exact: true }).click();
    const overlaps = await page.evaluate((guess) => {
      const prediction = document
        .querySelector(`[data-object="distance-plot:prediction-${guess}"] .vs-lettering`)!
        .getBoundingClientRect();
      return [
        ...document.querySelectorAll<SVGGraphicsElement>(
          '[data-object="distance-plot:slope"] .vs-lettering,[data-object="distance-plot:distance-value"] .vs-lettering',
        ),
      ]
        .filter((node) => node.checkVisibility({ visibilityProperty: true }))
        .some((node) => {
          const box = node.getBoundingClientRect();
          return (
            prediction.left < box.right &&
            prediction.right > box.left &&
            prediction.top < box.bottom &&
            prediction.bottom > box.top
          );
        });
    }, guess);
    expect(overlaps, `prediction ${guess} remains separate from the observed result`).toBe(false);
    await page.getByRole('button', { name: 'Вернуться к графику', exact: true }).click();
  }
});
