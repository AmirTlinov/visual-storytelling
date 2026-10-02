import { readFile, writeFile } from 'node:fs/promises';
import { renderer } from './render.mjs';
const catalog = JSON.parse(await readFile('examples/catalog.json', 'utf8'));
const selected = process.argv.slice(2);
for (const [scene, { time }] of Object.entries(catalog)) {
  if (selected.length && !selected.includes(scene)) continue;
  for (const theme of ['light', 'dark']) {
    const render = await renderer({ scene, theme, width: 800, controls: true });
    try {
      await render.seek(time);
      await writeFile(
        `examples/${scene}/preview${theme === 'dark' ? '-dark' : ''}.png`,
        await render.png(),
      );
    } finally {
      await render.close();
    }
  }
  console.log(scene);
}
