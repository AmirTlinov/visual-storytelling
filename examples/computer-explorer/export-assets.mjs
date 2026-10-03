#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const [url, destination] = process.argv.slice(2);
if (!url || !destination)
  throw new Error('Usage: node export-assets.mjs <built catalog.html URL> <output directory>');
const directory = resolve(destination),
  catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url), 'utf8'));
await mkdir(resolve(directory, 'svg'), { recursive: true });
const browser = await chromium.launch(),
  exports = [];
try {
  const page = await browser.newPage({
    viewport: { width: 736, height: 850 },
    colorScheme: 'light',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  for (const part of catalog) {
    await page.locator(`[data-family="${part.family}"]`).click();
    await page.locator(`[data-kind="${part.id}"]`).click();
    for (const inside of part.action ? [false, true] : [false]) {
      if (inside) await page.locator('.parts-view').click();
      const svg = await page.evaluate(() => document.querySelector('.ve-scene').scene.exportSVG());
      const name = part.id + (inside ? '-inside' : '');
      await writeFile(resolve(directory, 'svg', name + '.svg'), svg + '\n');
      exports.push({ name, svg, title: part.name, inside });
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const items = exports.filter((item) => !item.inside),
    height = 92 + Math.ceil(items.length / 4) * 192;
  const cells = items
    .map((item, i) => {
      const x = 30 + (i % 4) * 222,
        y = 74 + Math.floor(i / 4) * 192;
      const svg = item.svg.replace(
        /<svg\b([^>]*)>/,
        (_, attributes) =>
          `<svg ${attributes.replace(/\b(width|height|style)="[^"]*"/g, '')} x="${x + 15}" y="${y}" width="178" height="143">`,
      );
      return svg + `<text x="${x + 104}" y="${y + 170}" text-anchor="middle">${item.title}</text>`;
    })
    .join('');
  await writeFile(
    resolve(directory, 'computer-elements.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="${height}" viewBox="0 0 920 ${height}" role="img"><title>Компьютерные фигуры</title><desc>Процессоры, память и логические элементы.</desc><style>text{font:16px Arial,sans-serif;fill:#303d49}</style><text x="40" y="46" style="font-size:25px">Компьютерные фигуры</text>${cells}</svg>\n`,
  );
  await rm(resolve(directory, 'computer-elements-svg.zip'), { force: true });
  execFileSync(
    'zip',
    [
      '-q',
      resolve(directory, 'computer-elements-svg.zip'),
      'computer-elements.svg',
      ...exports.map((item) => 'svg/' + item.name + '.svg'),
    ],
    { cwd: directory },
  );
  console.log(`Exported ${exports.length} SVG figures, contact sheet and ZIP to ${directory}`);
} finally {
  await browser.close();
}
