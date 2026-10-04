import { nearestFrame } from './session.mjs';

export function unmarkedIntervals(review, minimum = 1) {
  const marked = (review.cues ?? []).filter((c) => c.kind === 'action' || c.kind === 'hold');
  return (review.segments ?? []).flatMap((segment) => {
    let cursor = segment.start;
    const gaps = [];
    for (const cue of marked
      .filter((c) => c.end > segment.start && c.start < segment.end)
      .sort((a, b) => a.start - b.start)) {
      if (cue.start - cursor >= minimum) gaps.push({ start: cursor, end: cue.start });
      cursor = Math.max(cursor, Math.min(segment.end, cue.end));
    }
    if (segment.end - cursor >= minimum) gaps.push({ start: cursor, end: segment.end });
    return gaps.map((gap) => ({
      ...gap,
      chapter: segment.id,
      title: segment.title,
      text: segment.text,
    }));
  });
}

export function storyEpisodes(review) {
  const chapters = (review.segments ?? []).map((s) => ({
    ...s,
    id: `chapter:${s.id}`,
    kind: 'chapter',
    title: s.title ?? s.id,
  }));
  return [
    ...chapters,
    ...(review.cues ?? [])
      .filter((c) => c.kind !== 'chapter')
      .map((c) => ({
        ...c,
        id: `cue:${c.id}`,
        cue: c.id,
        title: c.action ?? c.hold ?? c.id,
        parent: chapters.find((s) => c.start >= s.start && c.start < s.end)?.id,
        text:
          c.text ??
          c.quote ??
          chapters
            .filter((s) => c.start < s.end && c.end > s.start)
            .map((s) => s.text)
            .join(' '),
      })),
    ...unmarkedIntervals(review).map((g, i) => ({
      ...g,
      id: `unmarked:${i}`,
      kind: 'unmarked',
      parent: `chapter:${g.chapter}`,
      title: 'Речь без action/hold',
    })),
  ];
}

/** Keep seeks/pauses in their observed capture positions, retaining the authored media times. */
function mediaEpisodes(review, samples) {
  const authored = storyEpisodes(review),
    results = [],
    active = new Map(),
    occurrences = new Map();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!Number.isFinite(s.mediaTime)) continue;
    const next = samples[i + 1],
      until = next?.time ?? s.time;
    const delta = i > 0 ? s.mediaTime - samples[i - 1].mediaTime : 0;
    const jumped =
      i > 0 && (delta < -0.02 || delta > Math.max(0.5, 2 * (s.time - samples[i - 1].time)));
    const current = authored.filter((e) => s.mediaTime >= e.start && s.mediaTime < e.end);
    const ids = new Set(current.map((e) => e.id));
    for (const [id, e] of active)
      if (jumped || !ids.has(id)) {
        active.delete(id);
      }
    for (const e of current) {
      let entry = active.get(e.id);
      if (!entry) {
        const n = occurrences.get(e.id) ?? 0;
        occurrences.set(e.id, n + 1);
        entry = {
          ...e,
          id: n ? `${e.id}:visit:${n}` : e.id,
          media: { start: e.start, end: e.end },
          start: s.time,
          end: until,
          parent: undefined,
        };
        active.set(e.id, entry);
        results.push(entry);
      }
      entry.end = until;
    }
  }
  for (const e of results)
    if (e.kind !== 'chapter')
      e.parent = results.find(
        (c) => c.kind === 'chapter' && e.start >= c.start &&
          (e.start < c.end || (c.start === c.end && e.start === c.start)),
      )?.id;
  return results;
}

/** Inputs define episodes; changes describe them without deciding their correctness. */
export function buildEpisodes(samples, { context, telemetry, timeline } = {}) {
  const start = samples[0].time,
    end = samples.at(-1).time;
  let episodes;
  if (context?.review)
    episodes =
      context.clock === 'media'
        ? mediaEpisodes(context.review, telemetry?.scene ?? [])
        : storyEpisodes(context.review);
  else {
    const steps = (telemetry?.steps ?? []).filter((s) => s.phase === 'start' && s.type !== 'wait');
    const inputs = (telemetry?.events ?? []).filter(
      (e) => e.trusted && ['click', 'keydown', 'input', 'wheel'].includes(e.type),
    );
    // Explicit drag/fill/scroll steps are retained even when no click event exists.
    const actions = steps.length
      ? steps.flatMap((s) => {
          const after =
            telemetry.steps.find((e) => e.index === s.index && e.phase === 'end')?.time ?? end;
          const type = {
            click: 'click',
            dblclick: 'click',
            fill: 'input',
            press: 'keydown',
            scroll: 'wheel',
            drag: 'pointerdown',
            hover: 'pointerover',
          }[s.type];
          const events = (telemetry?.events ?? []).filter(
            (e) => e.trusted && e.type === type && e.time >= s.time && e.time <= after,
          );
          const actual = s.repeat ? events : events.slice(0, 1);
          return actual.length
            ? actual.map((e, n) => ({
                ...s,
                time: e.time,
                target: e.target,
                scheduledStart: s.time,
                completedAt: after,
                index: s.repeat ? `${s.index}:${n}` : s.index,
                anchor: 'observed-input',
              }))
            : [{ ...s, completedAt: after, anchor: 'scenario-start' }];
        })
      : inputs;
    episodes = actions.map((a, i) => ({
      id: `action:${a.index ?? i}`,
      kind: a.type,
      start: a.time,
      end: actions[i + 1]?.time ?? end,
      target: a.selector ?? a.target,
      title: `${a.type} ${a.name ?? a.selector ?? a.target ?? ''}`.trim(),
      source: steps.length ? 'scenario' : 'browser-input',
      anchor: a.anchor ?? 'observed-input',
      scheduledStart: a.scheduledStart,
      completedAt: a.completedAt,
    }));
    if (episodes.length && episodes[0].start > start)
      episodes.unshift({
        id: 'initial',
        kind: 'context',
        title: 'Исходное состояние',
        start,
        end: episodes[0].start,
      });
  }
  if (!episodes?.length) {
    const count = Math.max(1, Math.ceil((end - start) / 10));
    episodes = Array.from({ length: count }, (_, i) => ({
      id: `interval:${i}`,
      kind: 'interval',
      title: `Интервал ${i + 1}`,
      start: start + ((end - start) * i) / count,
      end: start + ((end - start) * (i + 1)) / count,
    }));
  }
  return episodes
    .filter((e) => e.end >= start && e.start <= end)
    .map((e) => {
      const from = Math.max(start, e.start),
        to = Math.min(end, e.end);
      const changes = (timeline?.intervals ?? []).filter(
        (v) => v.time >= from && v.time <= to && !v.duplicate,
      );
      const peak = changes.reduce((a, b) => (!a || b.meanDelta > a.meanDelta ? b : a), null);
      const times = [
        Math.max(start, from - 0.15),
        from,
        from + (to - from) / 2,
        to,
        Math.min(end, to + 0.15),
        ...(peak ? [peak.time] : []),
      ];
      const frames = [
        ...new Map(
          times.map((t) => {
            const f = nearestFrame(samples, t);
            return [f.id ?? f.time, { id: f.id, time: f.time }];
          }),
        ).values(),
      ].sort((a, b) => a.time - b.time);
      const inside = samples.filter((s) => s.time >= from && s.time <= to);
      const observations = [...new Set(inside.flatMap((s) => s.diagnostics ?? []))];
      const subjectState = (sample) =>
        e.targets?.length
          ? JSON.stringify(e.targets.map((id) => sample.subjects?.[id] ?? null))
          : (sample.subjects?.$subject ?? sample.digest);
      const subjectAvailable = inside.every((s) =>
        e.targets?.length
          ? e.targets.every((id) => s.subjects?.[id] !== undefined)
          : Boolean(subjectState(s)),
      );
      if (
        e.kind === 'action' &&
        inside.length > 1 &&
        subjectAvailable &&
        new Set(inside.map(subjectState)).size === 1
      )
        observations.push('Выбранные состояния внутри действия одинаковы.');
      if (e.referenced === false && e.kind === 'action')
        observations.push('В снятых состояниях нет обращения к метке.');
      if (e.kind === 'unassigned') observations.push('У метки отсутствует описание action/hold.');
      return {
        ...e,
        frames,
        observations,
        observed: {
          from,
          to,
          firstChange: changes[0]?.time,
          lastChange: changes.at(-1)?.time,
          sampledFrames: samples.filter((s) => s.time >= from && s.time <= to).length,
          scope: e.targets?.length
            ? { objects: e.targets }
            : inside.some((s) => s.subjects?.$subject)
              ? 'subject without player/captions'
              : 'whole frame',
          note: 'Изменения изображения; связь с действием и завершение процесса оценивает просматривающий.',
        },
      };
    });
}

export function selectEpisode(episodes, id) {
  const found = episodes.find((e) => e.id === id || e.cue === id);
  if (!found)
    throw new Error(`Unknown episode ${id}. Available: ${episodes.map((e) => e.id).join(', ')}`);
  return found;
}
