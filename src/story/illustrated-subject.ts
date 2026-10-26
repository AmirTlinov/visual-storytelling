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
import { documentCaptionApplicable } from './document-conditions.js';
import { documentNarration } from './document-narration.js';
import { freezePresentation } from './frozen-presentation.js';
import { holdControlFocus } from '../scene/control-focus.js';
import { illustratedPreparation } from './illustrated-preparation.js';

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
  let renderingOwner: object | undefined;
  let latest: SubjectMoment | undefined;
  let latestFrame: { frame: Frame; mode: 'story' | 'explore' } | undefined;
  let releaseCover: (() => void) | undefined;
  let coveredSnapshot: { value: unknown } | undefined;
  let coverWasInert = false;
  let interactionRestore: boolean | undefined;
  let replacing = false;
  let drawingHasPlayer = Boolean(initial.chapters.length);
  const shell = SceneShell.mount(root, {
    title: initial.title ?? recipe.title,
    heading: options.heading ?? (recipe.navigation !== false && initial.title !== undefined ? 'navigation' : false),
    parameters: recipe.parameters(model),
    resources: initial.resources,
    frame: options.frame ?? recipe.frame,
    navigation: recipe.navigation,
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
      renderDrawing(document.models[0]!, document.views, next.models[document.models[0]!.id]!);
      handle.emphasize([]);
      latest = next;
    },
  });
  const handle = root.scene!;
  const lifetime = new AbortController();
  shell.onDispose(() => {
    lifetime.abort();
  });
  shell.onDispose(() => {
    if (interactionRestore !== undefined && root.scene === handle) root.inert = interactionRestore;
    interactionRestore = undefined;
    releaseCover?.();
    releaseCover = undefined;
    coveredSnapshot = undefined;
  });
  if (options.theme) handle.setTheme!(options.theme);
  let drawing: ReturnType<typeof recipe.create>;
  function renderDrawing(...args: Parameters<typeof drawing.render>) {
    const previous = drawingHasPlayer;
    drawingHasPlayer = Boolean(args[4]);
    try {
      drawing.render(...args);
    } catch (error) {
      drawingHasPlayer = previous;
      throw error;
    }
  }
  try {
    if (recipe.controls) shell.showParameters(recipe.controls);
    const viewport = {
      stage: shell.stage,
      get layout() {
        return shell.layout;
      },
      input: shell.input,
      inputGesture: shell.inputGesture,
      attachView: shell.attachView,
      playback: {
        get available() {
          return drawingHasPlayer;
        },
        pause() {
          controller?.pause();
        },
        replay() {
          if (!drawingHasPlayer || !controller || lifetime.signal.aborted) return;
          const current = controller;
          current.pause();
          current.seek(0);
          // Register playback before yielding. Transport owns preparation, permission,
          // cancellation by any Pause path, and disposal of this single clock.
          void current.player.play().catch((error) => {
            if (!lifetime.signal.aborted && controller === current)
              root.dispatchEvent(
                new CustomEvent('scene-playback-error', { bubbles: true, detail: error }),
              );
          });
        },
      },
    };
    drawing = recipe.create(viewport, model);
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
  const preparation = illustratedPreparation({
    model,
    module,
    options,
    aligned,
    shell,
    drawing,
    document: () => document,
    presented: () => controller?.presented,
  });
  const { prepare } = preparation;
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
    signal = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
    signal?.throwIfAborted();
    if (replacing)
      throw Object.assign(new Error('The previous document replacement is still settling.'), {
        code: 'scene_authoring_busy',
      });
    let proposal = prepare(source, provisional, authoredInputs);
    replacing = true;
    try {
      const previousOwner = renderingOwner;
      const wasInert = root.inert,
        restoreInteraction = releaseCover ? coverWasInert : wasInert,
        visual = { ready: !releaseCover };
      const draft = holdControlFocus([root]);
      const unregisterDraft = shell.onDispose(draft.release);
      interactionRestore = restoreInteraction;
      const previous = controller,
        wasPlaying = previous?.player.state.playing;
      root.inert = true;
      try {
        previous?.pause();
        // Retire the old render intention before lending its drawing to a candidate.
        if (previous?.phase !== 'failed') await previous?.ready();
        signal?.throwIfAborted();
        // An input already preparing when the edit arrived can have just become accepted.
        if (previous?.presented !== proposal.previous)
          proposal = prepare(source, provisional, authoredInputs);
        renderingOwner = {};
        if (latest && !releaseCover) {
          coverWasInert = wasInert;
          coveredSnapshot = { value: handle.snapshot() };
          releaseCover = await freezePresentation({ element: shell.stage, drawing: {} }, signal);
        }
        await replacePrepared(proposal, visual, signal);
      } finally {
        if (controller === previous) renderingOwner = previousOwner;
        if (visual.ready || lifetime.signal.aborted) {
          releaseCover?.();
          releaseCover = undefined;
          coveredSnapshot = undefined;
        }
        if (root.scene === handle) {
          root.inert = visual.ready || lifetime.signal.aborted ? restoreInteraction : true;
          if (visual.ready || lifetime.signal.aborted) interactionRestore = undefined;
        }
        try {
          if (!lifetime.signal.aborted && root.scene === handle) draft.restore();
        } catch (error) {
          root.dispatchEvent(
            new CustomEvent('scene-callback-error', { bubbles: true, detail: error }),
          );
        } finally {
          unregisterDraft();
          draft.release();
        }
        if (
          visual.ready &&
          !lifetime.signal.aborted &&
          wasPlaying &&
          controller &&
          !controller.waiting &&
          controller.currentTime < controller.duration
        )
          await controller.player
            .play()
            .catch((error) =>
              root.dispatchEvent(
                new CustomEvent('scene-playback-error', { bubbles: true, detail: error }),
              ),
            );
      }
    } finally {
      replacing = false;
    }
  }
  async function replacePrepared(
    { next, values, previous, script }: ReturnType<typeof prepare>,
    visual: { ready: boolean },
    signal?: AbortSignal,
  ) {
    const owner = {};
    renderingOwner = owner;
    const nextModel = next.models[0]!;
    const baseline = document,
      acceptedMoment = latest,
      acceptedFrame = latestFrame;
    const restoreDrawing = async () => {
      if (lifetime.signal.aborted || !acceptedMoment || document !== baseline) return;
      latest = acceptedMoment;
      latestFrame = acceptedFrame;
      renderDrawing(
        baseline.models[0]!,
        acceptedMoment.views,
        acceptedMoment.models[baseline.models[0]!.id]!,
        acceptedMoment.beat,
        acceptedFrame,
      );
      handle.emphasize(acceptedMoment.beat?.focus ?? []);
      await drawing.ready?.();
      visual.ready = true;
    };
    const render = (moment: SubjectMoment, frame?: typeof latestFrame) => {
      visual.ready = false;
      renderDrawing(nextModel, moment.views, moment.models[nextModel.id]!, moment.beat, frame);
      handle.emphasize(moment.beat?.focus ?? []);
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
        captionApplicable(unit, moment) {
          return documentCaptionApplicable(next, unit, moment.mode, {
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
            playback: resolved?.playback,
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
          if (active && renderingOwner === owner) render(moment, { frame, mode });
          else prepared = { moment, frame: { frame, mode } };
        },
      });
      let audio: ReturnType<typeof candidate.prepareAudio> | undefined;
      signal?.addEventListener('abort', candidate.dispose, { once: true });
      try {
        if (previous)
          candidate.restoreInputs(values, {
            time: Math.min(previous.time, script.duration),
            mode: previous.mode,
          });
        else if (controller === undefined && latest !== undefined)
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
        // Publication synchronously transfers ownership; cancellation no longer owns this controller.
        signal?.removeEventListener('abort', candidate.dispose);
        shell.attachController(candidate, () => audio?.commit());
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
      } finally {
        signal?.removeEventListener('abort', candidate.dispose);
      }
    }
    shell.setResources(next.resources ?? []);
    shell.setTitle(next.title ?? recipe.title, { visible: options.heading !== false && recipe.navigation !== false && next.title !== undefined });
    handle.extend({
      snapshot: () =>
        coveredSnapshot
          ? coveredSnapshot.value
          : latest && drawing.snapshot(latest.models[document.models[0]!.id]!),
    });
    visual.ready = true;
  }
  const resize = () => {
    if (controller || !latest) return;
    renderDrawing(
      document.models[0]!,
      latest.views,
      latest.models[document.models[0]!.id]!,
      latest.beat,
      latestFrame,
    );
    handle.emphasize(latest.beat?.focus ?? []);
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
        get checks() {
          return preparation.checks;
        },
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
