/** Keep embedded SVG on the page's origin so its controls and export can read it. */
export async function openScene(page, url) {
  if (new URL(url).pathname.endsWith('.svg')) {
    const wrapper = new URL('/__visual-story-preview__.html', url).href;
    const route = (request) =>
      request.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html style="color-scheme:light dark"><head><meta charset="utf-8"><style>body{margin:0}object{display:block;width:100%;height:auto}</style></head><body><main class="ve-scene"><object type="image/svg+xml" data="${url}"></object></main></body></html>`,
      });
    await page.route(wrapper, route);
    try {
      await page.goto(wrapper);
    } finally {
      await page.unroute(wrapper, route);
    }
  } else await page.goto(url);
  await page.waitForFunction(
    () =>
      typeof document.querySelector('.ve-scene')?.scene?.seek === 'function' ||
      document.querySelector('svg,canvas') ||
      [...document.querySelectorAll('object,iframe[data-scene-svg]')].some((element) =>
        element.contentDocument?.querySelector('svg'),
      ),
  );
  await page.evaluate(async () => {
    await window.galleryReady;
    await document.fonts.ready;
    for (const object of document.querySelectorAll('object,iframe[data-scene-svg]'))
      await object.contentDocument?.fonts.ready;
  });
  // This adapter calls the scene's owners; it never introduces another playback clock.
  return page.evaluateHandle(() => {
    const handles = () => documents().map((doc) => doc.querySelector('.ve-scene')?.scene);
    const owner = (method) => handles().find((handle) => typeof handle?.[method] === 'function');
    const documents = () => [
      document,
      ...[...document.querySelectorAll('object,iframe[data-scene-svg]')]
        .map((element) => element.contentDocument)
        .filter(Boolean),
    ];
    const slider = () =>
      documents()
        .map((doc) => doc.querySelector('[data-seek]:not([hidden])'))
        .find(Boolean);
    function pause() {
      owner('pause')?.pause();
      for (const doc of documents()) {
        for (const audio of doc.querySelectorAll('audio')) audio.pause();
        for (const svg of doc.querySelectorAll('svg')) svg.pauseAnimations();
      }
    }
    return {
      pause,
      info() {
        const duration =
          handles().find((handle) => Number.isFinite(handle?.duration))?.duration ??
          Number(slider()?.max ?? 0);
        const audio = documents()
          .flatMap((doc) => [...doc.querySelectorAll('audio:not([data-silent=true])')])
          .find(
            (element) => element.currentSrc || element.src || element.querySelector('source[src]'),
          );
        return {
          duration,
          seekable: duration > 0 && Boolean(owner('seek') || slider()),
          audioURL:
            handles().find((handle) => handle?.audioURL)?.audioURL ??
            (audio?.currentSrc || audio?.src || audio?.querySelector('source[src]')?.src),
          checkpoints: handles().find((handle) => handle?.checkpoints)?.checkpoints ?? [0],
        };
      },
      seek(time) {
        if (!Number.isFinite(time) || time < 0)
          throw new Error('Capture time must be finite and non-negative');
        pause();
        const handle = owner('seek');
        if (handle) handle.seek(time);
        else {
          const button = documents()
            .map((doc) => doc.querySelector('[data-mode=story]'))
            .find(Boolean);
          if (button && !button.hidden) button.click();
          const input = slider();
          if (input) {
            input.value = String(time);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        for (const doc of documents())
          for (const svg of doc.querySelectorAll('svg')) {
            svg.pauseAnimations();
            svg.setCurrentTime(time);
          }
      },
      review() {
        const handle = owner('review');
        if (!handle)
          throw new Error(
            'Attach the story with SceneShell.attachStory, or expose controller.review on root.scene',
          );
        return handle.review();
      },
      snapshot: () => owner('snapshot')?.snapshot(),
      diagnostics: () =>
        documents().flatMap((doc) =>
          [...doc.querySelectorAll('[data-layout-error]')].map((element) =>
            element.getAttribute('data-layout-error'),
          ),
        ),
      async exportSVG() {
        const handle = owner('exportSVG');
        if (handle) return handle.exportSVG();
        const svg =
          owner('svg')?.svg() ??
          documents()
            .map((doc) => doc.querySelector('svg.canvas,svg.vs-canvas,svg.ve-scene'))
            .find(Boolean);
        if (!svg || document.querySelector('canvas'))
          throw new Error('No SVG surface; use PNG, HTML or MP4 for Canvas');
        return window.VisualExport.exportSVG(svg);
      },
    };
  });
}

/** Allow layout and the scene's invalidated WebGL draw to reach the displayed frame. */
export function seekScene(capture, time) {
  return capture.evaluate(async (scene, time) => {
    scene.seek(time);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, time);
}
