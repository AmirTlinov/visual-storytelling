import { compileScore } from '../characters/score.js';
import { Storybook } from './storybook.js';
import {
  authoredChapter,
  documentScript,
  documentNarration,
  type StoryDocument,
} from './document.js';
import { inkChapter } from '../story/ink-chapter.js';
import type { CharacterSurface } from '../characters/surfaces.js';
import type { CharacterStageOptions } from '../characters/types.js';
import type { SceneStoryOptions } from '../story/composition.js';
import type { Script } from '../story/cues.js';

export interface IllustratedDocument extends StoryDocument {
  chapters: readonly (StoryDocument['chapters'][number] & {
    view: 'cast' | 'paper';
    drawing: string;
    surface?: string;
  })[];
}
export interface IllustratedStoryOptions {
  document: IllustratedDocument;
  world: Pick<CharacterStageOptions, 'pack' | 'set' | 'cast'>;
  drawings: Readonly<Record<string, CharacterSurface & { controls?: readonly string[] }>>;
  parameters?: SceneStoryOptions['parameters'];
  script?: Script;
  audio?: HTMLAudioElement | null;
}
/** A supplied world and drawings turn one authored document into a narrated, explorable book. */
async function mount(parent: HTMLElement, options: IllustratedStoryOptions) {
  const { document, world, drawings } = options;
  documentNarration(document); // Same author contract before rendering and before speech synthesis.
  const aligned = options.script && documentScript(document, options.script);
  const chapters = document.chapters.map((chapter) => {
    const content = drawings[chapter.drawing];
    if (!content) throw new Error(`Chapter ${chapter.id}: unknown drawing ${chapter.drawing}`);
    const authored = authoredChapter(document, chapter.id);
    const span = aligned?.cues[chapter.id];
    const offset = aligned?.segments?.find((segment) => segment.id === chapter.id)?.start ?? 0;
    let local: Script | undefined = span && {
      duration: span.end - offset,
      cues: Object.fromEntries(
        chapter.beats.map((beat) => {
          const cue = aligned!.cues[`${chapter.id}.${beat.id}`];
          if (!cue) throw new Error(`Missing spoken action ${chapter.id}.${beat.id}`);
          return [beat.id, { ...cue, start: cue.start - offset, end: cue.end - offset }];
        }),
      ),
    };
    if (!local) {
      const natural =
        chapter.view === 'cast' ? compileScore({ ...world, ...authored }).script : undefined;
      let time = 0;
      local = { duration: 0, cues: {}, segments: [] };
      for (const beat of chapter.beats) {
        const cue = natural?.cues[beat.id];
        const seconds =
          beat.seconds ??
          Math.max(cue ? cue.end - cue.start : 0, 2.5, beat.say.split(/\s+/).length / 2.5 + 0.6);
        const span = { start: time, end: time + seconds };
        local.cues[beat.id] = { ...span, action: beat.text };
        (local.segments as unknown[]).push({
          id: beat.id,
          ...span,
          text: beat.say,
          title: beat.title ?? beat.text,
        });
        time += seconds;
      }
      local.duration = time;
    }
    if (chapter.view === 'cast')
      return {
        ...authored,
        set: world.set,
        cast: world.cast,
        script: local,
        surfaces: { [chapter.surface ?? 'board']: content },
        controls: content.controls,
        valuesAt: content.valuesAt,
      };
    return inkChapter({ ...content, ...authored, seconds: local.duration, script: local });
  });
  return Storybook.mount(parent, {
    topic: document.title,
    pack: world.pack,
    chapters,
    parameters: options.parameters,
    script: aligned,
    audio: options.audio,
  });
}
export const IllustratedStory = { mount };
