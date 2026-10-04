/** Shared by the CLI and HTML: selecting evidence never repeats a UI action. */
export function queryEvidence(data, query = {}) {
  const { frames, episodes = [], telemetry = {}, source = {} } = data;
  if (!frames?.length) throw new Error('This capture has no frames');
  const limit = query.limit ?? 7;
  if (!Number.isInteger(limit) || limit < 1 || limit > 32)
    throw new Error('limit must be between 1 and 32');
  for (const key of ['at', 'from', 'to', 'radius'])
    if (query[key] !== undefined && !Number.isFinite(query[key]))
      throw new Error(`${key} must be finite`);
  if (query.radius !== undefined && query.radius <= 0) throw new Error('radius must be positive');
  const episode = query.episode
    ? episodes.find((e) => e.id === query.episode || e.cue === query.episode)
    : undefined;
  if (query.episode && !episode) throw new Error(`Unknown episode ${query.episode}`);
  const from =
    query.from ??
    (query.at !== undefined
      ? query.at - (query.radius ?? 0.3)
      : (episode?.start ?? frames[0].time));
  const to =
    query.to ??
    (query.at !== undefined
      ? query.at + (query.radius ?? 0.3)
      : (episode?.end ?? frames.at(-1).time));
  if (to < from) throw new Error('The interval end must follow its start');
  const at = query.at ?? (from + to) / 2;
  const nearest = (time) => {
    let lo = 0,
      hi = frames.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (frames[m].time < time) lo = m + 1;
      else hi = m;
    }
    return lo && Math.abs(frames[lo - 1].time - time) < Math.abs(frames[lo].time - time)
      ? frames[lo - 1]
      : frames[lo];
  };
  // Geometry is observed in CSS coordinates; selection and crops use source image pixels.
  const pixels = (o, frame = nearest(o.time ?? at)) => {
    if (o.coordinates !== 'css-viewport') return o;
    const viewport = o.viewport ?? source.viewport;
    const sx = frame.width && viewport?.width ? frame.width / viewport.width : 1;
    const sy = frame.height && viewport?.height ? frame.height / viewport.height : 1;
    return {
      ...o,
      x: o.x * sx,
      y: o.y * sy,
      width: o.width * sx,
      height: o.height * sy,
      coordinates: 'source-pixels',
    };
  };
  const visible = (o) =>
    !o.missing && o.visible !== false && o.opacity !== 0 && o.width > 0 && o.height > 0;
  let selected = frames.filter((f) => f.time >= from && f.time <= to);
  const observedFrames = selected.length;
  if (selected.length < 2) {
    const a = frames.findLastIndex((f) => f.time <= from),
      b = frames.findIndex((f) => f.time >= to);
    selected = frames.slice(Math.max(0, a), b < 0 ? undefined : b + 1);
  }
  const count = Math.min(limit, selected.length);
  selected = [
    ...new Set(
      Array.from(
        { length: count },
        (_, i) => selected[Math.round((i * (selected.length - 1)) / Math.max(1, count - 1))],
      ),
    ),
  ];
  const currentFrame = nearest(at),
    latest = new Map();
  const documentAt = (telemetry.documents ?? [])
    .filter((d) => d.time <= at)
    .sort((a, b) => a.time - b.time)
    .at(-1)?.url;
  for (const e of telemetry.elements ?? [])
    if (e.time <= at && (!documentAt || !e.document || e.document === documentAt))
      latest.set(e.selector, e);
  const scene = (telemetry.scene ?? []).findLast((s) => s.time <= at);
  const allObjects = [
    ...(currentFrame.objects ?? []),
    ...(scene?.objects ?? []),
    ...[...latest.values()].map((e) => ({
      ...e,
      id: e.selector,
      evidence: 'DOM; inspect pixel timing separately',
    })),
  ].map((o) => pixels(o, currentFrame));
  const objects = [...new Map(allObjects.map((o) => [o.id, o])).values()];
  const hit = query.point
    ? objects
        .filter(
          (o) =>
            visible(o) &&
            query.point[0] >= o.x &&
            query.point[0] <= o.x + o.width &&
            query.point[1] >= o.y &&
            query.point[1] <= o.y + o.height,
        )
        .sort((a, b) => a.width * a.height - b.width * b.height)
    : objects;
  const wanted = query.object ?? (query.point ? hit[0]?.id : undefined);
  const compact = (o) => ({
    id: o.id ?? o.selector,
    time: o.time,
    text: o.text,
    textSource: o.textSource,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    opacity: o.opacity,
    visible: o.visible,
    missing: o.missing,
    document: o.document,
    depth: o.depth,
  });
  const rawTrajectory = wanted
    ? [
        ...(telemetry.elements ?? [])
          .filter((e) => e.selector === wanted && e.time >= from && e.time <= to)
          .map((e) => ({ ...e, id: e.selector })),
        ...(telemetry.scene ?? [])
          .filter((s) => s.time >= from && s.time <= to)
          .flatMap((s) =>
            (s.objects ?? []).filter((o) => o.id === wanted).map((o) => ({ ...o, time: s.time })),
          ),
        ...frames
          .filter((f) => f.time >= from && f.time <= to)
          .flatMap((f) =>
            (f.objects ?? []).filter((o) => o.id === wanted).map((o) => ({ ...o, time: f.time })),
          ),
      ]
        .map((o) => pixels(o))
        .sort((a, b) => a.time - b.time)
    : [];
  const ancestry = [];
  const object = objects.find((o) => o.id === wanted);
  if (object?.ancestors) {
    for (const id of object.ancestors) {
      const parent = objects.find((o) => o.id === id);
      if (parent) ancestry.push(parent);
    }
  } else {
    for (let o = object; o?.parent && ancestry.length < 24; ) {
      o = objects.find((p) => p.id === o.parent);
      if (o) ancestry.push(o);
    }
  }
  const candidates = [...rawTrajectory, ...objects.filter((o) => o.id === wanted)].filter(visible);
  let bounds;
  if (candidates.length) {
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const b of candidates) {
      left = Math.min(left, b.x);
      top = Math.min(top, b.y);
      right = Math.max(right, b.x + b.width);
      bottom = Math.max(bottom, b.y + b.height);
    }
    bounds = { x: left, y: top, width: right - left, height: bottom - top };
  }
  const region =
    query.point && !wanted
      ? {
          x: Math.max(0, query.point[0] - 64),
          y: Math.max(0, query.point[1] - 64),
          width: 128,
          height: 128,
          evidence: 'Fixed pixel region; no observed object identity',
        }
      : undefined;
  bounds ??= region;
  const trajectory =
    rawTrajectory.length <= 32
      ? rawTrajectory
      : Array.from(
          { length: 32 },
          (_, i) => rawTrajectory[Math.round((i * (rawTrajectory.length - 1)) / 31)],
        );
  return {
    requested: {
      from,
      to,
      at: query.at,
      episode: query.episode,
      object: wanted,
      point: query.point,
    },
    observed: { from: selected[0]?.time, to: selected.at(-1)?.time, frames: observedFrames },
    frames: selected.map((f) => ({
      id: f.id,
      time: f.time,
      file: f.file,
      state: f.state,
      cueReads: f.cueReads,
      diagnostics: f.diagnostics,
      objects: (f.objects ?? [])
        .filter((o) => (wanted ? o.id === wanted : visible(o)))
        .slice(0, wanted ? 32 : 12)
        .map((o) => (wanted ? pixels(o, f) : compact(pixels(o, f)))),
    })),
    objects: hit.filter((o) => (wanted ? o.id === wanted : visible(o))).slice(0, wanted ? 32 : 40),
    hits: query.point ? hit.slice(0, 12).map(compact) : undefined,
    ancestors: ancestry,
    bounds,
    region,
    trajectory: trajectory.map(compact),
    trajectorySamples: rawTrajectory.length,
    ...(scene
      ? {
          scene: {
            time: scene.time,
            mediaTime: scene.mediaTime,
            state: scene.state,
            cueReads: scene.cueReads,
            inspectionMs: scene.inspectionMs,
          },
        }
      : {}),
    events: (telemetry.events ?? [])
      .filter((e) => e.time >= from && e.time <= to && (e.trusted || e.duration > 50))
      .map((e) => ({
        type: e.type,
        time: e.time,
        target: e.target,
        duration: e.duration,
        interactionId: e.interactionId,
        key: e.key,
      })),
    steps: (telemetry.steps ?? []).filter((e) => e.time >= from && e.time <= to),
    episodes: episodes.filter((e) => e.start <= to && e.end >= from),
  };
}
