import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { renderer } from './render.mjs';
const measurements = [];
const catalog = JSON.parse(await readFile('examples/catalog.json', 'utf8'));
for (const scene of Object.keys(catalog)) {
  const render = await renderer({ scene, theme: 'light', width: 960, controls: true });
  try {
    const result = await render.page.evaluate(async () => {
      const durations = [],
        intervals = [];
      let last = 0;
      for (let frame = 0; frame < 120; frame++) {
        const timestamp = await new Promise(requestAnimationFrame);
        if (last) intervals.push(timestamp - last);
        last = timestamp;
        const start = performance.now();
        const slider = document.querySelector('[data-seek]');
        if (window.explainer) window.explainer.seek((window.explainer.duration * frame) / 120);
        else if (slider) {
          slider.value = String((Number(slider.max) * frame) / 120);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
        durations.push(performance.now() - start);
      }
      const percentile = (values, p) =>
        [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
      return {
        renderP50Ms: percentile(durations, 0.5),
        renderP95Ms: percentile(durations, 0.95),
        frameP50Ms: percentile(intervals, 0.5),
        frameP95Ms: percentile(intervals, 0.95),
      };
    });
    measurements.push({ scene, ...result });
    console.log(scene, JSON.stringify(result));
  } finally {
    await render.close();
  }
}
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/performance.json',
  JSON.stringify(
    { date: new Date().toISOString(), width: 960, framesPerScene: 120, measurements },
    null,
    2,
  ) + '\n',
);
