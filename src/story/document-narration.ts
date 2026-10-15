import type { CueTiming } from './cues.js';
import { spokenWords } from './spoken-words.js';
import {
  validateStoryDocument,
  type StoryDocument,
  type StoryDocumentOptions,
} from './document-schema.js';
import { spoken, intention, occupied, timingFor } from './document-beat.js';
import { speechUnits } from './document-speech.js';
import type { SpeechConditions } from './speech-condition.js';
/** Feed the existing cached speech/alignment owner, without empty or invented spoken segments. */
export function documentNarration(document: StoryDocument, options: StoryDocumentOptions = {}) {
  document = validateStoryDocument(document, options);
  const ids = new Set(
    document.chapters.flatMap((chapter) => [
      chapter.id,
      ...chapter.beats.map((beat) => `${chapter.id}.${beat.id}`),
    ]),
  );
  const spec = document.narration ?? {};
  let intro = spec.intro ?? 0;
  const spokenIds = new Set(
    document.chapters.flatMap((chapter) =>
      chapter.beats.filter((beat) => spoken(beat)).map((beat) => `${chapter.id}.${beat.id}`),
    ),
  );
  const segments: {
    id: string;
    title?: string;
    text: string;
    conditions: SpeechConditions;
    seed?: number;
    delivery?: string;
    pause_after: number;
    cues: {
      id: string;
      quote: string;
      occurrence: number;
      action?: string;
      hold?: string;
      timing?: CueTiming;
    }[];
  }[] = [];
  let actionReserve = 0;
  const pause = (seconds: number) => {
    const previous = segments.at(-1);
    if (previous) previous.pause_after += seconds;
    else intro += seconds;
  };
  for (const chapter of document.chapters) {
    const units = speechUnits(chapter);
    for (const beat of chapter.beats) {
      if (!spoken(beat)) {
        // Speech duration is not known until alignment. Reserving each unit's longest
        // action after its clip guarantees that the following silent action fits.
        pause(actionReserve + occupied(beat, `${chapter.id}.${beat.id}`));
        actionReserve = 0;
        continue;
      }
      const unit = units.find((unit) => unit.beats[0] === beat);
      if (!unit) continue;
      if (unit.id !== chapter.id && ids.has(unit.id))
        throw new Error(`Beat ID is reserved for narration: ${unit.id}`);
      const tokens = unit.beats.flatMap((beat) => spokenWords(spoken(beat)));
      let wordStart = 0;
      const cues = unit.beats.map((beat) => {
        const quote = spokenWords(spoken(beat));
        let occurrence = quote.length ? 0 : 1;
        for (let start = 0; quote.length && start <= wordStart; start++)
          if (quote.every((word, index) => tokens[start + index] === word)) occurrence++;
        wordStart += quote.length;
        const timing = timingFor(chapter, beat);
        // The speech assembler only knows spoken IDs. The document resolves an action
        // ending at a silent beat after its real acoustic anchors have been loaded.
        const acousticTiming = timing?.until && !spokenIds.has(timing.until) ? undefined : timing;
        return {
          id: `${chapter.id}.${beat.id}`,
          quote: spoken(beat),
          occurrence,
          ...intention(beat),
          ...(acousticTiming !== undefined ? { timing: acousticTiming } : {}),
        };
      });
      segments.push({
        id: unit.id,
        ...(unit === units[0] && { title: chapter.title }),
        text: unit.beats.map(spoken).join(' '),
        conditions: structuredClone(unit.conditions),
        ...unit.voice,
        pause_after: 0,
        cues,
      });
      actionReserve = Math.max(
        0,
        ...unit.beats.map((beat) =>
          beat.timing && 'duration' in beat.timing
            ? (beat.timing.delay ?? 0) + beat.timing.duration!
            : 0,
        ),
      );
    }
    if (units.length) {
      pause(actionReserve + (spec.pause ?? 0.6));
      actionReserve = 0;
    }
  }
  return {
    version: 3,
    voice: { ...(spec.voice ?? { seed: 42 }) },
    intro,
    outro: spec.outro ?? 0.6,
    music: spec.music ? structuredClone(spec.music) : null,
    ...(spec.captionAliases ? { captionAliases: { ...spec.captionAliases } } : {}),
    segments,
  };
}
