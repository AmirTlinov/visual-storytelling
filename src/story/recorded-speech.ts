import type { Chapter, Script } from './cues.js';
import { validateSpeechConditions } from './speech-condition.js';

/** One projection for semantic, word and complete-take boundaries. */
export function mapRecordedSpeech(
  unit: Chapter,
  map: (time: number, edge: 'start' | 'end') => number,
): Chapter {
  const span = (value: { start: number; end: number }) => ({
    start: map(value.start, 'start'),
    end: map(value.end, 'end'),
  });
  return {
    ...unit,
    ...span(unit),
    ...(unit.speech && { speech: span(unit.speech) }),
    ...(unit.audio_start !== undefined && { audio_start: map(unit.audio_start, 'start') }),
    ...(unit.audio_end !== undefined && { audio_end: map(unit.audio_end, 'end') }),
    ...(unit.words && { words: unit.words.map((word) => ({ ...word, ...span(word) })) }),
  };
}

/** Malformed recordings must fail before playback; they can never become a music gap. */
export function validateRecordedSpeech(script: Script) {
  const ids = new Set<string>();
  let previousEnd = 0;
  for (const unit of script.segments ?? []) {
    const complete = unit.audio_start !== undefined || unit.audio_end !== undefined;
    const start = unit.audio_start ?? unit.start;
    const end = unit.audio_end ?? unit.end;
    if (
      typeof unit.id !== 'string' ||
      !unit.id.trim() ||
      ids.has(unit.id) ||
      !Number.isFinite(unit.start) ||
      !Number.isFinite(unit.end) ||
      unit.start < 0 ||
      unit.end < unit.start ||
      unit.end > script.duration + 0.01 ||
      (complete && (unit.audio_start === undefined || unit.audio_end === undefined)) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      (complete && end === start) ||
      end > script.duration + 0.01 ||
      start > unit.start + 1e-6 ||
      end < unit.end - 1e-6
    )
      throw new Error(`Invalid recorded speech: ${unit.id}`);
    if (start < previousEnd - 1e-6)
      throw new Error(`Recorded speech ${unit.id} overlaps the preceding action or recording`);
    ids.add(unit.id);
    if (unit.conditions !== undefined)
      validateSpeechConditions(unit.conditions, `Recording ${unit.id}`);
    previousEnd = end;
    let wordEnd = unit.start;
    for (const word of unit.words ?? []) {
      if (
        typeof word.text !== 'string' ||
        !word.text.trim() ||
        !Number.isFinite(word.start) ||
        !Number.isFinite(word.end) ||
        word.start < wordEnd - 1e-6 ||
        word.end < word.start ||
        word.end > unit.end + 1e-6
      )
        throw new Error(`Invalid recorded word: ${unit.id}`);
      wordEnd = word.end;
    }
  }
}

/** Recorded segments already declare whole takes; no chapters or word runs are regrouped. */
export function recordedSpeechAt(
  script: Script,
  time: number,
): (Chapter & { spokenStart?: number }) | undefined {
  if (!script.segments?.length)
    return { id: 'recording', start: 0, end: script.duration, text: '' };
  const take = script.segments.find(
    (unit) => time >= (unit.audio_start ?? unit.start) && time < (unit.audio_end ?? unit.end),
  );
  return (
    take && {
      ...take,
      spokenStart: take.words?.[0]?.start ?? take.start,
      start: take.audio_start ?? take.start,
      end: take.audio_end ?? take.end,
    }
  );
}

export function nextRecordedSpeechStart(script: Script, time: number): number | undefined {
  const unit = script.segments?.find((unit) => (unit.audio_start ?? unit.start) > time);
  return unit && (unit.audio_start ?? unit.start);
}
