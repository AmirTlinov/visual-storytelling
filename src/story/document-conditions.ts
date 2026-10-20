import type { StoryDocument, AuthoredBeat } from './document-schema.js';
import type { SpeechConditions } from './speech-condition.js';
import { speechConditionsMatch } from './speech-condition.js';
import type { Chapter } from './cues.js';
import { speechUnits } from './document-speech.js';
import { spoken } from './document-beat.js';
import { spokenText } from './spoken-words.js';

/** A thought's meaning applies to both its visible wording and optional voice. */
export function documentConditionsApplicable(
  document: StoryDocument,
  conditions: SpeechConditions,
  mode: 'story' | 'explore',
  presentedModels: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
) {
  if (conditions.basis === 'authored')
    return (
      mode === 'story' &&
      speechConditionsMatch(
        conditions,
        Object.fromEntries(document.models.map((model) => [model.id, model.inputs])),
      )
    );
  return speechConditionsMatch(conditions, presentedModels);
}

/** Resolve current wording, including a pending caption lent the clock of an older take. */
export function documentCaptionConditions(document: StoryDocument, unit: Chapter) {
  const normalized = (text: string) => spokenText(text).replace(/\s+/g, ' ').trim();
  for (const chapter of document.chapters) {
    const action = chapter.beats.find((beat) => `${chapter.id}.${beat.id}` === unit.id);
    const thought = speechUnits(chapter).find((thought) => thought.id === unit.id);
    const beats = action ? [action] : thought?.beats;
    if (
      beats &&
      normalized(unit.displayText ?? unit.text) === normalized(beats.map(spoken).join(' '))
    )
      return action?.speech?.when ?? thought?.conditions;
  }
}

export function documentCaptionApplicable(
  document: StoryDocument,
  unit: Chapter,
  mode: 'story' | 'explore',
  presentedModels: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
) {
  const conditions = documentCaptionConditions(document, unit);
  return !!conditions && documentConditionsApplicable(document, conditions, mode, presentedModels);
}

/** Project wording without changing the authored beat, operations, timing or computed model. */
export function applicableDocumentBeat(
  document: StoryDocument,
  beat: AuthoredBeat | undefined,
  mode: 'story' | 'explore',
  presentedModels: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
) {
  if (!beat?.text) return beat;
  const applicable = beat.speech
    ? documentConditionsApplicable(document, beat.speech.when, mode, presentedModels)
    : mode === 'story';
  if (applicable) return beat;
  const { text: _text, ...action } = beat;
  return action;
}
