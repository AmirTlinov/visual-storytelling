/** The model receives a short observation; word timings and layout diagnostics are opt-in. */
export function presentSession(value, detail = 'state') {
  const { state, result, ...session } = value;
  if (!state) return session;
  const moreObjects =
    (state.moreObjects ?? 0) +
    (detail === 'model' ? 0 : Math.max(0, (state.objects?.length ?? 0) - 20));
  session.state = {
    time: state.time,
    duration: state.duration,
    playing: state.playing,
    mode: state.mode,
    viewTransition: state.viewTransition,
    muted: state.muted,
    rate: state.rate,
    selected: state.selected,
    objects:
      detail === 'model'
        ? state.objects
        : state.objects?.slice(0, 20).map(({ value, provenance, ...object }) => object),
    moreObjects: moreObjects || undefined,
    experimentHistory: state.experimentHistory,
    capabilities: state.capabilities,
    compatibility: state.compatibility,
    restoreNotices: state.restoreNotices,
    parameters: state.parameters,
    cue:
      state.cue ??
      state.review?.cues
        .filter(
          (cue) =>
            cue.start <= state.time &&
            cue.end > cue.start &&
            (state.time < cue.end || (state.time === state.duration && cue.end === state.duration)),
        )
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0],
  };
  if (detail === 'model') session.state.snapshot = state.snapshot;
  if (detail === 'timeline') session.state.timeline = state.timeline ?? state.review;
  if (detail === 'presentation') session.state.presentation = state.presentation;
  if (Array.isArray(result)) session.matches = result;
  return session;
}
export function toolResult(value) {
  const state = value.state;
  const playback =
    state?.playing === true
      ? 'Playing'
      : state?.playing === false
        ? 'Paused'
        : 'Playback state unavailable';
  let text = state
    ? `${value.title}. ${playback}; position ${state.time.toFixed(2)} / ${state.duration.toFixed(2)} s; ${state.mode}. Session ${value.sessionId}.`
    : `${value.title ?? 'Visual Storytelling'}. Session ${value.sessionId}.`;
  if (value.renderStatus === 'prepared') text += ' Frame prepared; host repaint deferred.';
  return { content: [{ type: 'text', text }], structuredContent: value };
}
