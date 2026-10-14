/** Renderer takeover owns no second store; it serializes against the same session. */
export function attachSession(owner, id, renderer) {
  const s = owner.get(id);
  // Each takeover observes the owner selected by its predecessor, including failed attempts.
  const attempt = (s.attaching ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      owner.get(id);
      if (s.replacement)
        throw new Error('The scene is applying an update. Retry after it finishes.');
      let reason = s.checkpoint ? 'reconnect' : 'initial';
      if (s.renderer === renderer) reason = 'current';
      else {
        s.handoff = true;
        try {
          if (s.renderer) {
            reason = 'handoff';
            if (owner.expired(s)) reason = 'lease-expired';
            else {
              try {
                // A live owner must confirm its pause before another renderer takes over.
                await owner.request(id, { op: 'suspend' });
              } catch (error) {
                owner.get(id);
                if (s.renderer && !owner.expired(s)) {
                  await owner.resume(s);
                  throw error;
                }
                reason = s.renderer ? 'lease-expired' : 'reconnect';
              }
            }
          }
          owner.get(id);
          owner.rejectPending(s, 'Renderer changed. Inspect before issuing another command.');
          s.generation++;
          s.appliedAuthor = undefined;
          s.renderer = renderer;
          owner.pruneAttempts(s);
          s.ready = false;
          s.lastPollAt = Date.now();
          s.wake?.();
        } finally {
          s.handoff = false;
        }
      }
      return {
        ...owner.describe(s),
        checkpoint: s.checkpoint,
        ...(s.build.live && { authoredDocument: s.build.live.document }),
        authoring: s.appliedAuthor && {
          requestId: s.appliedAuthor.requestId,
          commandId: s.appliedAuthor.id,
          buildRevision: s.appliedAuthor.build.revision,
          sourceRevision: s.appliedAuthor.build.sourceRevision,
        },
        // Expiry recovers the last observation, not proof of the former renderer's final frame.
        restoration: {
          reason,
          observedAt: s.observedAt,
          checkpoint: s.checkpoint ? 'last-confirmed' : 'none',
        },
      };
    });
  s.attaching = attempt;
  const finished = () => {
    if (s.attaching === attempt) s.attaching = null;
  };
  attempt.then(finished, finished);
  return attempt;
}
