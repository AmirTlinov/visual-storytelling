import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderer } from './render.mjs';
import { packageInfo, sourceDigest, runtimeDigest, writeBuildInfo } from './build-info.mjs';
const root = process.cwd();
const prepared = await packageInfo(root);
if (prepared.status !== 'current')
  throw new Error('Build the library and gallery before rendering previews: npm run build');
const runtime = JSON.parse(await readFile(resolve(root, 'dist/build-info.json'), 'utf8')).runtime;
const catalog = JSON.parse(await readFile('examples/catalog.json', 'utf8'));
const selected = process.argv.slice(2);
for (const [scene, { time, commands }] of Object.entries(catalog)) {
  if (selected.length && !selected.includes(scene)) continue;
  for (const theme of ['light', 'dark']) {
    const render = await renderer({ scene, theme, width: 800, controls: true });
    try {
      await render.seek(time);
      if (commands) await render.control(commands);
      const name = `preview${theme === 'dark' ? '-dark' : ''}.png`,
        pixels = await render.png();
      await writeFile(`examples/${scene}/${name}`, pixels);
      await writeFile(`site/${scene}/${name}`, pixels);
    } finally {
      await render.close();
    }
  }
  console.log(scene);
}
// Previews are shipped package assets. Their own command keeps the verified
// runtime receipt current, without rebuilding unchanged code after capture.
const [sourceNow, runtimeNow] = await Promise.all([
  sourceDigest(root),
  runtimeDigest(resolve(root, 'dist')),
]);
if (sourceNow !== prepared.source || runtimeNow !== runtime)
  throw new Error(
    'Library sources or runtime changed during preview capture. Build and capture again.',
  );
await writeBuildInfo(root, resolve(root, 'dist'), prepared.source);
