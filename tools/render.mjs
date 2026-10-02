import { chromium } from 'playwright';
import { serve } from './site.mjs';
export async function renderer({ scene, theme, width = 960, controls = false }) {
  const site = await serve();
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width, height: 1200 },
      deviceScaleFactor: 1,
      colorScheme: theme,
    });
    await page.goto(`${site.url}/?scene=${scene}&theme=${theme}&t=0`);
    await page.evaluate(() => window.galleryReady);
    await page.addStyleTag({
      content:
        '.gallery-header,#examples,.gallery-footer{display:none!important}.gallery{padding:0;margin:0;width:100%}.vs-notebook{max-width:none}' +
        (controls ? '' : '.vs-parameters,.vs-footer,.vs-return{display:none!important}'),
    });
    await page.evaluate(() => window.explainer.pause());
    return {
      page,
      url: site.url,
      info: await page.evaluate(() => ({
        duration: window.explainer.duration,
        audioURL: window.explainer.audioURL,
        checkpoints: window.explainer.checkpoints,
      })),
      async seek(time) {
        await page.evaluate((time) => window.explainer.seek(time), time);
      },
      async png() {
        return page.locator('.vs-notebook').screenshot({ animations: 'disabled' });
      },
      async close() {
        await browser.close();
        await site.close();
      },
    };
  } catch (error) {
    await browser?.close();
    await site.close();
    throw error;
  }
}
