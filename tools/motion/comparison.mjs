import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { analyzeMotionFrames } from './frames.mjs';
import { loadCapture, nearestFrame, frameInput } from './session.mjs';

/** Compare corresponding inputs in real time and explicit phases, preserving duration. */
export async function compareMotion(report, baseline, out) {
  let file = resolve(baseline);
  if ((await stat(file)).isDirectory()) file = join(file, 'motion.json');
  if (file.endsWith('session.json')) file = join(dirname(file), 'motion.json');
  const previous = JSON.parse(await readFile(file, 'utf8'));
  const result = { baseline: file, pairs: [], notes: [], episodes: [] };
  if (report.source.domSynchronized === false || previous.source.domSynchronized === false)
    result.notes.push(
      'Кадры CDP и DOM имеют независимые метки. Погрешность времени показанных пикселей неизвестна.',
    );
  if (
    previous.width !== report.width ||
    previous.height !== report.height ||
    previous.sourceWidth !== report.sourceWidth ||
    previous.sourceHeight !== report.sourceHeight ||
    JSON.stringify(previous.crop) !== JSON.stringify(report.crop) ||
    ['width', 'height', 'deviceScaleFactor'].some(
      (k) => previous.source.viewport?.[k] !== report.source.viewport?.[k],
    )
  )
    return {
      ...result,
      warning: 'Source size, viewport or crop differs. Use the same capture conditions.',
    };
  for (const key of ['theme', 'reduced'])
    if (previous.source[key] !== report.source[key])
      return { ...result, warning: `Capture ${key} differs.` };
  const oldCapture = previous.captureManifest
    ? await loadCapture(resolve(dirname(file), previous.captureManifest))
    : undefined;
  const oldFrames =
    oldCapture?.samples ??
    previous.frames.map((f) => ({ ...f, file: resolve(dirname(file), f.file) }));
  const nowFrames =
    report.samples ??
    report.frames.map((f) => ({ ...f, png: Buffer.from(f.image.split(',')[1], 'base64') }));
  const oldEpisodes = previous.session?.episodes ?? [],
    newEpisodes = report.session?.episodes ?? [];
  const groups = newEpisodes.filter((e) => e.kind !== 'chapter' && e.kind !== 'context');
  let drift = 0;
  if (!out) throw new Error('Comparison needs an output directory for image evidence');
  await mkdir(join(out, 'comparison'), { recursive: true });
  const save = async (image, name) => {
    const file = `comparison/${name}.png`;
    await writeFile(join(out, file), Buffer.from(image.split(',')[1], 'base64'));
    return file;
  };
  const alignments = groups.length
    ? groups.map((e) => {
        const before = oldEpisodes.find(
          (b) => b.id === e.id && b.kind === e.kind && b.target === e.target,
        );
        if (!before) return { episode: e.id, missing: true };
        return { episode: e.id, before, after: e };
      })
    : [
        {
          episode: 'interval',
          before: { start: oldFrames[0].time, end: oldFrames.at(-1).time },
          after: { start: nowFrames[0].time, end: nowFrames.at(-1).time },
        },
      ];
  for (const alignment of alignments) {
    if (alignment.missing) {
      result.episodes.push(alignment);
      continue;
    }
    const { before, after, episode } = alignment;
    const originOld = oldEpisodes[0]?.start ?? oldFrames[0].time,
      originNew = newEpisodes[0]?.start ?? nowFrames[0].time;
    drift = Math.max(drift, Math.abs(after.start - originNew - (before.start - originOld)) * 1000);
    result.episodes.push({
      id: episode,
      before: {
        start: before.start,
        end: before.end,
        duration: before.end - before.start,
        firstChange: before.observed?.firstChange,
      },
      after: {
        start: after.start,
        end: after.end,
        duration: after.end - after.start,
        firstChange: after.observed?.firstChange,
      },
    });
    const anchors = [
      { phase: 'start', time: after.start },
      { phase: 'middle', time: (after.start + after.end) / 2 },
      { phase: 'end', time: after.end },
    ];
    // Adapter-provided stages are evidence of actual computation; normalized time remains separate.
    const stages = (samples) => {
      const found = new Map();
      for (const f of samples)
        for (const o of f.objects ?? []) {
          const stage = o.data?.frame?.phase;
          if (o.visible !== false && stage && !found.has(`${o.id}:${stage}`))
            found.set(`${o.id}:${stage}`, { phase: stage, time: f.time, key: `${o.id}:${stage}` });
        }
      return found;
    };
    const oldStages = stages(
      oldFrames.filter((f) => f.time >= before.start && f.time <= before.end),
    );
    for (const stage of stages(
      nowFrames.filter((f) => f.time >= after.start && f.time <= after.end),
    ).values()) {
      if (oldStages.has(stage.key))
        anchors.push({ ...stage, baselineTime: oldStages.get(stage.key).time });
    }
    for (const { phase, time, baselineTime } of anchors) {
      const current = nearestFrame(nowFrames, time);
      for (const mode of ['elapsed', baselineTime === undefined ? 'phase' : 'stage']) {
        const fraction = (time - after.start) / Math.max(Number.EPSILON, after.end - after.start);
        const target =
          mode === 'elapsed'
            ? before.start + (time - after.start)
            : mode === 'stage'
              ? baselineTime
              : before.start + fraction * (before.end - before.start);
        if (target > before.end + 1e-8) {
          result.notes.push(
            `${episode}: no ${mode} frame at ${target.toFixed(3)} s; durations differ`,
          );
          continue;
        }
        const old = nearestFrame(oldFrames, target);
        const pair = await analyzeMotionFrames(
          [
            { time: 0, png: frameInput(old) },
            { time: 1, png: frameInput(current) },
          ],
          {
            crop: report.crop ?? undefined,
            maxSize: Math.max(report.width, report.height),
            threshold: report.threshold,
          },
        );
        result.pairs.push({
          episode,
          mode,
          phase,
          time: current.time,
          relativeTime: current.time - after.start,
          baselineTime: old.time,
          timestampDistanceMs: Math.abs(old.time - target) * 1000,
          changedPercent: pair.intervals[0].changedPercent,
          baselineImage: await save(pair.frames[0].image, `${result.pairs.length}-before`),
          currentImage: await save(pair.frames[1].image, `${result.pairs.length}-after`),
          difference: await save(pair.difference, `${result.pairs.length}-difference`),
        });
      }
    }
  }
  for (const old of oldEpisodes.filter((e) => e.kind !== 'chapter' && e.kind !== 'context'))
    if (!groups.some((e) => e.id === old.id))
      result.episodes.push({ id: old.id, missing: 'after' });
  result.actionTimingDriftMs = drift;
  if (drift > 32)
    result.notes.push(
      `Расписание действий различается до ${drift.toFixed(1)} мс. Длительности сохранены отдельно от совмещения стадий.`,
    );
  result.metrics = {
    longFrames: { before: previous.runtime?.longFrameCount, after: report.runtime?.longFrameCount },
    maxInteractionMs: {
      before: previous.runtime?.maxInteractionMs,
      after: report.runtime?.maxInteractionMs,
    },
  };
  return result;
}
