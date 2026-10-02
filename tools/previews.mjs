import { writeFile } from 'node:fs/promises';
import { renderer } from './render.mjs';
const moments = {
  area: 48.2,
  remainder: 14,
  sort: 1.7,
  lc: 0.75,
  vector: 16,
  transfer: 3.5,
  materials: 4,
};
for (const [scene, time] of Object.entries(moments)) {
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
