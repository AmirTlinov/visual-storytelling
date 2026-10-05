/** The model receives a short observation; word timings and layout diagnostics are opt-in. */
export function presentSession(value, detail = 'state') {
  const { state, result, ...session } = value;
  if (!state) return session;
  session.state = {
    time: state.time,
    duration: state.duration,
    playing: state.playing,
    mode: state.mode,
    muted: state.muted,
    rate: state.rate,
    selected: state.selected,
    objects:
      detail === 'model'
        ? state.objects
        : state.objects?.slice(0, 20).map(({ value, ...object }) => object),
    moreObjects: state.objects?.length > 20 ? state.objects.length - 20 : undefined,
    experimentHistory: state.experimentHistory,
    capabilities: state.capabilities,
    parameters: state.parameters,
    cue: state.review?.cues
      .filter((cue) => cue.start <= state.time && state.time <= cue.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0],
  };
  if (detail === 'model') session.state.snapshot = state.snapshot;
  if (detail === 'timeline') session.state.timeline = state.review;
  if (detail === 'presentation') session.state.presentation = state.presentation;
  if (Array.isArray(result)) session.matches = result;
  return session;
}
export function toolResult(value) {
  const state = value.state;
  const text = state
    ? `${value.title}. ${state.playing ? 'Playing' : 'Paused'} at ${state.time.toFixed(2)} / ${state.duration.toFixed(2)} s; ${state.mode}. Session ${value.sessionId}.`
    : `${value.title ?? 'Visual Storytelling'}. Session ${value.sessionId}.`;
  return { content: [{ type: 'text', text }], structuredContent: value };
}
