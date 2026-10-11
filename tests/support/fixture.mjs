import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '../../tools/site.mjs';
import { buildPage, buildScene } from '../../tools/build-pages.mjs';

const builds = new Map();

/** Test-only subjects use the same builder and current package as authored projects. */
export async function fixturePage(name, entry = 'index.html') {
  const key = `${name}/${entry}`;
  if (!builds.has(key))
    builds.set(
      key,
      (async () => {
        const target = resolve('artifacts/tests/fixtures', name);
        if (['svg', 'smil'].includes(name))
          await buildScene(resolve('tests/fixtures', name), target);
        else await buildPage(resolve('tests/fixtures', name, entry), target);
        return pathToFileURL(resolve(target, entry)).href;
      })(),
    );
  return builds.get(key);
}

export async function openFixture(page, name, entry = 'index.html') {
  const url = await fixturePage(name, entry);
  if (name === 'smil') {
    const server = await serve(resolve('artifacts/tests/fixtures', name));
    page.once('close', () => server.close());
    await page.goto(server.url + '/' + entry);
  } else await page.goto(url);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await window.galleryReady;
  });
}
