import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { frameColor, motionData } from './frames.mjs';
import { diagnosticsMarkup, playbackMarkup, orderedInsights } from './diagnostics.mjs';

const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const color = (i, count) => `rgb(${frameColor(i, count).join(',')})`;

function summary(report) {
  const intervals = report.intervals;
  return {
    window: { from: report.frames[0].time, to: report.frames.at(-1).time },
    analysis: {
      width: report.width,
      height: report.height,
      scale: report.scale,
      threshold: report.threshold,
    },
    repeatedIntervals: intervals.filter((v) => v.duplicate).length,
    dtMs: {
      min: Math.min(...intervals.map((v) => v.dtMs)),
      max: Math.max(...intervals.map((v) => v.dtMs)),
    },
    suggestedCrop: report.suggestedCrop,
    notes: [
      ...(!report.motionBounds
        ? [
            'No change above threshold in this window. Check its timing, use a crop at --max-size 0, or lower --threshold.',
          ]
        : []),
      ...(report.scale < 1
        ? ['Overview is downscaled. Inspect small details with --crop x,y,w,h --max-size 0.']
        : []),
      ...(report.source.kind === 'scene-seek'
        ? ['Model time: use a real playback recording to inspect presentation cadence.']
        : []),
      ...(report.source.sparse
        ? [
            'Compositor captures arrive on image updates. Capture gaps are not display FPS; browser rAF and long-frame observations are reported separately.',
          ]
        : []),
      ...(report.source.warning ? [report.source.warning] : []),
      ...(report.source.timingNote ? [report.source.timingNote] : []),
    ],
  };
}

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
  const map = (image, label, className = 'motion-map') =>
    `<svg class="${className}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img" aria-label="${label}"><title>${label}</title><image href="${image}" width="${report.width}" height="${report.height}"/></svg>`;
  const labels = {
    'scene-seek': 'Перемотка сцены · время модели',
    'browser-capture': 'Запись браузера · реальное выполнение',
    'window-capture': 'Запись окна · ScreenCaptureKit',
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
  .motion-sheet .motion-strip svg{display:block;width:100%;height:116px;border:2px solid var(--frame-color)}
  .motion-sheet .motion-strip svg,.motion-sheet .motion-context img{background:repeating-conic-gradient(#dedede 0% 25%,#f4f4f4 0% 50%) 0 0/16px 16px}
  .motion-sheet .motion-context{display:flex;align-items:center;gap:16px;margin:14px 0}.motion-sheet .motion-context img{width:170px;height:90px;object-fit:contain;border:1px solid #d9e0df;flex-shrink:0}
  .motion-sheet figcaption{font-size:13px;margin-top:5px}.motion-sheet .motion-legend{display:flex;justify-content:space-between;gap:6px;margin:8px 0;font-size:13px}
  @media(max-width:650px){.motion-sheet{padding:16px}.motion-sheet .motion-panels{grid-template-columns:1fr}.motion-sheet .motion-strip{grid-template-columns:repeat(3,minmax(0,1fr))}}
  </style>
  <h2>${escape(report.title ?? 'Движение в соседних кадрах')}</h2>
  <p>${labels[report.source.kind]} · ${frames.length} кадров · ${frames[0].time.toFixed(3)}–${frames.at(-1).time.toFixed(3)} с${report.sampling === 'cue-checkpoints' ? ' · обзорные состояния перехода' : report.sampling === 'provided-order' ? ' · порядок из manifest' : report.sampling === 'captured-window' ? ' · подробный фрагмент записи' : ' · последовательные кадры'}${report.source.cue ? ` · метка ${escape(report.source.cue.id)} (${report.source.cue.start.toFixed(3)}–${report.source.cue.end.toFixed(3)} с)` : ''}</p>
  <p>${report.source.kind === 'scene-seek' ? 'Δt задано перемоткой: этот отчёт показывает форму перехода. Ритм живого интерфейса проверяется по записи воспроизведения.' : 'Δt относится к источнику. Частота и пропуски самой записи ограничивают наблюдаемый ритм.'}</p>
  ${report.sizeChanged ? '<p>Размеры кадров различаются; общий масштаб, привязка к левому верхнему углу и прозрачное дополнение.</p>' : ''}
  <p>Анализ: ${report.width} × ${report.height} px · ${(report.scale * 100).toFixed(1)}% исходного масштаба${report.crop ? ` · исходная область ${report.crop.x},${report.crop.y},${report.crop.width},${report.crop.height}` : ''}${report.hasTransparency ? ' · цвет с учётом прозрачности и альфа-канал' : ''}.</p>
  ${report.scale < 1 ? `<p>Для тонких линий и малых сдвигов: <code>--max-size 0${report.suggestedCrop ? ` --crop ${Object.values(report.suggestedCrop).join(',')}` : ''}</code>.</p>` : ''}
  ${!report.motionBounds ? '<p>В этом окне нет изменений выше порога. Проверьте время действия, область и порог; неподвижный фрагмент сам по себе не оценивает всю анимацию.</p>' : ''}
  ${diagnosticsMarkup(report)}
  <div class="motion-panels">
    <figure><h3>Наложение изменяющихся контуров</h3>${map(report.overlay, 'Контуры кадров: синий в начале, оранжевый в конце')}<div class="motion-legend"><span style="color:${color(0, frames.length)}">1 · раньше</span><span>цвет → порядок</span><span style="color:${color(frames.length - 1, frames.length)}">${frames.length} · позже</span></div></figure>
    <figure><h3>Максимальная разность соседних кадров</h3>${map(report.difference, 'Карта межкадровых изменений')}<figcaption>${report.motionBounds ? 'Общая область изменений приближена во всех кадрах' : 'Показана вся область'}; порог ${report.threshold}/255.</figcaption></figure>
    <figure><h3>Изменившиеся пиксели, % области</h3>${bars(intervals, 'changedPercent', 'Доля изменившихся пикселей', '%')}</figure>
    <figure><h3>${report.source.sparse ? 'Интервал меток захвата' : 'Интервал между кадрами'}, мс</h3>${bars(intervals, 'dtMs', 'Интервал исходных временных меток', ' ms')}</figure>
  </div>
  <p>Повторов соседнего кадра в масштабе анализа: ${intervals.filter((v) => v.duplicate).length}. Пиксельная разность зависит от движения, формы и цвета; сопоставьте её с замыслом, камерой и монтажом.</p>
  ${includeFrames ? `<div class="motion-context"><img src="${frames[0].image}" alt="Контекст первого кадра"><p>Контекст первого кадра. Ниже — последовательность в общей области изменений.</p></div><div class="motion-strip">${frames.map((frame, i) => `<figure style="--frame-color:${color(i, frames.length)}">${map(frame.image, `Кадр ${i + 1}`, 'motion-frame')}<figcaption>${i + 1} · ${frame.time.toFixed(3)} с</figcaption></figure>`).join('')}</div>` : ''}
  </section>`;
}

export async function writeMotionReport(report, out, { context } = {}) {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const cli = `node ${quote(fileURLToPath(new URL('../scene.mjs', import.meta.url)))}`;
  await mkdir(out, { recursive: true });
  await mkdir(join(out, 'analysis'), { recursive: true });
  for (const [i, frame] of report.frames.entries()) {
    frame.file = `analysis/${String(i).padStart(3, '0')}.png`;
    await writeFile(join(out, frame.file), Buffer.from(frame.image.split(',')[1], 'base64'));
  }
  let playback = report.frames.map((f) => ({ time: f.time, image: f.image }));
  if (report.captureManifest) {
    const manifest = JSON.parse(await readFile(report.captureManifest, 'utf8'));
    playback = manifest.frames.map((f) => ({
      time: f.time,
      image: relative(out, join(dirname(report.captureManifest), f.file))
        .split('/')
        .map(encodeURIComponent)
        .join('/'),
    }));
  }
  const main = motionMarkup(report);
  const document = (body) =>
    `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title ?? 'Проверка движения')}</title><body style="margin:0;background:#fbfaf6">${body}</body></html>`;
  const html = document(
    main + `<section class="motion-sheet">${playbackMarkup(playback)}</section>`,
  );
  await writeFile(join(out, 'index.html'), html);
  const data = motionData(report);
  if (data.captureManifest) data.captureManifest = relative(out, data.captureManifest);
  if (data.replayPath) data.replayPath = relative(out, data.replayPath);
  await writeFile(join(out, 'motion.json'), JSON.stringify(data, null, 2) + '\n');
  const browser = context ? undefined : await chromium.launch();
  let page;
  try {
    page = context ? await context.newPage() : await browser.newPage();
    await page.setViewportSize({ width: 1320, height: 1000 });
    await page.setContent(document(main));
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
    preview: `${cli} preview ${quote(out)} --port 0`,
    ...(report.captureManifest
      ? {
          captureManifest: report.captureManifest,
          reanalyze: `${cli} review ${quote(report.captureManifest)} --motion --out NEW_REPORT`,
        }
      : {}),
    frames: report.frames.length,
    source: report.source,
    ...summary(report),
    ...(report.timeline
      ? {
          recording: {
            frames: report.timeline.frames,
            from: report.timeline.from,
            to: report.timeline.to,
          },
          insights: orderedInsights(report).slice(0, 8),
          ...(report.runtime
            ? {
                clickTimes: report.runtime.clickTimes,
                clickIntervalsMs: report.runtime.clickIntervalsMs,
              }
            : {}),
        }
      : {}),
    ...(report.replayPath
      ? {
          replay: report.replayPath,
          repeat: `${cli} review ${quote(report.replayPath)} --motion --baseline ${quote(out)} --out NEW_REPORT`,
        }
      : {}),
    ...(report.comparison
      ? {
          comparison: {
            baseline: report.comparison.baseline,
            warning: report.comparison.warning,
            metrics: report.comparison.metrics,
            notes: report.comparison.notes,
            actionTimingDriftMs: report.comparison.actionTimingDriftMs,
          },
        }
      : {}),
  };
}
