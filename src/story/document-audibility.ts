import type { StoryDocument } from './document-schema.js';
import type { Chapter, Script } from './cues.js';
import type { StoryMode } from './story.js';
import type { ModelValues } from './model.js';
import { speechUnits } from './document-speech.js';
import { sameSpeechValue, speechConditionsMatch } from './speech-condition.js';
import { spokenText, spokenWords, spokenSpan } from './spoken-words.js';
import { spoken } from './document-beat.js';

/** Accepted take metadata is compared to the actual source and the completed model frame. */
export function documentSpeechDeclared(document: StoryDocument, unit: Chapter) {
  const authored = document.chapters.flatMap(speechUnits).find((thought) => thought.id === unit.id);
  if (
    !authored ||
    !unit.conditions ||
    !sameSpeechValue(unit.conditions, authored.conditions) ||
    spokenText(unit.text) !== spokenText(authored.beats.map(spoken).join(' ')) ||
    (unit.source_text ?? unit.text).trim().replace(/\s+/g, ' ') !==
      authored.beats.map(spoken).join(' ').trim().replace(/\s+/g, ' ') ||
    ((unit.source_seed ?? unit.seed) !== undefined &&
      (unit.source_seed ?? unit.seed) !==
        (authored.voice.seed ?? document.narration?.voice?.seed ?? 42)) ||
    (unit.delivery !== undefined &&
      unit.delivery !== (authored.voice.delivery ?? document.narration?.voice?.delivery ?? ''))
  )
    return false;
  return true;
}

export function documentSpeechApplicable(
  document: StoryDocument,
  unit: Chapter,
  mode: StoryMode,
  presentedModels: Readonly<Record<string, ModelValues>>,
) {
  if (!documentSpeechDeclared(document, unit)) return false;
  if (!unit.conditions) return false;
  if (unit.conditions.basis === 'authored') {
    if (mode !== 'story') return false;
    return speechConditionsMatch(
      unit.conditions,
      Object.fromEntries(document.models.map((model) => [model.id, model.inputs])),
    );
  }
  return speechConditionsMatch(unit.conditions, presentedModels);
}

/** Repartition an unchanged whole take using its measured words, without inventing word times. */
export function documentSpeechSpans(document: StoryDocument, recorded: Chapter) {
  if (!recorded.words || !documentSpeechDeclared(document, recorded)) return;
  const unit = document.chapters.flatMap(speechUnits).find((unit) => unit.id === recorded.id)!;
  const expected = unit.beats.flatMap((beat) => spokenWords(spoken(beat)));
  const measured = recorded.words.flatMap((word) => spokenWords(word.text));
  if (!sameSpeechValue(expected, measured)) return;
  let offset = 0;
  const spans = [];
  for (const beat of unit.beats) {
    const chapter = document.chapters.find((chapter) => chapter.beats.includes(beat))!;
    const length = spokenWords(spoken(beat)).length;
    const span = spokenSpan(recorded.words, offset, length);
    if (!span) return;
    offset += length;
    spans.push({ id: `${chapter.id}.${beat.id}`, ...span });
  }
  return spans;
}

/** A quiet source edit may retain a take while repartitioning its visual actions. */
export function documentSpeechAnchorsCurrent(document: StoryDocument, script: Script) {
  const units = document.chapters.flatMap(speechUnits);
  if (
    !sameSpeechValue(
      units.map((unit) => unit.id),
      (script.segments ?? []).map((unit) => unit.id),
    )
  )
    return false;
  for (const unit of units) {
    const recorded = script.segments?.find((segment) => segment.id === unit.id);
    const spans = recorded && documentSpeechSpans(document, recorded);
    if (!spans) return false;
    for (const expected of spans) {
      const cue = script.cues[expected.id];
      const actual = cue?.speech ?? cue;
      if (
        !actual ||
        Math.abs(actual.start - expected.start) > 1e-6 ||
        Math.abs(actual.end - expected.end) > 1e-6
      )
        return false;
    }
  }
  return true;
}

/** Inventory whole takes without synthesizing or assigning readiness to individual words. */
export function documentSpeechPreparation(document: StoryDocument, recording?: Script) {
  return document.chapters.flatMap(speechUnits).map((unit) => {
    const recorded = recording?.segments?.find((segment) => segment.id === unit.id);
    return {
      id: unit.id,
      text: unit.beats.map(spoken).join(' '),
      status:
        recorded && documentSpeechDeclared(document, recorded)
          ? ('ready' as const)
          : ('pending' as const),
    };
  });
}
