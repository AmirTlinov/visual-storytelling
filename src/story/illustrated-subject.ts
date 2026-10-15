import { releaseResources } from '../lifecycle.js';
import { SceneShell } from '../scene.js';
import { story, type Story } from './story.js';
import { documentModelsAt, documentCanContinue } from './document-model.js';
import { prepareIllustratedDocument } from './document-subject.js';
import type { StoryDocument } from './document-schema.js';
import type { ModelValues } from './model.js';
import type { IllustratedStoryOptions } from './illustrated.js';
import type { Script, Frame } from './cues.js';
import { editStoryDocument, authoredInputKeys, type StoryDocumentOperation } from './document.js';
import { modelInputValues } from './model.js';
import { documentSpeechApplicable } from './document-audibility.js';
import { documentNarration } from './document-narration.js';

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
  await SceneShell.ready();
  let controller: Story<ModelValues, string, SubjectMoment> | undefined;
  let latest: SubjectMoment | undefined;
  let latestFrame: { frame: Frame; mode: 'story' | 'explore' } | undefined;
  const shell = SceneShell.mount(root, {
    title: initial.title ?? recipe.title,
    heading: options.heading ?? (initial.title !== undefined ? 'navigation' : false),
    parameters: recipe.parameters(model),
    resources: initial.resources,
    frame: options.frame ?? recipe.frame,
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
    if (recipe.controls) shell.showParameters(recipe.controls);
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
    const { document: next, script } = prepareIllustratedDocument(source, options, aligned);
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
    const baseline = document,
      acceptedMoment = latest,
      acceptedFrame = latestFrame,
      wasPlaying = controller?.player.state.playing;
    const restoreDrawing = async () => {
      if (!acceptedMoment || document !== baseline) return;
      latest = acceptedMoment;
      latestFrame = acceptedFrame;
      drawing.render(
        baseline.models[0]!,
        acceptedMoment.views,
        acceptedMoment.models[baseline.models[0]!.id]!,
        acceptedMoment.beat,
        acceptedFrame,
      );
      await drawing.ready?.();
    };
    const render = (moment: SubjectMoment, frame?: typeof latestFrame) => {
      drawing.render(nextModel, moment.views, moment.models[nextModel.id]!, moment.beat, frame);
      latest = moment;
      latestFrame = frame;
    };
    if (!script) {
      const moment = documentModelsAt(next, undefined, { [nextModel.id]: values }, options.modules);
      try {
        await drawing.prepare?.(
          nextModel,
          moment.views,
          moment.models[nextModel.id]!,
          moment.beat,
          undefined,
          signal ?? new AbortController().signal,
        );
        signal?.throwIfAborted();
        render(moment);
        await drawing.ready?.(signal);
        signal?.throwIfAborted();
        shell.detachController();
        controller = undefined;
        shell.syncParameters(values);
        document = next;
      } catch (error) {
        let rollbackFailure: unknown;
        try {
          await restoreDrawing();
        } catch (failure) {
          rollbackFailure = failure;
        }
        if (rollbackFailure)
          throw new AggregateError(
            [error, rollbackFailure],
            'Static drawing preparation and rollback failed.',
          );
        throw error;
      }
    } else {
      let active = false,
        prepared: { moment: SubjectMoment; frame: NonNullable<typeof latestFrame> } | undefined;
      const candidate = story<ModelValues, string, SubjectMoment>({
        script,
        exploreTimeline: true,
        speechApplicable(unit, moment) {
          return documentSpeechApplicable(next, unit, moment.mode, {
            [nextModel.id]: modelInputValues(nextModel, moment.state.models[nextModel.id]!, module),
          });
        },
        stateAt(frame) {
          return modelInputValues(
            nextModel,
            documentModelsAt(next, frame, {}, options.modules).models[nextModel.id]!,
            module,
          );
        },
        resolveTime(values, frame) {
          return recipe.resolveTime
            ? module.validateInputs(
                recipe.resolveTime(
                  values,
                  documentModelsAt(next, frame, {}, options.modules).models[nextModel.id]!,
                  frame,
                ),
              )
            : values;
        },
        canContinue(_cue, moment) {
          return documentCanContinue(next, moment.state, options.modules);
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
        resolveInput(patch, current, _frame, intent) {
          const resolved = recipe.resolveInput?.(
            patch,
            { ...current, playing: Boolean(controller?.player.state.playing) },
            next,
            script,
            intent,
          );
          return {
            values: module.validateInputs(resolved?.values ?? { ...current.values, ...patch }),
            time: resolved?.time ?? current.time,
          };
        },
        prepare(moment, frame, mode, signal) {
          return drawing.prepare?.(
            nextModel,
            moment.views,
            moment.models[nextModel.id]!,
            moment.beat,
            { frame, mode },
            signal,
          );
        },
        render(moment, frame, mode) {
          if (active) render(moment, { frame, mode });
          else prepared = { moment, frame: { frame, mode } };
        },
      });
      let audio: ReturnType<typeof candidate.prepareAudio> | undefined;
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
        const previousMuted = controller?.player.state.hasAudio
          ? controller.player.state.muted
          : undefined;
        if (options.audio) audio = candidate.prepareAudio(options.audio, { muted: previousMuted });
        render(prepared.moment, prepared.frame);
        await drawing.ready?.(signal);
        signal?.throwIfAborted();
        audio?.commit();
        shell.attachController(candidate);
        controller = candidate;
        document = next;
        active = true;
      } catch (error) {
        let rollbackFailure: unknown;
        try {
          await restoreDrawing();
        } catch (failure) {
          rollbackFailure = failure;
        }
        if (wasPlaying && controller) void controller.player.play().catch(() => {});
        releaseResources(
          [
            () => {
              throw error;
            },
            () => {
              if (rollbackFailure) throw rollbackFailure;
            },
            () => candidate.dispose(),
            () => audio?.cancel(),
          ],
          'Story document preparation failed.',
        );
        throw error;
      }
    }
    shell.setResources(next.resources ?? []);
    shell.setTitle(next.title ?? recipe.title, { visible: next.title !== undefined });
    handle.extend({
      snapshot: () => latest && drawing.snapshot(latest.models[document.models[0]!.id]!),
    });
  }
  const resize = () => {
    if (controller || !latest) return;
    drawing.render(
      document.models[0]!,
      latest.views,
      latest.models[document.models[0]!.id]!,
      latest.beat,
      latestFrame,
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
        get narration() {
          return documentNarration(document, options);
        },
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
