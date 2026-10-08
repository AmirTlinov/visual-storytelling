import { test, expect } from '@playwright/test';

test('the whole lesson remains one bounded 16:9 frame through narration and exploration', async ({
  page,
}) => {
  await page.goto('/memory-register/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  const frame = page.locator('[data-scene-frame]');
  const geometry = () =>
    page.evaluate(() =>
      ['[data-scene-frame]', 'h1', '.ve-stage', '.memory-drawing', '[data-player]'].map(
        (selector) => {
          const { x, y, width, height } = document.querySelector(selector)!.getBoundingClientRect();
          return [x + scrollX, y + scrollY, width, height].map(
            (value) => Math.round(value * 100) / 100,
          );
        },
      ),
    );
  for (const viewport of [
    { width: 960, height: 900 },
    { width: 1440, height: 900 },
    { width: 980, height: 400 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect
      .poll(() =>
        frame.evaluate((element) => {
          const r = element.getBoundingClientRect();
          return (
            Math.abs(r.width / r.height - 16 / 9) < 0.001 &&
            r.left >= 0 &&
            r.top + scrollY >= 0 &&
            r.right <= innerWidth + 0.1
          );
        }),
      )
      .toBe(true);
    const baseline = await geometry();
    for (const time of [0, 22.6, 34, 58, 8]) {
      await page.evaluate((t) => (document.querySelector('#ve-scene') as any).scene.seek(t), time);
      expect(await geometry()).toEqual(baseline);
    }
    await page.locator('[data-mode="explore"]').click();
    expect(await geometry()).toEqual(baseline);
    for (const id of ['inside', 'trace-panel']) {
      await page.locator(`[data-panel="${id}"]`).click();
      await expect(page.locator('#' + id)).toBeVisible();
      expect(await geometry()).toEqual(baseline);
      await page.keyboard.press('Escape');
    }
    await page.locator('#challenge-start').click();
    await page.locator('[data-panel="inside"]').click();
    await expect(page.locator('#challenge')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#challenge')).toBeVisible();
    await page.locator('.ve-prediction').getByRole('button', { name: '42', exact: true }).click();
    await page.getByRole('button', { name: 'Проверить фронтом ↑' }).click();
    expect(await geometry()).toEqual(baseline);
    const chapter = page.getByRole('combobox', { name: 'Глава', exact: true });
    await chapter.click();
    const menu = page.getByRole('listbox', { name: 'Глава', exact: true });
    await expect(menu).toBeVisible();
    const bounds = (await frame.boundingBox())!;
    const popup = (await menu.boundingBox())!;
    expect(popup.x).toBeGreaterThanOrEqual(bounds.x);
    expect(popup.y).toBeGreaterThanOrEqual(bounds.y);
    expect(popup.x + popup.width).toBeLessThanOrEqual(bounds.x + bounds.width + 0.1);
    expect(popup.y + popup.height).toBeLessThanOrEqual(bounds.y + bounds.height + 0.1);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    expect(await geometry()).toEqual(baseline);
  }
});

test('the narrow lesson reflows without replacing its scene or the saved experiment', async ({
  page,
}) => {
  await page.goto('/memory-register/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  await page.locator('[data-mode="explore"]').click();
  await page.locator('[data-value="42"]').click();
  await page.locator('#enable').click();
  await page.locator('#clock').click();
  await page.locator('[data-select="7"]').click();
  const before = await page.evaluate(() => {
    const scene = (document.querySelector('.ve-scene') as any).scene;
    (window as any).originalScene = scene;
    return scene.snapshot();
  });
  for (const width of [375, 960, 820, 960]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('[data-scene-frame]')).toHaveAttribute(
      'data-frame-layout',
      width < 936 ? 'responsive' : 'fixed',
    );
    await expect(page.locator('#inside')).toBeVisible();
    const current = await page.evaluate(() => {
      const scene = (document.querySelector('.ve-scene') as any).scene;
      const frame = document.querySelector<HTMLElement>('[data-scene-frame]')!;
      const paragraph = document.querySelector('#detail-bit')!;
      return {
        sameOwner: scene === (window as any).originalScene,
        state: scene.snapshot(),
        textPixels:
          parseFloat(getComputedStyle(paragraph).fontSize) * Number(frame.dataset.frameScale),
        fits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(current.sameOwner).toBe(true);
    expect(current.state).toEqual(before);
    expect(current.textPixels).toBeGreaterThanOrEqual(width < 936 ? 18 : 14);
    expect(current.fits).toBe(true);
  }
});

test('chapter navigation stays compact while notebook disclosures retain keyboard behavior', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.goto('/memory-register/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  const chapter = page.getByRole('combobox', { name: 'Глава', exact: true });
  const title = page.locator('h1');
  await expect(title).toHaveText('Как 8 бит запоминают число');
  const layout = await chapter.evaluate((element) => {
    const root = element.closest('.ve-scene')!;
    const heading = root.querySelector('h1')!;
    const rect = element.getBoundingClientRect();
    return {
      left: Math.abs(rect.left - heading.getBoundingClientRect().left) < 1,
      below: rect.top > heading.getBoundingClientRect().bottom,
      compact:
        rect.width <= 320 &&
        rect.height <= 44 &&
        parseFloat(getComputedStyle(element).fontSize) <= 17,
      separate: !heading.contains(element),
    };
  });
  expect(layout).toEqual({ left: true, below: true, compact: true, separate: true });
  await chapter.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(chapter).toHaveText('Вход ещё не записан');
  expect(Number(await page.locator('[data-seek]').inputValue())).toBeGreaterThan(10);
  const stageTop = () =>
    page.locator('.ve-stage').evaluate((element) => element.getBoundingClientRect().top + scrollY);
  const before = await stageTop();
  await page.locator('[data-bit="7"]').click();
  await expect(page.locator('#ve-scene')).toHaveAttribute('data-scene-mode', 'explore');
  await expect(chapter).toBeVisible();
  expect(await stageTop()).toBe(before);
  const detail = page.locator('#inside');
  const opener = page.locator('[data-panel="inside"]');
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(detail).toBeVisible();
  await expect(detail).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(opener).toBeFocused();
  for (let i = 0; i < 2; i++) {
    await opener.click();
    await detail.locator('[data-close-panel]').click();
  }
  await expect(detail).toBeHidden();
  expect(await stageTop()).toBe(before);
});

test('drawn register writes only at an enabled edge and keeps prediction before reveal', async ({
  page,
}) => {
  await page.goto('/memory-register/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  await page.locator('[data-mode="explore"]').click();
  const input = page.locator('#input-value'),
    saved = page.locator('#saved-value');
  await page.locator('[data-value="42"]').click();
  await expect(input).toHaveText('42');
  await page.locator('#clock').click();
  await expect(saved).toHaveText('0');
  await page.locator('#clock').click();
  await page.locator('#enable').click();
  await page.locator('#clock').click();
  await expect(saved).toHaveText('42');
  await expect(page.locator('#enable')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('#clock').getAttribute('aria-pressed')).toBeNull();
  await page.locator('[data-value="165"]').click();
  await expect(saved).toHaveText('42');
  await page.locator('#clock').click();
  await expect(saved).toHaveText('42');
  await page.locator('#clock').click();
  await expect(saved).toHaveText('165');
  await page.locator('#challenge-start').click();
  await expect(page.getByRole('button', { name: 'Проверить фронтом ↑' })).toBeDisabled();
  await page.locator('[data-bit="7"]').click({ force: true });
  await expect(input).toHaveText('165');
  await page.locator('.ve-prediction').getByRole('button', { name: '165', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить фронтом ↑' }).click();
  await expect(saved).toHaveText('42');
  await expect(page.locator('.ve-prediction [role=status]')).toContainText('Получилось 42');
  await page.locator('#next-challenge').click();
  await page.locator('.ve-prediction').getByRole('button', { name: '165', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить фронтом ↑' }).click();
  await expect(saved).toHaveText('165');
  await expect(page.locator('.ve-prediction [role=status]')).toContainText('Верно');
});

test('narrow notebook keeps drawn targets apart and keyboard activation changes one bit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/memory-register/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  const paper = () =>
    page.locator('#ve-scene').evaluate((element) => {
      const style = getComputedStyle(element);
      return { paper: style.backgroundColor, ink: style.color };
    });
  const dark = await paper();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(paper).not.toEqual(dark);
  const light = await paper();
  expect(dark.paper).toBe('rgba(0, 0, 0, 0)');
  expect(light.paper).toBe(dark.paper);
  expect(light.ink).not.toBe(dark.ink);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(paper).toEqual(dark);
  const bit = page.locator('[data-bit="7"]');
  await bit.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#input-value')).toHaveText('128');
  for (let i = 0; i < 10; i++) await bit.click();
  await expect(page.locator('#input-value')).toHaveText('128');
  const layout = await page.evaluate(() => {
    const rectangles = [...document.querySelectorAll('[data-bit]')].map((node) =>
      node.getBoundingClientRect(),
    );
    return {
      separated: rectangles.every((r, i) => !i || rectangles[i - 1]!.right < r.left),
      fits: document.documentElement.scrollWidth <= innerWidth,
      focusable: document.querySelector('[data-bit="7"]')!.getAttribute('tabindex'),
      grid: document.querySelectorAll('#memory-register > .vs-grid > path').length,
    };
  });
  expect(layout).toEqual({ separated: true, fits: true, focusable: '0', grid: 0 });
  await page.locator('[data-select="7"]').click();
  await expect(page.locator('#inside')).toBeVisible();
  await expect(page.locator('#detail-bit')).toContainText('Бит 7');
  await page.locator('[data-mode="story"]').click();
  await page.locator('[data-seek]').fill('8');
  await expect(page.locator('[data-caption]')).not.toBeEmpty();
  for (const width of [375, 960]) {
    await page.setViewportSize({ width, height: 1000 });
    const sheet = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('#ve-scene')!;
      const stage = root.querySelector('.ve-stage')!;
      const caption = root.querySelector('[data-caption]')!;
      const player = root.querySelector('[data-player]')!;
      const bounds = root.getBoundingClientRect();
      return {
        grid: getComputedStyle(root.querySelector('.ve-scene-content')!).backgroundImage.includes(
          'linear-gradient',
        ),
        inside: [root.querySelector('h1')!, stage, player].every((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.left >= bounds.left && rect.right <= bounds.right && rect.bottom <= bounds.bottom
          );
        }),
        notesInStage: stage.contains(root.querySelector('.memory-notes')),
        transcriptOnly: caption.classList.contains('sr-only'),
        playerBelow: player.getBoundingClientRect().top >= stage.getBoundingClientRect().bottom,
        fits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(sheet).toEqual({
      grid: true,
      inside: true,
      notesInStage: true,
      transcriptOnly: true,
      playerBelow: true,
      fits: true,
    });
  }
  expect(errors).toEqual([]);
});

test('narration writes local causes beside changing objects and survives seeking and manual input', async ({
  page,
}) => {
  await page.goto('/memory-register/index.html');
  await page.evaluate(() => (window as any).galleryReady);
  const seek = (time: number) =>
    page.evaluate((t) => (document.querySelector('#ve-scene') as any).scene.seek(t), time);
  const note = (name: string) => page.locator(`[data-narrative-note="${name}"]`);
  for (const width of [375, 960]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [time, name, phrase] of [
      [12.5, 'input', 'Выставляем 42'],
      [16, 'memory', 'по-прежнему 0'],
      [19.1, 'enable', 'Ждём фронт'],
      [21, 'clock', 'из 0 в 1'],
      [27.2, 'memory', 'Теперь здесь 42'],
      [34, 'memory', 'нового фронта не было'],
      [44, 'memory', 'запись запрещена'],
      [47, 'memory', 'нужны оба условия'],
    ] as const) {
      await seek(time);
      await expect(note(name)).toHaveAttribute('aria-label', new RegExp(phrase));
      const layout = await page.evaluate(() => {
        const svg = document.querySelector('#memory-register')!.getBoundingClientRect();
        const controls = [
          ...document.querySelectorAll(
            '[data-bit], [data-select], #enable, #clock, [data-object^="note-"]',
          ),
        ].map((e) => e.getBoundingClientRect());
        const notes = [...document.querySelectorAll('[data-narrative-note]')]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0);
        const overlaps = (a: DOMRect, b: DOMRect) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          fits: notes.every(
            (r) => r.left >= svg.left && r.right <= svg.right && r.bottom <= svg.bottom,
          ),
          clear: notes.every(
            (r, i) =>
              !controls.some((c) => overlaps(r, c)) &&
              !notes.slice(i + 1).some((n) => overlaps(r, n)),
          ),
          nearby:
            document.querySelector('[data-narrative-note="input"]')!.getBoundingClientRect()
              .bottom < document.querySelector('[data-bit]')!.getBoundingClientRect().top,
        };
      });
      expect(layout, `local notes at ${time}s / ${width}px`).toEqual({
        fits: true,
        clear: true,
        nearby: true,
      });
    }
  }
  await seek(34);
  const held = await note('memory').innerHTML();
  await expect(note('input')).toHaveAttribute('aria-label', /здесь 165/);
  await expect(page.locator('#saved-value')).toHaveText('42');
  await seek(58);
  await seek(34);
  expect(await note('memory').innerHTML()).toBe(held);
  await seek(22.6);
  const pulses = page.locator('[data-object="byte-transfer"]');
  await expect(pulses).toBeVisible();
  const heights = await pulses
    .locator('path')
    .evaluateAll((paths) => paths.map((p) => p.getBoundingClientRect().top));
  expect(heights).toHaveLength(8);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(2);
  await page.locator('[data-bit="7"]').click();
  await expect(note('input')).toHaveAttribute('aria-label', /На входе 170/);
  await expect(note('memory')).toHaveAttribute('aria-label', /хранится 42/);
  await expect(pulses).not.toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seek(22.6);
  await expect(pulses).not.toBeVisible();
  await expect(note('memory')).toHaveAttribute('aria-label', /весь байт в памяти/);
});
