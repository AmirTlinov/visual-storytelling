/** A complete recorded thought. Time is supplied by the presented Story moment. */
export interface SpeechSpan {
  id: string;
  start: number;
  end: number;
  /** First spoken sample/word; the preceding accepted head pause is safe to enter. */
  spokenStart?: number;
}
export interface SpeechObservation {
  time: number;
  unit?: SpeechSpan;
  applicable: boolean;
  /** Next complete take closes the output even while the UI thread is stalled. */
  nextStart?: number;
  /** Output processing can reject a stale head observation after a slow renderer. */
  canEnter?: boolean;
}
export interface SpeechAudibility {
  unit?: string;
  applicable: boolean;
  audible: boolean;
}

/** Audibility only; there is no media, timer, model state or user mute here. */
export function speechGate() {
  let blocked: string | undefined;
  let previousUnit: string | undefined;
  let interrupted = true;
  let state: SpeechAudibility = { applicable: false, audible: false };
  return {
    get state() {
      return state;
    },
    interrupt() {
      interrupted = true;
    },
    observe({ time, unit, applicable, canEnter = true }: SpeechObservation): SpeechAudibility {
      if (
        !Number.isFinite(time) ||
        time < 0 ||
        (unit &&
          (!unit.id ||
            !Number.isFinite(unit.start) ||
            !Number.isFinite(unit.end) ||
            unit.start < 0 ||
            unit.end <= unit.start ||
            (unit.spokenStart !== undefined &&
              (!Number.isFinite(unit.spokenStart) ||
                unit.spokenStart < unit.start ||
                unit.spokenStart >= unit.end))))
      )
        throw new Error('Speech audibility needs a finite presented time and complete unit.');
      if (unit) {
        const beforeSpeech =
          canEnter && time >= unit.start && time <= (unit.spokenStart ?? unit.start) + 1e-6;
        if (
          !applicable ||
          (interrupted && !beforeSpeech) ||
          (unit.id !== previousUnit && !beforeSpeech)
        )
          blocked = unit.id;
        else if (beforeSpeech) blocked = undefined;
      }
      state = {
        ...(unit && { unit: unit.id }),
        applicable: !unit || applicable,
        // A mixed track keeps its authored gaps/music. An invalid whole take mutes the mix.
        audible: !unit || (applicable && blocked !== unit.id),
      };
      previousUnit = unit?.id;
      interrupted = false;
      return state;
    },
  };
}
