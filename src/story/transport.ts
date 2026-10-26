import { SilentMedia } from './media.js';
import { mediaTimeline, type MediaClock } from './clock.js';
import { sceneHost } from '../host/adapter.js';
import { speechGate, type SpeechObservation, type SpeechAudibility } from './speech-gate.js';
import { mediaAudibility, prepareMediaAudibility } from './media-audibility.js';
export interface Playback {
  time: number;
  duration: number;
  playing: boolean;
  muted: boolean;
  hasAudio: boolean;
  rate: number;
  error: string | null;
  speech?: SpeechAudibility;
}
export interface TransportOptions {
  duration: number;
  audio?: MediaClock;
  /** The Story owner publishes applicability after its completed frame. */
  speech?: boolean;
}
/** Commands and subscriptions over the single media clock used by narrated scenes. */
export function transport({ duration, audio, speech = false }: TransportOptions) {
  if (!(duration > 0) || !Number.isFinite(duration))
    throw new Error('Playback duration must be positive');
  let media = audio ?? new SilentMedia(duration);
  const listeners = new Set<(state: Playback, mediaFrame: boolean) => void>(),
    abort = new AbortController();
  let bindingMedia = false,
    pending = false,
    disposed = false,
    request = 0,
    error: string | null = null;
  let permission: AbortController | undefined;
  let unmutePermission: AbortController | undefined;
  let preparation: Promise<void> | undefined;
  let resumePrepared = false;
  const audibility = speech ? speechGate() : undefined;
  let output = !(media instanceof SilentMedia) && audibility ? mediaAudibility(media) : undefined;
  let userMuted = media.muted;
  let observedSpeech: SpeechObservation | undefined;
  let speechAudible = !audibility;
  const applyAudibility = () => {
    media.muted = audibility ? userMuted || !speechAudible : userMuted;
    output?.present(!userMuted && speechAudible, observedSpeech?.nextStart);
  };
  applyAudibility();
  function observeSpeech(observation: SpeechObservation) {
    observedSpeech = observation;
    if (!audibility || media instanceof SilentMedia || disposed) return;
    if (output?.expired(observation.nextStart)) audibility.interrupt();
    speechAudible = audibility.observe({
      ...observation,
      ...(observation.unit && output && { canEnter: output.canEnter(observation.unit) }),
    }).audible;
    applyAudibility();
  }
  const state = (): Playback => ({
    time: clock.time,
    duration,
    playing: pending || resumePrepared || !media.paused,
    muted: userMuted,
    hasAudio: !(media instanceof SilentMedia),
    rate: media.playbackRate ?? 1,
    error,
    ...(!(media instanceof SilentMedia) && audibility && { speech: audibility.state }),
  });
  const notify = (mediaFrame = false) => {
    if (bindingMedia) return;
    if (mediaFrame) output?.sample();
    for (const listener of listeners) listener(state(), mediaFrame);
  };
  let clock = mediaTimeline(media, duration, notify);
  function pause() {
    if (disposed) return;
    request++;
    permission?.abort();
    permission = undefined;
    unmutePermission?.abort();
    pending = false;
    resumePrepared = false;
    media.pause();
    output?.pause();
    clock.update('state');
  }
  function fail(cause: unknown) {
    pause();
    error = cause instanceof Error ? cause.message : String(cause);
    notify();
  }
  function seek(time: number) {
    if (disposed) throw new Error('Playback has been disposed');
    if (!Number.isFinite(time)) throw new Error('Seek time must be finite');
    if (audibility) {
      audibility.interrupt();
      speechAudible = false;
      applyAudibility();
    }
    clock.seek(time);
  }
  async function play() {
    if (disposed || pending || resumePrepared || !media.paused) return;
    if (media.currentTime >= duration - 0.02) seek(0);
    const token = ++request;
    error = null;
    pending = true;
    notify();
    try {
      permission?.abort();
      const approval = (permission = new AbortController());
      await sceneHost()?.beforePlay?.({
        muted: userMuted,
        hasAudio: !(media instanceof SilentMedia),
        signal: approval.signal,
      });
      if (disposed || token !== request || approval.signal.aborted) return;
      while (preparation) {
        await preparation;
        if (disposed || token !== request || approval.signal.aborted) return;
      }
      await startMedia(token);
    } catch (cause) {
      if (disposed || token !== request) return;
      pending = false;
      error = cause instanceof Error ? cause.message : String(cause);
      notify();
      throw cause;
    }
  }
  async function startMedia(token: number) {
    if (disposed || token !== request) return;
    if (output) await output.resume();
    if (disposed || token !== request) return;
    output?.synchronize();
    applyAudibility();
    await media.play();
    if (disposed || token !== request) return;
    pending = false;
    clock.update('state');
  }
  function prepare(task: Promise<void>) {
    if (disposed) return;
    error = null;
    preparation = task;
    resumePrepared ||= !media.paused;
    if (!media.paused) {
      media.pause();
      output?.pause();
    } else notify();
    void task.then(
      () => {
        if (disposed || preparation !== task) return;
        preparation = undefined;
        const resume = resumePrepared;
        resumePrepared = false;
        if (resume) {
          const token = request;
          void startMedia(token).catch((cause) => {
            if (disposed || token !== request) return;
            fail(cause);
          });
        } else notify();
      },
      (cause) => {
        if (disposed || preparation !== task) return;
        preparation = undefined;
        fail(cause);
      },
    );
  }
  function bindAudio(audio: MediaClock) {
    audio.addEventListener(
      'error',
      () => {
        fail(new Error('Не удалось загрузить звук'));
      },
      { signal: abort.signal },
    );
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (
          'duration' in audio &&
          typeof audio.duration === 'number' &&
          Math.abs(audio.duration - duration) > 0.25
        ) {
          error = 'Длительность звука и меток различается';
          notify();
        }
      },
      { signal: abort.signal },
    );
    audio.addEventListener('volumechange', () => notify(), { signal: abort.signal });
  }
  if (audio) bindAudio(audio);
  globalThis.document?.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) pause();
    },
    { signal: abort.signal },
  );
  return {
    get state() {
      return state();
    },
    play,
    prepare,
    fail,
    pause,
    seek,
    /** Prepared candidates use a silent clock. The accepted controller adopts this one media owner. */
    prepareAudio(next: MediaClock, settings: { muted?: boolean } = {}) {
      if (disposed) throw new Error('Playback has been disposed');
      if (!(media instanceof SilentMedia) || !media.paused)
        throw new Error('Only a paused prepared controller can adopt recorded audio.');
      const staged = audibility && prepareMediaAudibility(next, { replace: true });
      return {
        cancel() {
          staged?.cancel();
        },
        commit() {
          if (disposed) throw new Error('Playback has been disposed');
          const nextOutput = staged?.activate();
          const time = clock.time,
            rate = media.playbackRate ?? 1;
          const previousMedia = media;
          const recorded = { time: next.currentTime, muted: next.muted, rate: next.playbackRate };
          bindingMedia = true;
          try {
            clock.dispose();
            media.pause();
            media = next;
            output = nextOutput;
            userMuted = settings.muted ?? next.muted;
            speechAudible = false;
            audibility?.interrupt();
            applyAudibility();
            media.pause();
            if (media.playbackRate !== undefined) media.playbackRate = rate;
            bindAudio(media);
            clock = mediaTimeline(media, duration, notify);
            clock.seek(time);
            if (observedSpeech) observeSpeech(observedSpeech);
          } catch (cause) {
            nextOutput?.rollback();
            clock.dispose();
            media = previousMedia;
            output = undefined;
            userMuted = previousMedia.muted;
            speechAudible = false;
            const errors = [cause];
            for (const restore of [
              () => {
                next.currentTime = recorded.time;
              },
              () => {
                next.muted = recorded.muted;
              },
              () => {
                if (recorded.rate !== undefined) next.playbackRate = recorded.rate;
              },
            ])
              try {
                restore();
              } catch (error) {
                errors.push(error);
              }
            clock = mediaTimeline(media, duration, notify);
            clock.seek(time);
            if (errors.length > 1)
              throw new AggregateError(
                errors,
                'Recorded media transfer could not be fully restored.',
              );
            throw cause;
          } finally {
            bindingMedia = false;
          }
          notify();
        },
      };
    },
    presentSpeech(observation: SpeechObservation) {
      observeSpeech(observation);
    },
    toggle() {
      return pending || resumePrepared || !media.paused ? pause() : play();
    },
    async mute(value = !userMuted) {
      if (disposed) throw new Error('Playback has been disposed');
      unmutePermission?.abort();
      if (!value && userMuted && !media.paused) {
        const token = request,
          approval = new AbortController();
        unmutePermission = approval;
        try {
          await sceneHost()?.beforePlay?.({
            muted: false,
            hasAudio: !(media instanceof SilentMedia),
            signal: approval.signal,
          });
        } catch (cause) {
          if (approval.signal.aborted) return;
          error = cause instanceof Error ? cause.message : String(cause);
          notify();
          throw cause;
        }
        if (disposed || token !== request || approval.signal.aborted) return;
      }
      if (value !== userMuted && audibility) {
        audibility.interrupt();
        if (observedSpeech) observeSpeech(observedSpeech);
      }
      userMuted = value;
      applyAudibility();
      notify();
    },
    rate(value: number) {
      if (!Number.isFinite(value) || value < 0.25 || value > 3)
        throw new Error('Playback rate must be between 0.25 and 3');
      if (media.playbackRate === undefined)
        throw new Error('This media does not support playback rate');
      media.playbackRate = value;
      output?.synchronize();
      applyAudibility();
      notify();
    },
    subscribe(listener: (state: Playback, mediaFrame: boolean) => void) {
      listeners.add(listener);
      listener(state(), true);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      request++;
      permission?.abort();
      unmutePermission?.abort();
      pending = false;
      resumePrepared = false;
      preparation = undefined;
      clock.dispose();
      output?.dispose();
      abort.abort();
      listeners.clear();
      media.pause();
    },
  };
}
export type Transport = ReturnType<typeof transport>;
