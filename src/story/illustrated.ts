import {
  SceneStory,
  type SceneChapter,
  type SceneStoryOptions,
  type ChapterFrame,
} from './composition.js';
import {
  documentChapter,
  documentNarration,
  documentScript,
  type StoryDocument,
  validateStoryDocument,
  authoredInputKeys,
  type StoryModules,
} from './document.js';
import { mountIllustratedSubject } from './illustrated-subject.js';
import { documentModelsAt, documentTimeline } from './document-model.js';
import { cueSheet } from './cues.js';
import type { StorySubjects } from './subject.js';
import { hasStorySpeech, storyNarrationScript, validateStoryNarration } from './document-media.js';

export interface IllustratedStoryOptions extends Omit<SceneStoryOptions, 'title' | 'chapters'> {
  document: StoryDocument | unknown;
  modules?: StoryModules;
  subjects?: StorySubjects;
  /** Generated narration declares its aligned timing with data-story-timeline. Explicit script wins. */
  audio?: HTMLAudioElement | null;
  /** Each authored chapter selects a presentation owned by its subject. */
  chapters?: Readonly<
    Record<string, (chapter: ReturnType<typeof documentChapter>) => SceneChapter>
  >;
}

/** One document supplies narration and quiet timing to ordinary SceneStory chapters. */
async function mount(parent: HTMLElement, options: IllustratedStoryOptions) {
  const {
    chapters: factories,
    modules,
    subjects: _subjects,
    document: source,
    ...presentation
  } = options;
  const document = validateStoryDocument(source, { modules });
  documentNarration(document, { modules });
  const speech = hasStorySpeech(document);
  const script = options.script ?? (speech ? await storyNarrationScript(options.audio) : undefined);
  if (speech && options.audio && options.audio.dataset.silent !== 'true' && script)
    validateStoryNarration(document, script, undefined, { modules });
  if (!factories) return mountIllustratedSubject(parent, document, options, script);
  if (!document.chapters.length)
    throw new Error('A static prepared subject does not need chapter factories.');
  const aligned = script && documentScript(document, script, { modules });
  const timeline = documentTimeline(document, script, { modules })!;
  const sheet = cueSheet(timeline);
  const chapters = document.chapters.map(({ id }) => {
    const factory = factories[id];
    if (!factory) throw new Error(`Chapter ${id} needs a presentation`);
    const authored = documentChapter(document, id, aligned, { modules });
    const chapter = factory(authored);
    if (chapter.id !== id) throw new Error(`Chapter presentation changed its authored ID: ${id}`);
    if (!document.models.length) return chapter;
    if (chapter.valuesAt)
      throw new Error(`Chapter ${id}: document operations already own model inputs.`);
    const start = timeline.cues[id]!.start;
    return {
      ...chapter,
      valuesAt(frame: ChapterFrame) {
        const state = documentModelsAt(document, sheet.at(start + frame.time), {}, modules).models;
        return Object.fromEntries(
          document.models.flatMap((model) =>
            Object.keys(model.inputs).map((key) => [
              authoredInputKeys(document, model.id, { [key]: model.inputs[key] })[0]!,
              state[model.id]![key]!,
            ]),
          ),
        );
      },
    };
  });
  return SceneStory.mount(parent, {
    ...presentation,
    audio: speech ? options.audio : undefined,
    title: document.title ?? 'Рассказ',
    chapters,
    script: aligned,
  });
}
export const IllustratedStory = { mount };
