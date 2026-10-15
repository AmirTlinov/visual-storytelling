import { cueSheet, type Frame, type Script, type Chapter } from './cues.js';
import { transport } from './transport.js';
import { resolveMedia } from './media.js';
import type { SceneSubject } from '../scene-checkpoint.js';
import { recordedSpeechAt, nextRecordedSpeechStart } from './recorded-speech.js';

export type StoryMode = 'story' | 'explore';
/** Portable input schema for experiments that cannot be represented by flat controls. */
export interface StoryCheckpoint<P> {
  encode(values: P): unknown;
  /** Validate the saved schema and return fresh inputs. Derived state is recomputed. */
  decode(value: unknown): P;
}
/** One accepted condition, with the model derived from precisely those inputs and time. */
export interface StoryMoment<P, S = P> {
  readonly time: number;
  readonly mode: StoryMode;
  readonly values: P;
  readonly state: S;
  readonly chapter?: string;
}
export interface StoryError {
  readonly stage: 'stateAt' | 'derive' | 'canContinue' | 'prepare' | 'render' | 'speech';
  readonly cause: unknown;
}
export interface StoryStatus<P, S = P> {
  readonly requested: StoryMoment<P, S>;
  readonly presented: StoryMoment<P, S> | undefined;
  readonly phase: 'preparing' | 'ready' | 'failed';
  readonly error: StoryError | undefined;
}
export type StoryOptions<P, K extends string, S = P> = {
  script: Script<K>;
  audio?: HTMLAudioElement | null;
  stateAt(frame: Frame<K>): P;
  /** Project time-derived input fields while retaining the accepted experiment. */
  resolveTime?(values: Readonly<P>, frame: Frame<K>): P;
  /** Play and seek retain experimental inputs. Story mode and chapter selection restore authored values. */
  exploreTimeline?: boolean;
  /** Resolve an explicit user edit before accepting its complete condition and time. */
  resolveInput?(
    patch: Readonly<Partial<P>>,
    current: StoryMoment<P, NoInfer<S>>,
    frame: Frame<K>,
    intent: 'input' | 'restore',
  ): { values: P; time?: number; playback?: 'pause' };
  /** Resolve a selected chapter at a shared time boundary from the accepted condition. */
  chapterAt?(moment: StoryMoment<P, NoInfer<S>>): string | undefined;
  checkpoint?: StoryCheckpoint<P>;
  /** Evaluate a complete take against the frame that was actually published. */
  speechApplicable?(unit: Chapter, moment: StoryMoment<P, NoInfer<S>>): boolean;
  /** Caption meaning is checked against the completed frame, independently of voice readiness. */
  captionApplicable?(unit: Chapter, moment: StoryMoment<P, NoInfer<S>>): boolean;
  /** The subject owns the attempt. True releases an awaitInput cue, including a wrong but checked answer.
   * A thrown error pauses playback and retains the last completed frame; Play retries the check. */
  canContinue?(cue: K, moment: StoryMoment<P, NoInfer<S>>): boolean;
  /** Prepare resources without changing the visible frame. Honour cancellation before effects. */
  prepare?(
    state: NoInfer<S>,
    frame: Frame<K>,
    mode: StoryMode,
    signal: AbortSignal,
  ): void | Promise<void>;
  /** A successful synchronous return confirms the presented moment. */
  render(state: NoInfer<S>, frame: Frame<K>, mode: StoryMode): void;
} & (
  | {
      /** Validate and derive the model before accepting input or changing narrative time. */
      derive(values: P, frame: Frame<K>, mode: StoryMode): S;
    }
  | ([P] extends [S] ? { derive?: undefined } : never)
);
export function story<P, K extends string, S = P>(options: StoryOptions<P, K, S>) {
  const sheet = cueSheet(options.script);
  const chapters = sheet.script.segments
    ?.filter((chapter) => chapter.title)
    .toSorted((a, b) => a.start - b.start);
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let disposed = false;
  const assertLive = () => {
    if (disposed) throw new Error('Story has been disposed');
  };
  type Request = { moment: StoryMoment<P, S>; frame: Frame<K> };
  let requested: Request;
  let presented: StoryMoment<P, S> | undefined;
  let phase: StoryStatus<P, S>['phase'] = 'preparing';
  let error: StoryError | undefined;
  const player = transport({
    duration: options.script.duration,
    audio: options.audio ? resolveMedia(options.audio, options.script.duration) : undefined,
    speech: true,
  });
  let forcedReduced: boolean | undefined;
  let changing = false;
  const listeners = new Set<(status: StoryStatus<P, S>) => void>();
  const seeks = new Set<(time: number) => void>();
  let preparation:
    | {
        request: Request;
        controller: AbortController;
        done: Promise<void>;
        resolve(): void;
      }
    | undefined;
  const status = (): StoryStatus<P, S> => ({
    requested: requested.moment,
    presented,
    phase,
    error,
  });
  function notify() {
    const next = status();
    for (const listener of listeners) listener(next);
  }
  function cancelPreparation() {
    const previous = preparation;
    preparation = undefined;
    previous?.controller.abort();
    previous?.resolve();
  }
  async function ready() {
    assertLive();
    while (preparation) {
      const pending = preparation;
      try {
        await pending.done;
      } catch (cause) {
        // A failure that has already been superseded does not reject the newer request.
        if (requested === pending.request) throw cause;
      }
      if (disposed) return;
    }
    if (error) throw error.cause;
  }
  function compute(values: P, frame: Frame<K>, mode: StoryMode): Request {
    const state = options.derive ? options.derive(values, frame, mode) : (values as unknown as S);
    const moment: StoryMoment<P, S> = { values, state, time: frame.time, mode };
    const chapter =
      options.chapterAt?.(moment) ??
      chapters?.findLast((chapter) => chapter.start <= frame.time)?.id;
    return { moment: Object.freeze({ ...moment, chapter }), frame };
  }
  function fail(stage: StoryError['stage'], cause: unknown) {
    phase = 'failed';
    error = { stage, cause };
    // An arbitrary renderer may have changed part of the DOM before throwing.
    if (stage === 'render') presented = undefined;
    const previous = changing;
    changing = true;
    try {
      cancelPreparation();
      player.fail(cause);
    } finally {
      changing = previous;
    }
    if (requested) notify();
  }
  function evaluate<T>(stage: StoryError['stage'], work: () => T): T {
    try {
      return work();
    } catch (cause) {
      fail(stage, cause);
      throw cause;
    }
  }
  function requestAt(frame: Frame<K>, mode: StoryMode): Request {
    const values = valuesAtTime(frame, mode);
    return evaluate('derive', () => compute(values, frame, mode));
  }
  function valuesAtTime(frame: Frame<K>, mode: StoryMode, explicit = false): P {
    return evaluate('stateAt', () =>
      mode === 'story'
        ? options.stateAt(frame)
        : options.resolveTime &&
            (explicit || frame.time !== requested.moment.time || player.state.playing)
          ? options.resolveTime(requested.moment.values, frame)
          : requested.moment.values,
    );
  }
  function canContinue(id: K, moment: StoryMoment<P, S>) {
    return evaluate('canContinue', () => options.canContinue?.(id, moment) ?? false);
  }
  function pauseForInput() {
    const previous = changing;
    changing = true;
    try {
      player.pause();
    } finally {
      changing = previous;
    }
  }
  function draw(next: Request) {
    if (disposed || requested !== next) return;
    try {
      options.render(next.moment.state, next.frame, next.moment.mode);
    } catch (cause) {
      if (requested === next) fail('render', cause);
      throw cause;
    }
    if (disposed || requested !== next) return;
    presented = next.moment;
    phase = 'ready';
    error = undefined;
    const unit = recordedSpeechAt(sheet.script, presented.time);
    evaluate('speech', () =>
      player.presentSpeech({
        unit,
        time: presented!.time,
        nextStart: nextRecordedSpeechStart(sheet.script, presented!.time),
        applicable:
          !unit || (options.speechApplicable?.(unit, presented!) ?? presented!.mode === 'story'),
      }),
    );
    notify();
  }
  function publish(next: Request) {
    cancelPreparation();
    requested = next;
    phase = 'preparing';
    error = undefined;
    if (!options.prepare) return draw(next);
    const controller = new AbortController();
    let prepared: void | Promise<void>;
    try {
      prepared = options.prepare(
        next.moment.state,
        next.frame,
        next.moment.mode,
        controller.signal,
      );
    } catch (cause) {
      controller.abort();
      fail('prepare', cause);
      throw cause;
    }
    if (!prepared) return draw(next);
    let resolve!: () => void, reject!: (cause: unknown) => void;
    const done = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const pending = (preparation = { request: next, controller, done, resolve });
    // Holding the media clock can synchronously notify its status, without a new frame.
    const previous = changing;
    changing = true;
    try {
      player.prepare(done);
    } finally {
      changing = previous;
    }
    notify();
    void prepared.then(
      () => {
        if (controller.signal.aborted || disposed || requested !== next) return resolve();
        try {
          draw(next);
          if (preparation === pending) preparation = undefined;
          resolve();
        } catch (cause) {
          if (preparation === pending) preparation = undefined;
          reject(cause);
        }
      },
      (cause) => {
        if (controller.signal.aborted || disposed || requested !== next) return resolve();
        if (preparation === pending) preparation = undefined;
        fail('prepare', cause);
        reject(cause);
      },
    );
  }
  function update() {
    if (disposed || changing || error) return;
    let time = player.state.time;
    if (requested && player.state.playing) {
      const stop = Object.entries(sheet.script.cues)
        .map(([id, cue]) => ({ id: id as K, cue: cue as Script<K>['cues'][K] }))
        .filter(
          ({ cue }) => cue.awaitInput && cue.start >= requested.moment.time && cue.start <= time,
        )
        .sort((a, b) => a.cue.start - b.cue.start)
        .find(({ id, cue }) => {
          const at = sheet.at(cue.start, forcedReduced ?? media.matches);
          return !canContinue(id, requestAt(at, requested.moment.mode).moment);
        });
      if (stop) {
        time = stop.cue.start;
        changing = true;
        try {
          player.pause();
          player.seek(time);
        } finally {
          changing = false;
        }
      }
    }
    const frame = sheet.at(time, forcedReduced ?? media.matches);
    const mode = requested?.moment.mode ?? 'story';
    // A resize while loading needs the eventual render at the latest viewport, not another load.
    if (
      preparation &&
      requested.frame.time === frame.time &&
      requested.frame.reduced === frame.reduced
    )
      return;
    publish(requestAt(frame, mode));
  }
  // Media commands can synchronously emit several events. Accept one complete request.
  function change(command: () => void, next: Request) {
    const previous = changing;
    changing = true;
    try {
      command();
    } finally {
      changing = previous;
    }
    publish(next);
  }
  function restorePosition(next: Request) {
    change(() => {
      for (const listener of seeks) listener(next.frame.time);
      player.pause();
      player.seek(next.frame.time);
    }, next);
  }
  let unsubscribe: () => void;
  function waiting() {
    // A failed check is retried by Play, not by error/status observers reading this getter.
    if (!requested || error) return undefined;
    return (Object.keys(sheet.script.cues) as K[]).find((id) => {
      const cue = sheet.script.cues[id];
      return (
        cue.awaitInput &&
        requested.moment.time >= cue.start &&
        requested.moment.time < cue.end &&
        !canContinue(id, requested.moment)
      );
    });
  }
  try {
    unsubscribe = player.subscribe((playback, mediaFrame) => {
      if (disposed || changing) return;
      try {
        if (error && playback.playing) {
          const stage = error.stage;
          error = undefined;
          if (waiting()) {
            pauseForInput();
            publish(requested);
          } else if (stage === 'prepare' || stage === 'render') publish(requested);
          else update();
          return;
        }
        if (playback.playing && waiting()) {
          pauseForInput();
          return;
        }
        if (mediaFrame) update();
      } catch (cause) {
        // Model failures already paused the clock and published their error. Native
        // media events and RAF callbacks must not leak them as uncaught exceptions.
        // Construction still rejects when there is no accepted initial condition.
        if (!unsubscribe || error?.cause !== cause) throw cause;
      }
    });
  } catch (cause) {
    cancelPreparation();
    player.dispose();
    throw cause;
  }
  const updateMotionPreference = () => {
    try {
      update();
    } catch (cause) {
      if (error?.cause !== cause) throw cause;
    }
  };
  media.addEventListener('change', updateMotionPreference);
  return {
    player,
    /** Transfer a prepared controller to the live recording only after its drawing was published. */
    prepareAudio(audio: HTMLAudioElement, settings?: { muted?: boolean }) {
      assertLive();
      return player.prepareAudio(resolveMedia(audio, options.script.duration), settings);
    },
    sheet,
    review: sheet.review,
    pause: player.pause,
    duration: options.script.duration,
    exploreTimeline: options.exploreTimeline === true,
    ready,
    subject:
      options.checkpoint &&
      ({
        capture({ basis = 'presented' }) {
          const moment = basis === 'requested' ? requested.moment : presented;
          if (!moment)
            throw Object.assign(new Error('The story has no completed frame to capture.'), {
              code: 'scene_not_presented',
            });
          return options.checkpoint!.encode(moment.values);
        },
        restore(value, { time, mode }) {
          assertLive();
          if (!Number.isFinite(time) || !['story', 'explore'].includes(mode))
            throw new Error('Invalid subject checkpoint position');
          const target = Math.max(0, Math.min(options.script.duration, time));
          const frame = sheet.at(target, forcedReduced ?? media.matches);
          const values =
            mode === 'story' ? options.stateAt(frame) : options.checkpoint!.decode(value);
          const next = compute(values, frame, mode);
          restorePosition(next);
        },
      } satisfies SceneSubject),
    get currentTime() {
      return player.state.time;
    },
    get currentChapter() {
      return requested.moment.chapter;
    },
    /** Pending subject action; remains derived from the accepted condition and cue. */
    get waiting() {
      return waiting();
    },
    update,
    get requested() {
      return requested.moment;
    },
    /** Stable identity of the full accepted condition, including subject-only inputs. */
    get condition(): object {
      return requested.moment;
    },
    get presented() {
      return presented;
    },
    captionApplicable(unit: Chapter) {
      return (
        !!presented && (options.captionApplicable?.(unit, presented) ?? presented.mode === 'story')
      );
    },
    get phase() {
      return phase;
    },
    get error() {
      return error;
    },
    /** Restore flat inputs and their position as one accepted condition, before preparation. */
    restoreInputs(patch: Partial<P>, position: { time: number; mode: StoryMode }) {
      assertLive();
      if (!Number.isFinite(position.time) || !['story', 'explore'].includes(position.mode))
        throw new Error('Invalid story input position');
      const time = Math.max(0, Math.min(options.script.duration, position.time));
      const frame = sheet.at(time, forcedReduced ?? media.matches);
      const authored = options.stateAt(frame);
      if (position.mode === 'story') return restorePosition(compute(authored, frame, 'story'));
      const resolved = options.resolveInput
        ? options.resolveInput(patch, compute(authored, frame, 'story').moment, frame, 'restore')
        : { values: { ...authored, ...patch } };
      // A restored position is already an accepted observation. Input resolution
      // still normalizes its values, but a new-input transition cannot move it.
      restorePosition(compute(resolved.values, frame, 'explore'));
    },
    /** Apply only the supplied fields; the subject resolves transitions before publication. */
    input(patch: Partial<P>) {
      assertLive();
      const resolved = options.resolveInput?.(
        patch,
        requested.moment,
        requested.frame,
        'input',
      ) ?? {
        values: { ...requested.moment.values, ...patch },
      };
      const time = resolved.time ?? requested.moment.time;
      if (!Number.isFinite(time)) throw new Error('Story time must be finite');
      const target = Math.max(0, Math.min(options.script.duration, time));
      const next = compute(
        resolved.values,
        sheet.at(target, forcedReduced ?? media.matches),
        'explore',
      );
      const retainPlayback =
        resolved.playback !== 'pause' &&
        Boolean(options.exploreTimeline || (options.speechApplicable && player.state.hasAudio)) &&
        player.state.playing;
      const previousTime = requested.moment.time;
      change(() => {
        if (!retainPlayback) player.pause();
        // The last displayed frame can lag native media by one frame. A model edit
        // at that same moment must not seek backwards through a spoken phrase.
        if (retainPlayback ? target !== previousTime : player.state.time !== target)
          player.seek(target);
      }, next);
    },
    explore(values: P) {
      assertLive();
      const next = compute(
        values,
        sheet.at(player.state.time, forcedReduced ?? media.matches),
        'explore',
      );
      change(player.pause, next);
    },
    resume() {
      assertLive();
      if (waiting()) return;
      const frame = sheet.at(player.state.time, forcedReduced ?? media.matches);
      publish(compute(options.stateAt(frame), frame, 'story'));
    },
    /** Select time in the active experiment, or explicitly restore an authored story moment. */
    seek(time: number, position?: { mode: StoryMode }) {
      assertLive();
      if (!Number.isFinite(time)) throw new Error('Story time must be finite');
      const mode = position?.mode ?? (options.exploreTimeline ? requested.moment.mode : 'story');
      if (mode !== 'story' && mode !== 'explore') throw new Error('Invalid story mode');
      const target = Math.max(0, Math.min(options.script.duration, time));
      const frame = sheet.at(target, forcedReduced ?? media.matches);
      const next = compute(valuesAtTime(frame, mode, true), frame, mode);
      change(() => {
        for (const listener of seeks) listener(target);
        player.seek(target);
      }, next);
    },
    setReduced(value?: boolean) {
      assertLive();
      const frame = sheet.at(player.state.time, value ?? media.matches);
      const mode = requested.moment.mode;
      const next = compute(valuesAtTime(frame, mode), frame, mode);
      forcedReduced = value;
      publish(next);
    },
    subscribe(listener: (status: StoryStatus<P, S>) => void) {
      assertLive();
      listeners.add(listener);
      listener(status());
      return () => listeners.delete(listener);
    },
    onSeek(listener: (time: number) => void) {
      assertLive();
      seeks.add(listener);
      return () => seeks.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelPreparation();
      unsubscribe();
      player.dispose();
      media.removeEventListener('change', updateMotionPreference);
      listeners.clear();
      seeks.clear();
    },
  };
}
export type Story<P, K extends string = string, S = P> = ReturnType<typeof story<P, K, S>>;
