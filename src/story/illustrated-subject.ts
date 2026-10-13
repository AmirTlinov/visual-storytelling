import { releaseResources } from '../lifecycle.js';
import { SceneShell } from '../scene.js';
import { story, type Story } from './story.js';
import { documentModelsAt } from './document-model.js';
import { prepareIllustratedDocument } from './document-subject.js';
import { validateStoryDocument, type StoryDocument } from './document-schema.js';
import type { ModelValues } from './model.js';
import type { IllustratedStoryOptions } from './illustrated.js';
import type { Script } from './cues.js';
import { cloneAudio } from './media.js';
import { hasStorySpeech, storyNarrationScript, validateStoryNarration } from './document-media.js';

type SubjectMoment = ReturnType<typeof documentModelsAt>;
/** Compile a prepared drawing to the same shell and Story used by handwritten JS scenes. */
export async function mountIllustratedSubject(
  root: HTMLElement,
  initial: StoryDocument,
  options: IllustratedStoryOptions,
  aligned?: Script,
) {
  const { model, recipe, module } = prepareIllustratedDocument(initial, options, aligned);
  let document = initial;
  let mounted = false;
  let narrationLoaded = Boolean(aligned);
  let acceptedAudio = options.audio;
  let preparedNarration: StoryDocument | undefined;
  await SceneShell.ready();
  let controller: Story<ModelValues, string, SubjectMoment> | undefined;
  let latest: SubjectMoment | undefined;
  const shell = SceneShell.mount(root, {
    title: initial.title ?? recipe.title,
    heading: initial.title !== undefined,
    parameters: recipe.parameters(model),
    frame: options.frame,
    captions: options.captions,
    onInput(values) {
      if (controller) return;
      const next = documentModelsAt(
        document,
        undefined,
        { [document.models[0]!.id]: values },
        options.modules,
      );
      drawing.validate(document.models[0]!, document.views, values, []);
      drawing.render(document.models[0]!, document.views, next.models[document.models[0]!.id]!);
      latest = next;
    },
  });
  const handle = root.scene!;
  if (options.theme) handle.setTheme!(options.theme);
  let drawing: ReturnType<typeof recipe.create>;
  try {
    drawing = recipe.create(shell, model);
  } catch (error) {
    releaseResources(
      [
        () => {
          throw error;
        },
        () => shell.dispose(),
      ],
      'Story document mount failed.',
    );
    throw error;
  }
  shell.onDispose(drawing.dispose);
  function prepare(source: unknown, provisional = false, authoredInputs: readonly string[] = []) {
    const canonical = validateStoryDocument(source, { modules: options.modules });
    const timing = options.script ?? (hasStorySpeech(canonical) ? aligned : undefined);
    const { document: next, script } = prepareIllustratedDocument(canonical, options, timing);
    const narrated =
      hasStorySpeech(next) && options.audio && options.audio.dataset.silent !== 'true' && timing;
    if (narrated) validateStoryNarration(next, timing!, preparedNarration, options);
    const nextModel = next.models[0];
    if (
      next.models.length !== 1 ||
      !nextModel ||
      nextModel.module !== model.module ||
      (!provisional && nextModel.id !== document.models[0]!.id)
    )
      throw new Error('Retain the prepared subject identity while editing this document.');
    if (
      !Array.isArray(authoredInputs) ||
      authoredInputs.some((key) => !Object.hasOwn(model.inputs, key))
    )
      throw new Error('authoredInputs: choose registered model inputs.');
    const previous = controller?.presented;
    const current = previous?.values ?? shell.parameters;
    const values = module.validateInputs(
      Object.fromEntries(
        Object.entries(nextModel.inputs).map(([key, value]) => [
          key,
          !authoredInputs.includes(key) && value === document.models[0]!.inputs[key]
            ? current[key]
            : value,
        ]),
      ),
    );
    drawing.validate(
      nextModel,
      next.views,
      values,
      next.chapters.flatMap((chapter) => chapter.beats),
    );
    return { next, values, previous, script, narrated };
  }
  async function replace(
    source: unknown,
    {
      signal,
      provisional = false,
      authoredInputs,
    }: {
      signal?: AbortSignal;
      provisional?: boolean;
      authoredInputs?: readonly string[];
    } = {},
  ) {
    signal?.throwIfAborted();
    const canonical = prepareIllustratedDocument(source, options).document;
    if (hasStorySpeech(canonical) && !narrationLoaded) {
      aligned = await storyNarrationScript(options.audio);
      narrationLoaded = true;
      signal?.throwIfAborted();
    }
    const { next, values, previous, script, narrated } = prepare(
      canonical,
      provisional,
      authoredInputs,
    );
    const nextModel = next.models[0]!;
    let cleanupError: unknown;
    const render = (moment: SubjectMoment) => {
      drawing.render(nextModel, next.views, moment.models[nextModel.id]!, moment.beat);
      latest = moment;
    };
    if (!script) {
      const moment = documentModelsAt(next, undefined, { [nextModel.id]: values }, options.modules);
      render(moment);
      try {
        shell.detachController();
      } catch (error) {
        cleanupError = error;
      }
      controller = undefined;
      shell.syncParameters(values);
      document = next;
    } else {
      let active = false,
        prepared: SubjectMoment | undefined;
      const audioSource = hasStorySpeech(next) ? acceptedAudio : undefined;
      const ownedAudio =
        mounted && audioSource && audioSource.dataset.silent !== 'true'
          ? cloneAudio(audioSource)
          : undefined;
      const candidate = story<ModelValues, string, SubjectMoment>({
        script,
        audio: ownedAudio ?? audioSource,
        exploreTimeline: true,
        stateAt() {
          return { ...nextModel.inputs };
        },
        derive(values, frame) {
          const valid = module.validateInputs(values);
          return documentModelsAt(next, frame, { [nextModel.id]: valid }, options.modules);
        },
        resolveInput(patch, current) {
          return {
            values: module.validateInputs({ ...current.values, ...patch }),
            time: recipe.inputTime?.(next, script) ?? current.time,
          };
        },
        render(moment) {
          if (active) render(moment);
          else prepared = moment;
        },
      });
      try {
        if (previous)
          candidate.restoreInputs(values, {
            time: Math.min(previous.time, script.duration),
            mode: previous.mode,
          });
        else if (controller === undefined && document !== initial)
          candidate.restoreInputs(values, {
            time: recipe.inputTime?.(next, script) ?? 0,
            mode: 'explore',
          });
        await candidate.ready();
        signal?.throwIfAborted();
        if (previous) {
          const latest = prepare(next, provisional, authoredInputs);
          candidate.restoreInputs(latest.values, {
            time: Math.min(controller!.currentTime, script.duration),
            mode: latest.previous!.mode,
          });
        }
        if (ownedAudio && audioSource) {
          ownedAudio.muted = audioSource.muted;
          ownedAudio.volume = audioSource.volume;
          ownedAudio.playbackRate = audioSource.playbackRate;
        }
        if (!prepared) throw new Error('Document has no prepared model frame.');
        render(prepared);
        shell.attachController(candidate);
        controller = candidate;
        if (ownedAudio) acceptedAudio = ownedAudio;
        document = next;
        active = true;
      } catch (error) {
        releaseResources(
          [
            () => {
              throw error;
            },
            () => candidate.dispose(),
          ],
          'Story document preparation failed.',
        );
        throw error;
      }
    }
    mounted = true;
    if (narrated && !preparedNarration) preparedNarration = next;
    shell.setTitle(next.title ?? recipe.title, { visible: next.title !== undefined });
    handle.extend({
      snapshot: () => latest && drawing.snapshot(latest.models[document.models[0]!.id]!),
    });
    if (cleanupError)
      root.dispatchEvent(
        new CustomEvent('scene-playback-error', { bubbles: true, detail: cleanupError }),
      );
  }
  const resize = () => {
    if (controller || !latest) return;
    drawing.render(
      document.models[0]!,
      document.views,
      latest.models[document.models[0]!.id]!,
      latest.beat,
    );
  };
  const observer = new ResizeObserver(resize);
  observer.observe(shell.stage);
  root.addEventListener('scene-frame-resize', resize);
  shell.onDispose(() => {
    observer.disconnect();
    root.removeEventListener('scene-frame-resize', resize);
  });
  try {
    await replace(initial);
    handle.extend({
      authoring: {
        get document() {
          return structuredClone(document);
        },
        validate(source: unknown, settings) {
          prepare(source, false, settings?.authoredInputs);
        },
        replace,
      },
    });
    return {
      shell,
      scene: handle,
      get story() {
        return controller;
      },
    };
  } catch (error) {
    releaseResources(
      [
        () => {
          throw error;
        },
        () => shell.dispose(),
      ],
      'Story document mount failed.',
    );
    throw error;
  }
}
