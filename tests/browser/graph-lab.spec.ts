import { test, expect } from '@playwright/test';

test('interval inscriptions stay clear of the line at the edge and after reverse changes', async ({
  page,
}) => {
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => window.galleryReady);
  for (const width of [736, 390, 1040]) {
    await page.setViewportSize({ width, height: 1000 });
    const frames = await page.evaluate(async () => {
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
          const collisions = labels
            .filter((label) => {
              const box = label.getBoundingClientRect();
              for (let i = 0; i <= 300; i++) {
                const p = curve.getPointAtLength((length * i) / 300).matrixTransform(matrix);
                if (
                  p.x >= box.left - 4 &&
                  p.x <= box.right + 4 &&
                  p.y >= box.top - 4 &&
                  p.y <= box.bottom + 4
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
    expect(frames.at(-1)).toEqual(frames[0]);
  }
});

test('graph keeps coordinates, keyboard input and rapid updates readable', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 850 });
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  const speed = page.getByRole('slider', { name: 'Скорость, м/с', exact: true });
  await speed.focus();
  await speed.press('End');
  await page.getByRole('slider', { name: 'Время, с', exact: true }).fill('8');
  await expect(page.locator('[data-graph-reading]')).toHaveText('8 с × 4 м/с = 32 м.');
  await expect(page.locator('[data-plot-point="speed"]')).toHaveAttribute('data-value', '32');
  await page.getByRole('switch', { name: 'Сравнить с половиной скорости' }).check();
  await expect(page.locator('[data-plot-point="half-speed"]')).toHaveAttribute('data-value', '16');
  for (const width of [390, 1000])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 850 });
      const inspection = await page.evaluate(async (theme) => {
        const scene = (document.querySelector('.ve-scene') as any).scene;
        await scene.control([{ type: 'theme', value: theme }]);
        await new Promise(requestAnimationFrame);
        return scene.presentation();
      }, theme);
      expect(inspection.clipped).toEqual([]);
      expect(inspection.unreadableText).toEqual([]);
    }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 850 });
  const edge = await page.evaluate(async () => {
    const scene = (document.querySelector('.ve-scene') as any).scene;
    await scene.control([
      { type: 'parameters', values: { speed: 1, time: 0.1, compare: true, detail: true } },
    ]);
    const labels = ['distance-value', 'comparison-value'].map((id) =>
      document
        .querySelector(`[data-object="${id}"] .vs-lettering`)!
        .getBoundingClientRect()
        .toJSON(),
    );
    const interval = [
      ...document.querySelectorAll('[data-object="distance-plot:slope"] .vs-lettering'),
    ].filter((element) => element.checkVisibility({ visibilityProperty: true }));
    return { labels, interval: interval.length, snapshot: scene.snapshot() };
  });
  expect(edge.labels[0].bottom + 7).toBeLessThanOrEqual(edge.labels[1].top);
  expect(edge.interval).toBe(0);
  expect(edge.snapshot.distance).toBe(0.1);
  await expect(page.locator('[data-graph-ratio]')).toHaveText('0,1 м / 0,1 с = 1 м/с');
  await speed.fill('4');
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

test('local reasoning and the prediction remain one undoable condition through resize and seek', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 1100 });
  await page.goto('/graph-lab/index.html');
  await page.evaluate(() => window.galleryReady);
  const detail = page.getByText('Откуда берётся наклон?', { exact: true });
  await detail.focus();
  await detail.press('Enter');
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(page.locator('[data-object="distance-plot:slope"]')).toBeVisible();
  await expect(page.locator('[data-graph-ratio]')).toHaveText('9 м / 3 с = 3 м/с');

  await page.getByText('Предскажите следующую точку', { exact: true }).click();
  const speed = page.getByRole('slider', { name: 'Скорость, м/с', exact: true });
  await expect(speed).toBeDisabled();
  await page.getByRole('button', { name: '18 м', exact: true }).click();
  await page.getByRole('button', { name: 'Пройти ещё две секунды', exact: true }).click();
  await expect(page.locator('[data-graph-reading]')).toHaveText('6 с × 3 м/с = 18 м.');
  await expect(page.locator('.ve-prediction [role=status]')).toBeFocused();
  await expect(page.locator('.ve-prediction [role=status]')).toContainText(
    'Верно. Получилось 18 м',
  );
  await expect(speed).toBeDisabled();
  const completed = await page.evaluate(() => {
    const scene = (document.querySelector('.ve-scene') as any).scene;
    return scene.capture();
  });
  expect(completed.values).toMatchObject({
    speed: 3,
    time: 6,
    compare: false,
    practice: true,
    checked: true,
  });
  await page.getByRole('button', { name: 'Отменить условие', exact: true }).click();
  await expect(page.locator('[data-graph-reading]')).toHaveText('4 с × 3 м/с = 12 м.');
  await expect(page.getByRole('button', { name: '18 м', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('[data-graph-reading]')).toHaveText('6 с × 3 м/с = 18 м.');
  const restored = await page.evaluate(async () => {
    const scene = (document.querySelector('.ve-scene') as any).scene;
    let inputError = '';
    try {
      await scene.control([{ type: 'parameters', values: { time: 8 } }]);
    } catch (error) {
      inputError = (error as Error).message;
    }
    return { values: scene.capture().values, notices: scene.restoreNotices, inputError };
  });
  expect(restored.values).toEqual(completed.values);
  expect(restored.notices).toEqual([]);
  expect(restored.inputError).toContain('Invalid scene parameter: time');
  await page.getByText('Предскажите следующую точку', { exact: true }).click();
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
  await expect(page.locator('[data-graph-reading]')).toHaveText(
    '10 с × 3 м/с = 30 м; при 1,5 м/с — 15 м.',
  );
});
