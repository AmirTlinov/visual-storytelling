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
      document.querySelector('.ve-scene,svg,canvas,audio') ||
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
    const owner = () =>
      documents()
        .map((doc) => doc.querySelector('.ve-scene')?.scene)
        .find(Boolean);
    const documents = () => [
      document,
      ...[...document.querySelectorAll('object,iframe[data-scene-svg]')]
        .map((element) => element.contentDocument)
        .filter(Boolean),
    ];
    // Unscripted SVG keeps its native SMIL owner. Registered scenes own every command.
    const nativeSVGs = () => documents().flatMap((doc) => [...doc.querySelectorAll('svg')]);
    function pause() {
      const scene = owner();
      if (scene) scene.pause?.();
      else for (const svg of nativeSVGs()) svg.pauseAnimations();
    }
    return {
      pause,
      info() {
        const scene = owner(),
          duration = scene?.duration ?? 0;
        const audio = documents()
          .flatMap((doc) => [...doc.querySelectorAll('audio:not([data-silent=true])')])
          .find(
            (element) => element.currentSrc || element.src || element.querySelector('source[src]'),
          );
        return {
          duration,
          seekable: duration > 0 && Boolean(scene?.seek),
          audioURL:
            scene?.audioURL ??
            (audio?.currentSrc || audio?.src || audio?.querySelector('source[src]')?.src),
          checkpoints: scene?.checkpoints ?? [0],
        };
      },
      async seek(time) {
        if (!Number.isFinite(time) || time < 0)
          throw new Error('Capture time must be finite and non-negative');
        pause();
        const scene = owner();
        if (scene?.seek) scene.seek(time);
        else if (!scene) for (const svg of nativeSVGs()) svg.setCurrentTime(time);
        else if (time > 0)
          throw new Error('This scene has no timeline; capture its current state at time 0');
        await scene?.ready?.();
      },
      review() {
        const handle = owner();
        if (!handle)
          throw new Error(
            'Register the scene with SceneShell or mountScene before reviewing its timeline',
          );
        return handle.review();
      },
      snapshot: () => owner()?.snapshot(),
      control(commands) {
        const handle = owner();
        if (!handle) throw new Error('Scene commands need a registered owner');
        return handle.control(commands);
      },
      presentation: () => owner()?.presentation(),
      diagnostics: () =>
        documents().flatMap((doc) =>
          [...doc.querySelectorAll('[data-layout-error]')].map((element) =>
            element.getAttribute('data-layout-error'),
          ),
        ),
      async exportSVG() {
        const handle = owner();
        if (handle?.exportSVG) return handle.exportSVG();
        const svg =
          handle?.svg?.() ??
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
    await scene.seek(time);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, time);
}

/** Agent, UI and capture change the same registered model. */
export function controlScene(capture, commands) {
  return capture.evaluate(async (scene, commands) => {
    await scene.control(commands);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, commands);
}
