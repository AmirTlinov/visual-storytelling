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
      document.querySelector('svg,canvas') ||
      document.querySelector('object')?.contentDocument?.querySelector('svg'),
  );
  await page.evaluate(async () => {
    await window.galleryReady;
    await document.fonts.ready;
    for (const object of document.querySelectorAll('object'))
      await object.contentDocument?.fonts.ready;
  });
}
