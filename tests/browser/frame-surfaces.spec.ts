import { openFixture } from '../support/fixture.mjs';
import { test, expect } from '@playwright/test';

test('the same complete frame follows native surface sizes without changing state or focus', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [example, entry] of [
    ['scene-shell', 'index.html'],
    ['arithmetic', 'tensor.html'],
    ['chapters', 'index.html'],
  ])
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await openFixture(page, example, entry);
      await page.evaluate(() => window.galleryReady);
      const capture = () =>
        page.evaluate(() => document.querySelector<HTMLElement>('.ve-scene')!.scene!.capture());
      const before = await capture();
      const control = page.locator('.ve-player button').first();
      await control.focus();
      for (const width of [1440, 390, 1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect
          .poll(() =>
            page.locator('[data-scene-frame]').evaluate((node) => {
              const frame = node.getBoundingClientRect();
              const content = node.firstElementChild!.getBoundingClientRect();
              const root = node.parentElement!,
                style = getComputedStyle(root),
                availableWidth =
                  root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                body = getComputedStyle(document.body),
                chrome = root.getBoundingClientRect().height - frame.height,
                availableHeight =
                  innerHeight -
                  root.getBoundingClientRect().top -
                  chrome -
                  (parseFloat(body.marginBottom) || 0) -
                  (parseFloat(body.paddingBottom) || 0),
                expectedWidth = Math.min(availableWidth, (availableHeight * 16) / 9);
              return Math.max(
                Math.abs(frame.width - expectedWidth),
                Math.abs(frame.width - content.width),
                Math.abs(frame.height - content.height),
                -frame.left,
                -frame.top,
                frame.right - innerWidth,
                frame.bottom - innerHeight,
              );
            }),
          )
          .toBeLessThan(1);
        const inspection = await page.evaluate(() =>
          document.querySelector<HTMLElement>('.ve-scene')!.scene!.presentation(),
        );
        expect(inspection.frame.width / inspection.frame.height).toBeCloseTo(16 / 9, 3);
        expect(inspection.outsideViewport).toBe(false);
        expect(inspection.clipped).toEqual([]);
        if (width === 1440)
          expect(inspection.unreadableText, `${example}, ${colorScheme}: expanded surface`).toEqual(
            [],
          );
        const after = await capture();
        const { view: beforeView, ...beforeSubject } = before as any;
        const { view: afterView, ...afterSubject } = after as any;
        expect(afterSubject).toEqual(beforeSubject);
        if (beforeView?.following) {
          // An authored shot fits the same subjects to the new aperture. Its
          // distance and aspect adapt; its subject and viewing direction do not.
          const direction = (view: any) => {
            const delta = view.position.map((value: number, i: number) => value - view.target[i]);
            const length = Math.hypot(...delta);
            return delta.map((value: number) => value / length);
          };
          expect(afterView.following).toBe(true);
          expect(afterView.kind).toBe(beforeView.kind);
          expect(afterView.subjects).toEqual(beforeView.subjects);
          expect(afterView.aspect).toBeGreaterThan(0);
          const previousDirection = direction(beforeView);
          direction(afterView).forEach((value: number, i: number) =>
            expect(value).toBeCloseTo(previousDirection[i], 7),
          );
        } else expect(afterView).toEqual(beforeView);
        await expect(control).toBeFocused();
        expect(
          await page
            .locator('[data-scene-frame]')
            .evaluate((node) => [node.scrollLeft, node.scrollTop]),
        ).toEqual([0, 0]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width,
        );
        expect(
          await page
            .getByRole('button', { name: /^(Читать крупнее|Открыть крупнее|Весь кадр)$/ })
            .count(),
        ).toBe(0);
      }
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openFixture(page, 'scene-shell');
  await page.evaluate(() => window.galleryReady);
  await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
  await expect(page.locator('.ve-player:visible')).toHaveCount(1);
  const speed = page.getByRole('slider', { name: 'По горизонтали', exact: true });
  await speed.focus();
  await speed.press('End');
  await expect(speed).toHaveValue('3');
  expect(
    await page.evaluate(
      () =>
        document
          .querySelector<HTMLElement>('.ve-scene')!
          .scene!.inspect()
          .parameters.find((p) => p.key === 'x')!.value,
    ),
  ).toBe(3);
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(speed).toHaveValue('3');
  await expect(speed).toBeFocused();
  await expect(page.locator('.ve-player:visible')).toHaveCount(1);
  const beforePlay = await page.evaluate(() =>
    document.querySelector<HTMLElement>('.ve-scene')!.scene!.inspect(),
  );
  expect(beforePlay.playing).toBe(false);
  await speed.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Условия объяснения' })).toBeHidden();
  await page.locator('[data-play]').click();
  await expect(
    page.getByRole('button', { name: 'Рассказ', exact: true, includeHidden: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => document.querySelector<HTMLElement>('.ve-scene')!.scene!.pause!());
  expect(errors).toEqual([]);
});
