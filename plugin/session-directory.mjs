import { randomUUID, createHash } from 'node:crypto';
import { failure } from './errors.mjs';
import { presentSession } from './mcp/presentation.mjs';

const digest = (value) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_, item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, item[key]]),
            )
          : item,
      ),
    )
    .digest('hex');
const commandExpired =
  'The view did not confirm this command before its deadline. Inspect before retrying.';

/** Routes commands to the displayed runtime. Never advances time or evaluates a scene. */
export class SessionDirectory {
  instance = randomUUID();
  sessions = new Map();
  closed = false;

  constructor({ timeout = 8000, rendererTimeout = 8000, pollTimeout = 1500 } = {}) {
    for (const value of [timeout, rendererTimeout, pollTimeout])
      if (!Number.isFinite(value) || value <= 0)
        throw new Error('Session timeouts must be positive.');
    this.timeout = timeout;
    this.rendererTimeout = rendererTimeout;
    this.pollTimeout = pollTimeout;
  }

  open(build, id) {
    if (this.closed) throw new Error('Server closed.');
    if (id) return this.get(id);
    const session = {
      id: randomUUID(),
      build,
      generation: 0,
      renderer: null,
      ready: false,
      checkpoint: null,
      state: null,
      stateRevision: 0,
      observedAt: null,
      lastPollAt: null,
      pending: new Map(),
      receipts: new Map(),
      queue: [],
      wake: null,
      attaching: null,
      handoff: false,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id) {
    if (this.closed) throw new Error('Server closed.');
    const session = this.sessions.get(id);
    if (!session) throw new Error('Session is unavailable. Open the project again.');
    return session;
  }

  expired(session) {
    return session.renderer && Date.now() - session.lastPollAt >= this.rendererTimeout;
  }

  describe(session) {
    return {
      sessionId: session.id,
      serverInstance: this.instance,
      buildRevision: session.build.revision,
      projectId: session.build.projectId,
      sourceRevision: session.build.sourceRevision,
      title: session.build.title,
      returnAvailable: Boolean(session.returnTo?.length),
      generation: session.generation,
      stateRevision: session.stateRevision,
      renderStatus: session.renderStatus,
      observationError: session.observationError,
      status: session.renderer
        ? this.expired(session)
          ? 'unresponsive'
          : session.ready
            ? 'connected'
            : 'opening'
        : 'closed',
      observedAt: session.observedAt,
      state: session.state,
      update: session.nextBuild
        ? {
            buildRevision: session.nextBuild.revision,
            sourceRevision: session.nextBuild.sourceRevision,
          }
        : undefined,
    };
  }

  attach(id, renderer) {
    const s = this.get(id);
    // Each takeover observes the owner selected by its predecessor, including failed attempts.
    const attempt = (s.attaching ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        this.get(id);
        if (s.replacement)
          throw new Error('The scene is applying an update. Retry after it finishes.');
        let reason = s.checkpoint ? 'reconnect' : 'initial';
        if (s.renderer === renderer) reason = 'current';
        else {
          s.handoff = true;
          try {
            if (s.renderer) {
              reason = 'handoff';
              if (this.expired(s)) reason = 'lease-expired';
              else {
                try {
                  // A live owner must confirm its pause before another renderer takes over.
                  await this.request(id, { op: 'suspend' });
                } catch (error) {
                  this.get(id);
                  if (s.renderer && !this.expired(s)) {
                    await this.resume(s);
                    throw error;
                  }
                  reason = s.renderer ? 'lease-expired' : 'reconnect';
                }
              }
            }
            this.get(id);
            this.rejectPending(s, 'Renderer changed. Inspect before issuing another command.');
            s.generation++;
            s.renderer = renderer;
            s.ready = false;
            s.lastPollAt = Date.now();
            s.wake?.();
          } finally {
            s.handoff = false;
          }
        }
        return {
          ...this.describe(s),
          checkpoint: s.checkpoint,
          html: s.build.html,
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

  validate(s, renderer, generation) {
    if (this.closed || s.renderer !== renderer || s.generation !== generation)
      throw new Error('This view has been replaced. Reopen it to continue here.');
  }

  /** Keep the old owner until the candidate has restored its final, suspended checkpoint. */
  async replace({
    sessionId,
    renderer,
    generation,
    buildRevision,
    phase = 'prepare',
    replacementId,
  }) {
    const s = this.get(sessionId);
    this.validate(s, renderer, generation);
    if (phase !== 'prepare') {
      const pending = s.replacement;
      if (!pending || pending.id !== replacementId || pending.build.revision !== buildRevision)
        throw new Error('This prepared update is no longer available.');
      if (phase === 'abort') {
        await this.abortReplacement(s, pending);
        return this.describe(s);
      }
      if (phase !== 'commit') throw new Error('Unknown update phase.');
      if (
        !pending.prepared ||
        pending.aborting ||
        Date.now() >= pending.expiresAt ||
        s.nextBuild !== pending.build
      ) {
        await this.abortReplacement(s, pending);
        throw new Error('The prepared build changed or expired. Load its candidate again.');
      }
      clearTimeout(pending.timer);
      this.rejectPending(s, 'Build changed. Inspect the new scene.');
      s.build = pending.build;
      s.nextBuild = null;
      s.replacement = undefined;
      s.handoff = false;
      s.generation++;
      s.ready = false;
      s.state = null;
      s.wake?.();
      return { ...this.describe(s), checkpoint: s.checkpoint, widgetState: s.widgetState ?? {} };
    }
    if (s.handoff) throw new Error('The view is already changing.');
    if (s.nextBuild?.revision !== buildRevision)
      throw new Error('A newer preparation is available. Load its candidate first.');
    s.handoff = true;
    const pending = (s.replacement = {
      id: randomUUID(),
      build: s.nextBuild,
      renderer,
      generation,
    });
    try {
      if (s.ready) await this.request(sessionId, { op: 'suspend' });
      this.validate(s, renderer, generation);
      if (s.nextBuild !== pending.build)
        throw new Error('The prepared build changed. Reopen the latest candidate.');
      pending.prepared = true;
      pending.expiresAt = Date.now() + this.timeout;
      pending.timer = setTimeout(() => void this.abortReplacement(s, pending), this.timeout);
      return {
        ...this.describe(s),
        replacementId: pending.id,
        expiresAt: pending.expiresAt,
        checkpoint: s.checkpoint,
        widgetState: s.widgetState ?? {},
      };
    } catch (error) {
      await this.abortReplacement(s, pending);
      throw error;
    }
  }

  async abortReplacement(s, pending) {
    if (s.replacement !== pending) return;
    if (pending.aborting) return pending.aborting;
    pending.aborting = (async () => {
      clearTimeout(pending.timer);
      if (s.renderer === pending.renderer && s.generation === pending.generation && !this.closed)
        await this.resume(s);
      if (s.replacement === pending) {
        s.replacement = undefined;
        s.handoff = false;
      }
    })();
    return pending.aborting;
  }

  /** A rejected handoff leaves the current view mounted and paused, ready for more input. */
  async resume(s) {
    if (!s.renderer || this.expired(s)) return;
    await this.request(s.id, { op: 'resume' }).catch(() => {});
  }

  async exchange({ sessionId, renderer, generation, report, acknowledgements = [], wait = true }) {
    const s = this.get(sessionId);
    this.validate(s, renderer, generation);
    if (report) {
      if (
        !Number.isSafeInteger(report.stateRevision) ||
        report.stateRevision < 0 ||
        !report.state ||
        typeof report.state !== 'object' ||
        Array.isArray(report.state) ||
        !report.checkpoint ||
        typeof report.checkpoint !== 'object' ||
        Array.isArray(report.checkpoint)
      )
        throw new Error('Invalid scene report.');
      if (report.stateRevision >= s.stateRevision) {
        s.state = report.state;
        s.checkpoint = report.checkpoint;
        s.stateRevision = report.stateRevision;
        s.renderStatus = report.renderStatus ?? 'rendered';
        s.observationError = report.observationError;
        s.observedAt = new Date().toISOString();
        s.ready = true;
        s.wake?.();
      }
    }
    this.expirePending(s);
    for (const ack of acknowledgements) {
      const pending = s.pending.get(ack.id);
      if (!pending || pending.generation !== generation) continue;
      clearTimeout(pending.timer);
      s.pending.delete(ack.id);
      s.queue = s.queue.filter((command) => command.id !== ack.id);
      if (ack.error !== undefined)
        pending.reject(
          failure(
            ack.failure?.code ?? 'view_command_failed',
            ack.error || 'The view could not execute this command.',
            {
              ...ack.failure,
              current: presentSession(this.describe(s)),
              action: 'story_inspect',
            },
          ),
        );
      else
        pending.resolve({
          ...this.describe(s),
          result: ack.result,
          acknowledgement: s.renderStatus,
        });
    }
    // Reports and acknowledgements must never consume the poll channel's commands.
    if (!wait) return { commands: [], ...this.describe(s) };
    if (!s.ready || !s.queue.length) {
      s.wake?.();
      await new Promise((resolve) => {
        const timer = setTimeout(done, this.pollTimeout);
        function done() {
          clearTimeout(timer);
          if (s.wake === done) s.wake = null;
          resolve();
        }
        s.wake = done;
      });
    }
    this.validate(s, renderer, generation);
    this.expirePending(s);
    s.lastPollAt = Date.now();
    return { commands: s.ready ? s.queue.splice(0) : [], ...this.describe(s) };
  }

  request(id, request) {
    const s = this.get(id);
    const pauseOnly =
      request.op === 'control' &&
      request.commands?.length &&
      request.commands.every((c) => c.type === 'pause');
    if (
      request.op === 'control' &&
      !pauseOnly &&
      (!request.buildRevision || request.stateRevision === undefined)
    )
      return Promise.reject(
        failure('revision_required', 'Inspect the scene before changing it.', {
          action: 'story_inspect',
        }),
      );
    const key = request.requestId ?? randomUUID();
    const identity = request.requestId ? digest(request) : undefined;
    const previous = s.receipts.get(key);
    if (previous)
      return previous.digest === identity
        ? previous.promise
        : Promise.reject(new Error('requestId already belongs to a different command.'));
    if (!s.renderer || this.expired(s))
      return Promise.reject(
        failure('view_closed', 'Open the scene before controlling it.', { action: 'story_open' }),
      );
    if (!s.ready && !['suspend', 'resume', 'inspect'].includes(request.op))
      return Promise.reject(
        new Error('The view is still opening. Wait for it before controlling the scene.'),
      );
    if (s.handoff && !['suspend', 'resume'].includes(request.op))
      return Promise.reject(
        new Error('The scene is moving to another view. Inspect after it opens.'),
      );
    if (!pauseOnly && request.buildRevision && request.buildRevision !== s.build.revision)
      return Promise.reject(
        failure('build_conflict', 'The shown build changed. Inspect the scene again.', {
          field: 'buildRevision',
          current: { buildRevision: s.build.revision },
          action: 'story_inspect',
        }),
      );
    if (
      !pauseOnly &&
      request.stateRevision !== undefined &&
      request.stateRevision !== s.stateRevision
    )
      return Promise.reject(
        failure(
          'state_conflict',
          'The user changed the scene. Inspect the latest state before controlling it.',
          {
            field: 'stateRevision',
            current: { stateRevision: s.stateRevision },
            action: 'story_inspect',
          },
        ),
      );
    this.expirePending(s);
    if (s.pending.size >= 32)
      return Promise.reject(new Error('Too many pending commands. Wait for the current action.'));
    const expiresAt = Date.now() + this.timeout;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.expirePending(s), this.timeout);
      s.pending.set(key, { resolve, reject, timer, generation: s.generation, expiresAt });
      s.queue.push({ ...request, id: key, generation: s.generation, expiresAt });
      s.wake?.();
    });
    // Explicit IDs remain idempotent for the session, including after handoff and timeouts.
    // Reads and internal lifecycle requests need no historical receipt.
    if (request.requestId) s.receipts.set(key, { digest: identity, promise });
    return promise;
  }

  expirePending(s) {
    const now = Date.now();
    for (const [id, pending] of s.pending) {
      if (pending.expiresAt > now) continue;
      clearTimeout(pending.timer);
      s.pending.delete(id);
      s.queue = s.queue.filter((command) => command.id !== id);
      pending.reject(failure('command_expired', commandExpired, { action: 'story_inspect' }));
    }
  }

  detach({ sessionId, renderer, generation }) {
    const s = this.get(sessionId);
    if (s.renderer !== renderer || s.generation !== generation) return false;
    clearTimeout(s.replacement?.timer);
    s.replacement = undefined;
    s.handoff = false;
    s.renderer = null;
    s.ready = false;
    this.rejectPending(s, 'View closed before confirming the command.');
    s.wake?.();
    return true;
  }

  rejectPending(s, message) {
    for (const pending of s.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    s.pending.clear();
    s.queue = [];
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const s of this.sessions.values()) {
      clearTimeout(s.replacement?.timer);
      s.renderer = null;
      s.ready = false;
      this.rejectPending(s, 'Server closed.');
      s.wake?.();
      s.receipts.clear();
    }
    this.sessions.clear();
  }
}
