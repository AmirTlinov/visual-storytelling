/** Keep the chosen evidence and next action visible; complete data is available with --verbose. */
function stateSummary(state) {
  if (!state || typeof state !== 'object') return { state };
  const kept = {},
    omitted = [];
  let remaining = 700;
  for (const [key, value] of Object.entries(state)) {
    const size = key.length + (JSON.stringify(value)?.length ?? 0);
    if (size <= Math.min(240, remaining)) {
      kept[key] = value;
      remaining -= size;
    } else omitted.push(key);
  }
  return { state: kept, ...(omitted.length ? { stateOmitted: omitted } : {}) };
}

const pick = (value, keys) =>
  Object.fromEntries(
    keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]),
  );
const episode = (value) => pick(value, ['id', 'kind', 'title', 'start', 'end', 'observations']);
const subject = (value) => ({
  ...pick(value, [
    'id',
    'text',
    'x',
    'y',
    'width',
    'height',
    'visible',
    'missing',
    'parent',
    'sourceFile',
  ]),
  ...(value.data ? { data: stateSummary(value.data) } : {}),
});

export function compactInspection(result) {
  const source = pick(result.source, [
    'kind',
    'title',
    'clock',
    'sampling',
    'sparse',
    'timingNote',
    'warning',
    'truncated',
    'error',
  ]);
  if (!result.selection)
    return {
      ...result,
      source,
      ...(result.episodes ? { episodes: result.episodes.map(episode) } : {}),
      ...(result.list === 'episodes' ? { items: result.items.map(episode) } : {}),
    };
  const selected = new Set(
    Object.values(result.selection)
      .filter(Boolean)
      .map((frame) => frame.time),
  );
  return {
    ...pick(result, [
      'image',
      'imageUnavailable',
      'view',
      'comparisonImage',
      'frameImage',
      'onionImage',
      'changesImage',
      'comparisonUnavailable',
    ]),
    selection: result.selection,
    ...pick(result, ['crop', 'focus', 'navigation']),
    ...(result.onion ? { onion: pick(result.onion, ['time', 'radius', 'layers']) } : {}),
    frames: result.frames
      .filter((frame) => selected.has(frame.time) && frame.state !== undefined)
      .map((frame) => ({ id: frame.id, time: frame.time, ...stateSummary(frame.state) })),
    ...(result.requested?.object
      ? { objects: result.objects.map(subject), bounds: result.bounds }
      : { objectCount: result.objectCount ?? result.objects.length }),
    ...(result.scene
      ? { scene: { time: result.scene.time, ...stateSummary(result.scene.state) } }
      : {}),
    source,
    ...pick(result, ['session', 'requested', 'observed', 'elapsedMs']),
    details:
      '--verbose returns all saved state, geometry, trajectories and events. --list objects finds details to enlarge with --object ID --crop auto.',
  };
}
