/** One replaceable attachment. It neither sends chat messages nor starts model turns. */
export function frameContext(app, extensions) {
  let latest,
    timer,
    sending = false,
    removed = false,
    closed = false,
    published = false,
    signature,
    observedHost;
  let inFlight = Promise.resolve();
  const ownUpdates = new Set();
  const compact = (value) => (typeof value === 'string' ? value.slice(0, 100) : value);
  const payload = (value) => ({
    structuredContent: { visualStory: { ...value, observedAt: new Date().toISOString() } },
  });
  async function flush() {
    if (sending || removed || closed || !latest) return;
    const next = latest;
    latest = null;
    const key = JSON.stringify(next);
    if (key === signature) return;
    sending = true;
    try {
      inFlight = extensions.modelContext
        ? extensions.modelContext.update(payload(next))
        : app.updateModelContext(payload(next));
      const reply = await inFlight;
      if (reply?.updateId) ownUpdates.add(reply.updateId);
      while (ownUpdates.size > 8) ownUpdates.delete(ownUpdates.values().next().value);
      published = true;
      signature = key;
      if (observedHost && !ownUpdates.has(observedHost.updateId)) removed = true;
    } catch {
      signature = undefined;
    } finally {
      sending = false;
      if (latest) void flush();
    }
  }
  return {
    update(session, report) {
      if (removed || closed) return;
      const cue = report.state.cue;
      const entries = Object.entries(report.checkpoint.values);
      latest = {
        sessionId: session.sessionId,
        projectId: session.projectId,
        buildRevision: session.buildRevision,
        stateRevision: report.stateRevision,
        renderStatus: report.renderStatus,
        time: Math.round(report.state.time * 10) / 10,
        cue: cue
          ? { id: cue.id, label: (cue.action ?? cue.hold ?? cue.text ?? '').slice(0, 160) }
          : undefined,
        mode: report.state.mode,
        selected: report.state.selected?.slice(0, 4),
        parameters: Object.fromEntries(entries.slice(0, 8).map(([k, v]) => [k, compact(v)])),
        moreParameters: entries.length > 8 ? entries.length - 8 : undefined,
      };
      // IDs retain their meaning; omit detail rather than truncating identifiers.
      const overBudget = () => JSON.stringify(payload(latest)).length > 1500;
      while (overBudget() && Object.keys(latest.parameters).length) {
        delete latest.parameters[Object.keys(latest.parameters).at(-1)];
        latest.moreParameters = entries.length - Object.keys(latest.parameters).length;
      }
      while (overBudget() && latest.selected?.length) latest.selected.pop();
      if (overBudget()) delete latest.cue;
      clearTimeout(timer);
      timer = setTimeout(flush, 120);
    },
    host(value) {
      if (!('openai/modelContext' in value)) return;
      observedHost = value['openai/modelContext'];
      if ((published || sending) && observedHost === null) removed = true;
      else if (published && !sending && observedHost && !ownUpdates.has(observedHost.updateId))
        removed = true;
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      latest = null;
      await inFlight.catch(() => {});
      if (published && !removed)
        await app.updateModelContext({ structuredContent: {} }).catch(() => {});
    },
  };
}
