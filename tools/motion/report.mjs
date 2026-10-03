import { mkdir, writeFile, readFile, lstat, readdir, rm } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { motionData } from './frames.mjs';
import { escapeText as escape, playbackMarkup } from './diagnostics.mjs';
import { orderedInsights, reviewFocus } from './focus.mjs';
import { motionMarkup } from './report-view.mjs';
import { startupFailureReason } from './doctor.mjs';
export { motionMarkup } from './report-view.mjs';

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
    ...(report.photometry?.status === 'available'
      ? {
          photometry: {
            status: 'available',
            frames: report.photometry.points.length,
            roi: report.photometry.roi,
            kymograph: Object.fromEntries(
              ['axis', 'position', 'thickness', 'automatic', 'gapColumns'].map((key) => [
                key,
                report.photometry.kymograph[key],
              ]),
            ),
            ranges: report.photometry.ranges,
            spectrum:
              report.photometry.spectrum.status === 'available'
                ? {
                    status: 'available',
                    region: report.photometry.spectrum.region,
                    frequencyHz: report.photometry.spectrum.frequencyHz,
                    binSpacingHz: report.photometry.spectrum.binSpacingHz,
                  }
                : report.photometry.spectrum,
          },
        }
      : report.photometry
        ? { photometry: report.photometry }
        : {}),
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

export async function assertMotionOutput(out) {
  const files = [
    'index.html',
    'motion.png',
    'photometry.png',
    'frames.png',
    'motion.json',
    'replay.json',
    'telemetry.json',
    'recording.mp4',
  ].map((name) => join(out, name));
  const folders = ['capture', 'analysis'].map((name) => join(out, name));
  const rejectLink = (path) => {
    throw new Error(
      `Motion review refuses to overwrite symbolic link ${path}; choose a fresh output directory`,
    );
  };
  for (const path of [...files, ...folders]) {
    let entry;
    try {
      entry = await lstat(path);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (entry.isSymbolicLink()) rejectLink(path);
    if (folders.includes(path) && entry.isDirectory())
      for (const child of await readdir(path, { withFileTypes: true }))
        if (child.isSymbolicLink()) rejectLink(join(path, child.name));
  }
  return { files, folders };
}

export async function writeMotionReport(report, out, { context } = {}) {
  await assertMotionOutput(out);
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
  const focus = reviewFocus(report);
  // A previous run's covers must never stand in for previews that could not be rendered.
  await Promise.all(
    ['motion.png', 'frames.png', 'photometry.png'].map((file) =>
      rm(join(out, file), { force: true }),
    ),
  );
  let browser, page;
  report.previews = { available: true };
  if (!context) {
    try {
      browser = await chromium.launch({ timeout: 5000 });
    } catch (error) {
      report.previews = { available: false, reason: startupFailureReason(error) };
    }
  }
  try {
    const main = motionMarkup(report, { playback: true });
    const document = (body) =>
      `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title ?? 'Проверка движения')}</title><body style="margin:0;background:#fbfaf6">${body}</body></html>`;
    const html = document(
      main +
        `<section class="motion-sheet">${playbackMarkup(playback, { unsynchronized: report.source.domSynchronized === false })}</section>`,
    );
    await writeFile(join(out, 'index.html'), html);
    const data = { ...motionData(report), focus };
    if (data.captureManifest) data.captureManifest = relative(out, data.captureManifest);
    if (data.replayPath) data.replayPath = relative(out, data.replayPath);
    await writeFile(join(out, 'motion.json'), JSON.stringify(data, null, 2) + '\n');
    if (report.previews.available) {
      page = context ? await context.newPage() : await browser.newPage();
      await page.setViewportSize({ width: 1320, height: 1000 });
      await page.setContent(document(main));
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
      });
      await page.locator('.motion-summary').screenshot({ path: join(out, 'motion.png') });
      const framesPanel = page.locator('.motion-frame-evidence');
      await framesPanel.evaluate((element) => {
        element.closest('details').open = true;
      });
      await framesPanel.screenshot({ path: join(out, 'frames.png') });
      if (report.photometry?.status === 'available') {
        const photoPanel = page.locator('.motion-photometry');
        await photoPanel.evaluate((element) => {
          element.closest('details').open = true;
        });
        await photoPanel.screenshot({ path: join(out, 'photometry.png') });
      }
    }
  } finally {
    await page?.close();
    await browser?.close();
  }
  return {
    path: join(out, 'index.html'),
    focus,
    previews: report.previews,
    ...(report.previews.available
      ? {
          image: join(out, 'motion.png'),
          framesImage: join(out, 'frames.png'),
          ...(report.photometry?.status === 'available'
            ? { photometryImage: join(out, 'photometry.png') }
            : {}),
          preview: `${cli} preview ${quote(out)} --port 0`,
        }
      : { framesDirectory: join(out, 'analysis') }),
    data: join(out, 'motion.json'),
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
