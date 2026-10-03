import { readFile, stat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { analyzeMotionFrames } from './frames.mjs';

export async function compareMotion(report, baseline) {
  let file = resolve(baseline);
  if ((await stat(file)).isDirectory()) file = join(file, 'motion.json');
  const previous = JSON.parse(await readFile(file, 'utf8'));
  const result = { baseline: file, pairs: [], notes: [] };
  if (report.source.domSynchronized === false || previous.source.domSynchronized === false)
    result.notes.push(
      'Кадры CDP и DOM не синхронизированы. Расстояние меток захвата не задаёт погрешность времени показанных пикселей.',
    );
  if (
    previous.width !== report.width ||
    previous.height !== report.height ||
    JSON.stringify(previous.crop) !== JSON.stringify(report.crop)
  )
    return {
      ...result,
      warning:
        'Analysis size or crop differs. Repeat both captures with the same viewport, crop and max-size.',
    };
  for (const key of ['theme', 'reduced'])
    if (previous.source[key] !== report.source[key])
      return {
        ...result,
        warning: `Capture ${key} differs. Use matching conditions for a baseline comparison.`,
      };
  const oldInput =
    previous.runtime?.events?.find((s) => s.type === 'click' && s.trusted)?.time ??
    previous.runtime?.steps?.find((s) => s.phase === 'start')?.time ??
    previous.frames[0].time;
  const newInput =
    report.runtime?.events?.find((s) => s.type === 'click' && s.trusted)?.time ??
    report.runtime?.steps?.find((s) => s.phase === 'start')?.time ??
    report.frames[0].time;
  const oldClicks =
    previous.runtime?.events?.filter((event) => event.type === 'click' && event.trusted) ?? [];
  const newClicks =
    report.runtime?.events?.filter((event) => event.type === 'click' && event.trusted) ?? [];
  if (oldClicks.length !== newClicks.length)
    return {
      ...result,
      warning: 'Actual click counts differ; repeat the same scenario before comparing phases.',
    };
  const drift = newClicks.map(
    (event, i) => Math.abs(event.time - newInput - (oldClicks[i].time - oldInput)) * 1000,
  );
  result.actionTimingDriftMs = Math.max(0, ...drift);
  if (result.actionTimingDriftMs > 32)
    result.notes.push(
      `Интервалы ввода различаются до ${result.actionTimingDriftMs.toFixed(1)} мс. Кадры совмещены относительно соответствующего клика; начальные состояния фаз могут различаться.`,
    );
  let candidates = previous.frames;
  let baseDirectory = dirname(file),
    raw = false;
  if (previous.captureManifest) {
    const capturePath = resolve(dirname(file), previous.captureManifest);
    const manifest = JSON.parse(await readFile(capturePath, 'utf8'));
    candidates = manifest.frames;
    baseDirectory = dirname(capturePath);
    raw = true;
  }
  const now = report.overview?.frames ?? report.frames;
  const indexes = [...new Set([0, Math.floor((now.length - 1) / 2), now.length - 1])];
  for (const index of indexes) {
    const frame = now[index];
    const action = Math.max(
      0,
      newClicks.findLastIndex((event) => event.time <= frame.time),
    );
    const newAnchor = newClicks[action]?.time ?? newInput;
    const oldAnchor = oldClicks[action]?.time ?? oldInput;
    const target = frame.time - newAnchor + oldAnchor;
    const old = candidates.reduce((a, b) =>
      Math.abs(b.time - target) < Math.abs(a.time - target) ? b : a,
    );
    if (!old.file)
      return {
        ...result,
        warning: 'Baseline has no saved analysis frames; regenerate it with the current tool.',
      };
    let image = await readFile(resolve(baseDirectory, old.file));
    if (raw) {
      const normalized = await analyzeMotionFrames(
        [
          { time: 0, png: image },
          { time: 1, png: image },
        ],
        { crop: report.crop ?? undefined, maxSize: Math.max(report.width, report.height) },
      );
      image = Buffer.from(normalized.frames[0].image.split(',')[1], 'base64');
    }
    const pair = await analyzeMotionFrames(
      [
        { time: 0, png: image },
        { time: 1, png: Buffer.from(frame.image.split(',')[1], 'base64') },
      ],
      { maxSize: 0, threshold: report.threshold },
    );
    result.pairs.push({
      time: frame.time,
      relativeTime: frame.time - newAnchor,
      action: newClicks.length ? action + 1 : undefined,
      baselineTime: old.time,
      timestampDistanceMs: Math.abs(old.time - target) * 1000,
      changedPercent: pair.intervals[0].changedPercent,
      baselineImage: pair.frames[0].image,
      currentImage: pair.frames[1].image,
      difference: pair.difference,
    });
  }
  result.metrics = {
    longFrames: { before: previous.runtime?.longFrameCount, after: report.runtime?.longFrameCount },
    maxInteractionMs: {
      before: previous.runtime?.maxInteractionMs,
      after: report.runtime?.maxInteractionMs,
    },
  };
  return result;
}
