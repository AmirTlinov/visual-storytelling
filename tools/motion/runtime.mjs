export function summarizeRuntime(telemetry, viewport) {
  if (!telemetry) return undefined;
  const trajectories = [];
  for (const selector of new Set(telemetry.elements.map((point) => point.selector))) {
    const points = telemetry.elements.filter(
      (point) => point.selector === selector && !point.missing,
    );
    const steps = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        dt = b.time - a.time;
      if (dt <= 0) continue;
      const dx = b.x + b.width / 2 - (a.x + a.width / 2),
        dy = b.y + b.height / 2 - (a.y + a.height / 2);
      steps.push({
        time: b.time,
        x: b.x + b.width / 2,
        y: b.y + b.height / 2,
        speed: Math.hypot(dx, dy) / dt,
        velocityX: dx / dt,
        velocityY: dy / dt,
        dx,
        dy,
        dt,
      });
    }
    const biggest = steps.reduce(
      (a, b) => (Math.hypot(b.dx, b.dy) > Math.hypot(a?.dx ?? 0, a?.dy ?? 0) ? b : a),
      null,
    );
    const clipped = points.find(
      (p) =>
        p.visible &&
        p.opacity > 0 &&
        (p.x < -0.5 ||
          p.y < -0.5 ||
          p.x + p.width > viewport.width + 0.5 ||
          p.y + p.height > viewport.height + 0.5),
    );
    const overflow = points.find(
      (p) =>
        p.visible &&
        p.opacity > 0 &&
        ((['hidden', 'clip'].includes(p.overflowX) && p.scrollWidth > p.clientWidth + 2) ||
          (['hidden', 'clip'].includes(p.overflowY) && p.scrollHeight > p.clientHeight + 2)),
    );
    const hidden = (p) => !p.visible || p.opacity < 0.01;
    const blinks = [];
    for (let i = 1; i < points.length - 1; i++) {
      if (!hidden(points[i]) || hidden(points[i - 1])) continue;
      const end = points.findIndex((p, j) => j > i && !hidden(p));
      if (end > i && points[end].time - points[i].time <= 0.12)
        blinks.push({
          time: points[i].time,
          durationMs: (points[end].time - points[i].time) * 1000,
        });
    }
    trajectories.push({
      selector,
      observedSamples: points.length,
      points: steps,
      velocityNote:
        'Finite differences between DOM observations; delayed callbacks can create derivative spikes. The report plots position to preserve direction and timing context.',
      largestStep: biggest,
      clippedAt: clipped?.time,
      contentClippedAt: overflow?.time,
      missingSamples: telemetry.elements.filter((p) => p.selector === selector && p.missing).length,
      blinks,
    });
  }
  const raf = telemetry.raf
    .slice(1)
    .map((time, i) => (time - telemetry.raf[i]) * 1000)
    .sort((a, b) => a - b);
  const events = telemetry.events.filter((entry) => Number.isFinite(entry.duration));
  const clicks = telemetry.events.filter((entry) => entry.type === 'click' && entry.trusted);
  const insights = [
    ...(telemetry.error ? [{ kind: 'action-error', detail: telemetry.error }] : []),
    ...telemetry.messages
      .filter(
        (m) =>
          m.kind === 'error' &&
          !(m.location?.url?.endsWith('/favicon.ico') && m.text.includes('404')),
      )
      .map((m) => ({ kind: 'page-error', time: m.time, detail: m.text, location: m.location })),
    ...telemetry.longFrames.map((frame) => ({
      kind: 'long-animation-frame',
      time: frame.time,
      durationMs: frame.duration,
      scripts: frame.scripts,
      detail: `Browser main-thread frame lasted ${frame.duration.toFixed(1)} ms`,
    })),
    ...trajectories.flatMap((track) =>
      track.blinks.map((blink) => ({
        kind: 'brief-disappearance',
        evidence: 'DOM',
        target: track.selector,
        ...blink,
        detail: `Target becomes invisible for ${blink.durationMs.toFixed(1)} ms and returns; inspect the captured frames`,
      })),
    ),
    ...trajectories
      .filter((t) => !t.observedSamples)
      .map((t) => ({
        kind: 'target-not-observed',
        target: t.selector,
        detail:
          'No measurable target trajectory; check its selector and whether the scenario reached this state',
      })),
    ...trajectories
      .filter((t) => t.clippedAt !== undefined)
      .map((t) => ({
        kind: 'outside-viewport',
        time: t.clippedAt,
        target: t.selector,
        detail: 'Target extends beyond the viewport; inspect whether the clipping is intended',
      })),
    ...trajectories
      .filter((t) => t.contentClippedAt !== undefined)
      .map((t) => ({
        kind: 'content-clipped',
        time: t.contentClippedAt,
        target: t.selector,
        detail: 'Content exceeds a container using hidden/clip overflow',
      })),
  ];
  return {
    capabilities: telemetry.capabilities,
    trajectories,
    insights,
    steps: telemetry.steps,
    events: telemetry.events,
    clickTimes: clicks.map((entry) => entry.time),
    clickIntervalsMs: clicks.slice(1).map((entry, i) => (entry.time - clicks[i].time) * 1000),
    layoutShifts: telemetry.layoutShifts,
    mainThreadIntervalMs: {
      p50: raf[Math.floor(raf.length * 0.5)] ?? 0,
      p95: raf[Math.floor(raf.length * 0.95)] ?? 0,
      max: raf.at(-1) ?? 0,
    },
    longFrameCount: telemetry.longFrames.length,
    maxInteractionMs: events.length
      ? events.reduce((max, e) => Math.max(max, e.duration), 0)
      : null,
    warning: telemetry.warning,
  };
}
