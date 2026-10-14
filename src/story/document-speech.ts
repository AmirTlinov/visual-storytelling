import type { AuthoredBeat, AuthoredChapter, StoryDocument } from './document-schema.js';
import { spoken } from './document-beat.js';
import { sameSpeechValue } from './speech-condition.js';
import { validateSpeechConditions } from './speech-condition.js';
import { keys, record } from './document-fields.js';
import type { StoryModel, StoryModules } from './model.js';

/** Normalization freezes the source dependency once, before a voice is selected or cached. */
export function authoredSpeech(
  beat: AuthoredBeat,
  chapter: string,
  models: readonly StoryModel[],
  modules: StoryModules,
  path: string,
): AuthoredBeat['speech'] {
  if (!spoken(beat)) {
    if (beat.speech !== undefined)
      throw new Error(`${path}.speech: silent actions have no recording.`);
    return;
  }
  if (beat.speech === undefined)
    return {
      id: `voice.${chapter}.${beat.id}`,
      when: {
        basis: 'authored',
        models: models.map((model) => ({ model: model.id, inputs: structuredClone(model.inputs) })),
      },
    };
  const speech = record(beat.speech, `${path}.speech`);
  keys(speech, ['id', 'when', 'seed', 'delivery'], `${path}.speech`);
  if (typeof speech.id !== 'string' || !/^[a-z][a-z0-9_.-]{0,255}$/.test(speech.id))
    throw new Error(`${path}.speech.id: use a stable whole-thought ID.`);
  const when = validateSpeechConditions(speech.when, `${path}.speech.when`);
  for (const condition of when.models) {
    const model = models.find((model) => model.id === condition.model);
    if (!model) throw new Error(`${path}.speech.when: reference declared models.`);
    if (Object.keys(condition.inputs).some((key) => !Object.hasOwn(model.inputs, key)))
      throw new Error(`${path}.speech.when.inputs: reference registered inputs.`);
    const valid = modules[model.module]!.validateInputs({ ...model.inputs, ...condition.inputs });
    condition.inputs = Object.fromEntries(
      Object.keys(condition.inputs).map((key) => [key, valid[key]]),
    );
  }
  if (
    speech.seed !== undefined &&
    (!Number.isInteger(speech.seed) ||
      (speech.seed as number) < 0 ||
      (speech.seed as number) >= 2 ** 32)
  )
    throw new Error(`${path}.speech.seed: use a 32-bit Higgs take seed.`);
  if (
    speech.delivery !== undefined &&
    (typeof speech.delivery !== 'string' || speech.delivery.length > 4000)
  )
    throw new Error(`${path}.speech.delivery: use native Higgs controls.`);
  return {
    id: speech.id,
    when,
    ...(speech.seed !== undefined && { seed: speech.seed as number }),
    ...(speech.delivery !== undefined && { delivery: speech.delivery as string }),
  };
}

/** Group only an explicit accepted whole-take ID, never a chapter or incidental word run. */
export function speechUnits(chapter: AuthoredChapter) {
  const units: {
    id: string;
    beats: AuthoredBeat[];
    conditions: NonNullable<AuthoredBeat['speech']>['when'];
    voice: Pick<NonNullable<AuthoredBeat['speech']>, 'seed' | 'delivery'>;
  }[] = [];
  let unit: (typeof units)[number] | undefined;
  for (const beat of chapter.beats) {
    if (!spoken(beat)) unit = undefined;
    else {
      if (!beat.speech)
        throw new Error(`Speech needs a stable whole-thought ID: ${chapter.id}.${beat.id}`);
      if (unit?.id !== beat.speech.id) {
        if (units.some((unit) => unit.id === beat.speech!.id))
          throw new Error(`Speech unit ${beat.speech.id} must remain contiguous.`);
        unit = {
          id: beat.speech.id,
          beats: [],
          conditions: beat.speech.when,
          voice: {
            ...(beat.speech.seed !== undefined && { seed: beat.speech.seed }),
            ...(beat.speech.delivery !== undefined && { delivery: beat.speech.delivery }),
          },
        };
        units.push(unit);
      }
      if (!sameSpeechValue(unit.conditions, beat.speech.when))
        throw new Error(`Speech unit ${unit.id} needs one complete condition.`);
      if (unit.voice.seed !== beat.speech.seed || unit.voice.delivery !== beat.speech.delivery)
        throw new Error(`Speech unit ${unit.id} needs one complete voice selection.`);
      unit.beats.push(beat);
    }
  }
  return units;
}

export function validateDocumentSpeech(document: Pick<StoryDocument, 'chapters'>) {
  const ids = new Set<string>();
  const actions = new Set(
    document.chapters.flatMap((chapter) => chapter.beats.map((beat) => `${chapter.id}.${beat.id}`)),
  );
  for (const chapter of document.chapters)
    for (const unit of speechUnits(chapter)) {
      if (ids.has(unit.id) || actions.has(unit.id))
        throw new Error(`Speech unit ID is duplicated or reserved for an action: ${unit.id}`);
      ids.add(unit.id);
    }
}
