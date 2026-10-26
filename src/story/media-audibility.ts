import type { MediaClock } from './clock.js';
import type { SpeechSpan } from './speech-gate.js';

/** Output processing only. HTML media remains the sole narrative clock. */
const contexts = new WeakMap<Document, { context: AudioContext; leases: number }>();
const outputs = new WeakMap<
  HTMLAudioElement,
  {
    shared: { context: AudioContext; leases: number };
    source: MediaElementAudioSourceNode;
    gain: GainNode;
    owner?: symbol;
  }
>();

/** Prepare the fallible native graph without touching the accepted output owner. */
export function prepareMediaAudibility(media: MediaClock, { replace = false } = {}) {
  if (!(media instanceof HTMLAudioElement)) return;
  if (typeof AudioContext === 'undefined')
    throw new Error('Recorded speech needs Web Audio output gating.');
  let output = outputs.get(media);
  if (!output) {
    let shared = contexts.get(media.ownerDocument);
    if (!shared) {
      const context = new AudioContext();
      shared = { context, leases: 0 };
      contexts.set(media.ownerDocument, shared);
      media.ownerDocument.defaultView?.addEventListener('pagehide', (event) => {
        if (!event.persisted) void context.close();
      });
    }
    const gain = shared.context.createGain();
    gain.gain.value = 0;
    const source = shared.context.createMediaElementSource(media);
    // A media element can have only one source node. Retain it for a retry after connect fails.
    output = { source, gain, shared };
    outputs.set(media, output);
  }
  const owned = output;
  if (owned.owner && !replace) throw new Error('Recorded media already has a live output owner.');
  const disconnectIdle = () => {
    if (owned.owner) return;
    owned.source.disconnect();
    owned.gain.disconnect();
  };
  try {
    // Native connections are idempotent. An accepted lease remains intact during this preflight.
    owned.source.connect(owned.gain);
    owned.gain.connect(owned.shared.context.destination);
  } catch (cause) {
    disconnectIdle();
    throw cause;
  }
  let committed = false;
  return {
    cancel: disconnectIdle,
    activate() {
      if (committed) throw new Error('Audio output preparation was already committed.');
      committed = true;
      const token = Symbol('media output');
      const previousOwner = owned.owner;
      if (!owned.owner) owned.shared.leases++;
      owned.owner = token;
      let anchor: { media: number; output: number; rate: number } | undefined;
      let needsSample = false;
      const context = owned.shared.context;
      const sample = () => {
        const time = media.currentTime;
        // Within one long JS task, native currentTime may remain the old readback.
        // Keep its prior output fence until media supplies a genuinely newer observation.
        if (!anchor || media.paused || time !== anchor.media) {
          anchor = { media: time, output: context.currentTime, rate: media.playbackRate ?? 1 };
          needsSample = false;
        }
      };
      const outputTime = (time: number) => {
        sample();
        return anchor!.output + (time - anchor!.media) / anchor!.rate;
      };
      return {
        rollback() {
          if (owned.owner !== token) return;
          this.pause();
          owned.owner = previousOwner;
          if (!previousOwner) {
            disconnectIdle();
            if (!--owned.shared.leases) void context.suspend();
          }
        },
        sample,
        synchronize() {
          if (
            anchor &&
            !media.paused &&
            media.currentTime === anchor.media &&
            context.currentTime > anchor.output
          ) {
            needsSample = true;
            return;
          }
          anchor = {
            media: media.currentTime,
            output: context.currentTime,
            rate: media.playbackRate ?? 1,
          };
          needsSample = false;
        },
        canEnter(unit: SpeechSpan) {
          const time = outputTime(unit.spokenStart ?? unit.start);
          return !needsSample && context.currentTime <= time + 1e-6;
        },
        expired(nextStart?: number) {
          const deadline = nextStart === undefined ? undefined : outputTime(nextStart);
          return needsSample || (deadline !== undefined && context.currentTime >= deadline);
        },
        async resume() {
          if (owned.owner === token) await context.resume();
        },
        present(audible: boolean, nextStart?: number) {
          if (owned.owner !== token) return;
          const now = context.currentTime,
            gain = owned.gain.gain;
          gain.cancelScheduledValues(now);
          const deadline = nextStart === undefined ? undefined : outputTime(nextStart);
          gain.setValueAtTime(
            Number(audible && !needsSample && (deadline === undefined || deadline > now)),
            now,
          );
          if (audible && !needsSample && deadline !== undefined && deadline > now)
            gain.setValueAtTime(0, deadline);
        },
        pause() {
          if (owned.owner !== token) return;
          owned.gain.gain.cancelScheduledValues(context.currentTime);
          owned.gain.gain.setValueAtTime(0, context.currentTime);
        },
        dispose() {
          if (owned.owner !== token) return;
          this.pause();
          owned.owner = undefined;
          disconnectIdle();
          if (!--owned.shared.leases) void context.suspend();
        },
      };
    },
  };
}

export function mediaAudibility(media: MediaClock) {
  return prepareMediaAudibility(media)?.activate();
}
