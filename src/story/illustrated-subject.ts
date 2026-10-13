import { releaseResources } from '../lifecycle.js';
import { SceneShell } from '../scene.js';
import { story, type Story } from './story.js';
import { documentModelsAt } from './document-model.js';
import { prepareIllustratedDocument } from './document-subject.js';
import type { StoryDocument } from './document-schema.js';
import type { ModelValues } from './model.js';
import type { IllustratedStoryOptions } from './illustrated.js';
import type { Script } from './cues.js';
import { editStoryDocument, authoredInputKeys, type StoryDocumentOperation } from './document.js';
import { modelInputValues } from './model.js';

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
    const { document: next, script } = prepareIllustratedDocument(
      source,
      options,
      !mounted ? aligned : undefined,
    );
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
    return { next, values, previous, script };
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
    const { next, values, previous, script } = prepare(source, provisional, authoredInputs);
    const nextModel = next.models[0]!;
    const render = (moment: SubjectMoment) => {
      drawing.render(nextModel, next.views, moment.models[nextModel.id]!, moment.beat);
      latest = moment;
    };
    if (!script) {
      const moment = documentModelsAt(next, undefined, { [nextModel.id]: values }, options.modules);
      render(moment);
      shell.detachController();
      controller = undefined;
      shell.syncParameters(values);
      document = next;
    } else {
      let active = false,
        prepared: SubjectMoment | undefined;
      const candidate = story<ModelValues, string, SubjectMoment>({
        script,
        audio: options.audio,
        exploreTimeline: true,
        stateAt(frame) {
          return modelInputValues(
            nextModel,
            documentModelsAt(next, frame, {}, options.modules).models[nextModel.id]!,
            module,
          );
        },
        derive(values, frame, mode) {
          const valid = module.validateInputs(values);
          return documentModelsAt(
            next,
            frame,
            mode === 'story' ? {} : { [nextModel.id]: valid },
            options.modules,
            { mode },
          );
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
          candidate.restoreInputs(values, { time: 0, mode: 'explore' });
        await candidate.ready();
        signal?.throwIfAborted();
        if (!prepared) throw new Error('Document has no prepared model frame.');
        render(prepared);
        shell.attachController(candidate);
        controller = candidate;
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
    shell.setTitle(next.title ?? recipe.title, { visible: next.title !== undefined });
    handle.extend({
      snapshot: () => latest && drawing.snapshot(latest.models[document.models[0]!.id]!),
    });
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
        prepare(source: unknown, operations?: readonly unknown[]) {
          const next = operations
            ? editStoryDocument(source, operations as readonly StoryDocumentOperation[], options)
            : source;
          const keys =
            operations?.flatMap((operation) => {
              const item = operation as StoryDocumentOperation;
              return item.op === 'set-inputs'
                ? authoredInputKeys(document, item.modelId, item.values)
                : [];
            }) ?? [];
          return prepare(next, false, keys).next;
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
