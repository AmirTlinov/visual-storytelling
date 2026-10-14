import {
  SceneStory,
  type SceneChapter,
  type SceneStoryOptions,
  type ChapterFrame,
  type ChapterPresentation,
} from './composition.js';
import type { Script } from './cues.js';
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
import { storyModelOwners } from '../recipes/story-models.js';
import type { ModelValues } from './model.js';

export interface IllustratedChapterFrame extends ChapterFrame {
  subject: ReturnType<typeof documentModelsAt>;
}
export interface IllustratedChapter extends Omit<SceneChapter, 'mount' | 'valuesAt'> {
  mount(
    parent: HTMLElement,
    signal: AbortSignal,
  ):
    | (Omit<ChapterPresentation, 'render'> & { render(frame: IllustratedChapterFrame): void })
    | Promise<
        Omit<ChapterPresentation, 'render'> & { render(frame: IllustratedChapterFrame): void }
      >;
}

export interface IllustratedStoryOptions
  extends Omit<SceneStoryOptions, 'title' | 'chapters' | 'subjectAt' | 'sharedControls'> {
  document: StoryDocument | unknown;
  modules?: StoryModules;
  subjects?: StorySubjects;
  /** Generated narration declares its aligned timing with data-story-timeline. Explicit script wins. */
  audio?: HTMLAudioElement | null;
  /** Each authored chapter selects a presentation owned by its subject. */
  chapters?: Readonly<
    Record<string, (chapter: ReturnType<typeof documentChapter>) => IllustratedChapter>
  >;
}

async function narrationScript(
  audio: HTMLAudioElement | null | undefined,
): Promise<Script | undefined> {
  if (!audio || audio.dataset.silent === 'true') return;
  const resource = audio.dataset.storyTimeline;
  if (!resource) return;
  const response = await fetch(new URL(resource, audio.baseURI));
  if (!response.ok) throw new Error(`Could not load narration timing: ${response.status}`);
  return response.json();
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
  const script = options.script ?? (await narrationScript(options.audio));
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
    if (chapter.seconds !== authored.seconds)
      throw new Error(`Chapter ${id}: presentation changed its authored duration.`);
    if (document.models.length && 'valuesAt' in chapter && typeof chapter.valuesAt === 'function')
      throw new Error(`Chapter ${id}: document operations already own model inputs.`);
    const start = timeline.cues[id]!.start;
    return {
      id: chapter.id,
      title: chapter.title,
      text: chapter.text,
      seconds: chapter.seconds,
      get presentation() {
        return chapter.presentation;
      },
      get controls() {
        return chapter.controls;
      },
      script: authored.script,
      mount(parent: HTMLElement, signal: AbortSignal) {
        return chapter.mount(parent, signal) as ChapterPresentation | Promise<ChapterPresentation>;
      },
      valuesAt(frame: ChapterFrame) {
        if (!document.models.length) return (chapter as SceneChapter).valuesAt?.(frame) ?? {};
        const state = documentModelsAt(document, sheet.at(start + frame.time), {}, modules, {
          chapter: id,
        }).models;
        return Object.fromEntries(
          document.models.flatMap((model) =>
            Object.entries(
              storyModelOwners(modules)[model.module]!.validateInputs(
                Object.fromEntries(
                  Object.keys(model.inputs).map((key) => [key, state[model.id]![key]]),
                ),
              ),
            ).map(([key, value]) => [
              authoredInputKeys(document, model.id, { [key]: model.inputs[key] })[0]!,
              value,
            ]),
          ),
        );
      },
    };
  });
  return SceneStory.mount(parent, {
    ...presentation,
    resources: document.resources,
    title: document.title ?? 'Рассказ',
    chapters,
    script: aligned,
    sharedControls: document.models.flatMap((model) =>
      authoredInputKeys(document, model.id, model.inputs),
    ),
    subjectAt(frame) {
      const start = timeline.cues[frame.chapter]!.start;
      const values: Record<string, ModelValues> = Object.fromEntries(
        document.models.map((model) => [
          model.id,
          Object.fromEntries(
            Object.entries(model.inputs).map(([key, value]) => [
              key,
              frame.values[authoredInputKeys(document, model.id, { [key]: value })[0]!] ?? value,
            ]),
          ),
        ]),
      );
      return documentModelsAt(
        document,
        sheet.at(start + frame.time),
        frame.mode === 'story' ? {} : values,
        modules,
        {
          mode: frame.mode,
          chapter: frame.chapter,
        },
      );
    },
  });
}
export const IllustratedStory = { mount };
