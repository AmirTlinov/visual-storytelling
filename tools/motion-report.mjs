import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { frameColor, motionData } from './motion-frames.mjs';

const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const color = (i, count) => `rgb(${frameColor(i, count).join(',')})`;

function bars(intervals, key, label, unit) {
  const max = Math.max(Number.EPSILON, ...intervals.map((v) => v[key]));
  const step = 560 / intervals.length;
  return `<svg viewBox="0 0 600 132" role="img" aria-label="${label}"><title>${label}</title>
  <line x1="20" y1="100" x2="580" y2="100" stroke="#bfc8c9"/>
  ${intervals
    .map((v, i) => {
      const x = 20 + step * i,
        h = (62 * v[key]) / max;
      const value = `${v[key].toFixed(key === 'dtMs' ? 1 : 2)}${unit}`;
      return `<g><title>${i + 1} → ${i + 2}: ${value}</title><rect x="${x + 3}" y="${100 - Math.max(2, h)}" width="${Math.max(2, step - 6)}" height="${Math.max(2, h)}" fill="${v.duplicate ? '#b75540' : '#478879'}"/>
    ${intervals.length <= 16 ? `<text x="${x + step / 2}" y="${90 - h}" text-anchor="middle" font-size="11">${v[key].toFixed(key === 'dtMs' ? 1 : 2)}</text>` : ''}
    <text x="${x + step / 2}" y="119" text-anchor="middle" font-size="10">${i + 1}→${i + 2}</text></g>`;
    })
    .join('')}</svg>`;
}

export function motionMarkup(report, { includeFrames = true } = {}) {
  const { frames, intervals } = report;
  const bounds = report.motionBounds ?? { x: 0, y: 0, width: report.width, height: report.height };
  const map = (image, label) =>
    `<svg class="motion-map" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img" aria-label="${label}"><title>${label}</title><image href="${image}" width="${report.width}" height="${report.height}"/></svg>`;
  const labels = {
    'scene-seek': 'Перемотка сцены · время модели',
    video: 'Видео · исходные временные метки PTS',
    'frame-manifest': 'PNG · времена из manifest',
  };
  return `<section class="motion-sheet">
  <style>
  .motion-sheet{font:16px/1.45 Arial,sans-serif;color:#293b44;background:#fbfaf6;padding:24px;box-sizing:border-box;max-width:1320px;margin:12px auto;overflow-wrap:anywhere}
  .motion-sheet *{box-sizing:border-box}.motion-sheet h2{font-size:25px;margin:0 0 8px}.motion-sheet h3{font-size:16px;margin:0 0 7px}.motion-sheet p{margin:8px 0;color:#54646b}
  .motion-sheet .motion-panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:16px}
  .motion-sheet figure{margin:0}.motion-sheet .motion-map{display:block;width:100%;height:300px;object-fit:contain;background:white;border:1px solid #d9e0df}
  .motion-sheet svg{display:block;width:100%;background:white}.motion-sheet svg text{fill:#3c525d;font-family:Arial,sans-serif}
  .motion-sheet .motion-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-top:18px}
  .motion-sheet .motion-strip img{display:block;width:100%;height:108px;object-fit:contain;background:white;border:2px solid var(--frame-color)}
  .motion-sheet figcaption{font-size:13px;margin-top:5px}.motion-sheet .motion-legend{display:flex;justify-content:space-between;gap:6px;margin:8px 0;font-size:13px}
  @media(max-width:650px){.motion-sheet{padding:16px}.motion-sheet .motion-panels{grid-template-columns:1fr}.motion-sheet .motion-strip{grid-template-columns:repeat(3,minmax(0,1fr))}}
  </style>
  <h2>${escape(report.title ?? 'Движение в соседних кадрах')}</h2>
  <p>${labels[report.source.kind]} · ${frames.length} кадров · ${frames[0].time.toFixed(3)}–${frames.at(-1).time.toFixed(3)} с${report.sampling === 'cue-checkpoints' ? ' · обзорные состояния перехода' : ' · последовательные кадры'}</p>
  <p>${report.source.kind === 'scene-seek' ? 'Δt задано перемоткой: этот отчёт показывает форму перехода. Ритм живого интерфейса проверяется по записи воспроизведения.' : 'Δt относится к источнику. Частота и пропуски самой записи ограничивают наблюдаемый ритм.'}</p>
  ${report.sizeChanged ? '<p>Размеры кадров различаются; сохранены масштаб и привязка к левому верхнему углу, свободная область заполнена белым.</p>' : ''}
  ${report.crop ? `<p>Область: ${report.crop.x}, ${report.crop.y} · ${report.width} × ${report.height} px.</p>` : ''}
  <div class="motion-panels">
    <figure><h3>Наложение изменяющихся контуров</h3>${map(report.overlay, 'Контуры кадров: синий в начале, оранжевый в конце')}<div class="motion-legend"><span style="color:${color(0, frames.length)}">1 · раньше</span><span>цвет → порядок</span><span style="color:${color(frames.length - 1, frames.length)}">${frames.length} · позже</span></div></figure>
    <figure><h3>Максимальная разность соседних кадров</h3>${map(report.difference, 'Карта межкадровых изменений')}<figcaption>Область движения приближена; порог шума ${report.threshold}/255.</figcaption></figure>
    <figure><h3>Изменившиеся пиксели, % области</h3>${bars(intervals, 'changedPercent', 'Доля изменившихся пикселей', '%')}</figure>
    <figure><h3>Интервал между кадрами, мс</h3>${bars(intervals, 'dtMs', 'Интервал между кадрами', ' ms')}</figure>
  </div>
  <p>Точных повторов соседнего кадра: ${intervals.filter((v) => v.duplicate).length}. Изменение пикселей зависит от движения, формы и цвета; сопоставьте его с замыслом, камерой и монтажом.</p>
  ${includeFrames ? `<div class="motion-strip">${frames.map((frame, i) => `<figure style="--frame-color:${color(i, frames.length)}"><img src="${frame.image}" alt="Кадр ${i + 1}"><figcaption>${i + 1} · ${frame.time.toFixed(3)} с</figcaption></figure>`).join('')}</div>` : ''}
  </section>`;
}

export async function writeMotionReport(report, out, { context } = {}) {
  await mkdir(out, { recursive: true });
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title ?? 'Проверка движения')}</title><body style="margin:0;background:#fbfaf6">${motionMarkup(report)}</body></html>`;
  await writeFile(join(out, 'index.html'), html);
  await writeFile(join(out, 'motion.json'), JSON.stringify(motionData(report), null, 2) + '\n');
  const browser = context ? undefined : await chromium.launch();
  let page;
  try {
    page = context ? await context.newPage() : await browser.newPage();
    await page.setViewportSize({ width: 1320, height: 1000 });
    await page.setContent(html);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    await page.locator('.motion-sheet').screenshot({ path: join(out, 'motion.png') });
  } finally {
    await page?.close();
    await browser?.close();
  }
  return {
    path: join(out, 'index.html'),
    image: join(out, 'motion.png'),
    data: join(out, 'motion.json'),
    frames: report.frames.length,
    source: report.source,
  };
}
