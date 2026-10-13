import { SceneShell } from '../scene.js';
import { surface } from '../ink/surface.js';
import { story, type Story } from './story.js';
import { cloneAudio } from './media.js';
import type { Frame, Script } from './cues.js';
import { divisionState, type DivisionState } from '../math/division.js';
import { divisionDiagram } from '../recipes/division.js';
import { validateStoryDocument, type StoryDocument, type AuthoredBeat } from './document.js';
import {
  compileStoryDocument,
  divisionSubject,
  hasStorySpeech,
  storyNarrationScript,
  validateStoryNarration,
} from './compiler.js';
import { IllustratedStory, type IllustratedStoryOptions } from './illustrated.js';

type Inputs = { count: number; divisor: number };
export type StoryDocumentMountOptions = Partial<Omit<IllustratedStoryOptions, 'document'>>;
let surfaceSerial = 0;

function pose(document: StoryDocument, frame?: Frame) {
  if (!frame) return { progress: 1, focus: 'all' as const };
  let progress = 0;
  let current: AuthoredBeat | undefined;
  for (const chapter of document.chapters)
    for (const beat of chapter.beats) {
      const cue = `${chapter.id}.${beat.id}`;
      if (frame.time < frame.cue(cue).start) continue;
      current = beat;
      if (beat.staging?.operation === 'gather') progress = 0;
      if (beat.staging?.operation === 'group') progress = frame.reveal(cue);
      if (beat.staging?.operation === 'remainder') progress = 1;
      for (const view of document.views) frame.target(cue, view.id);
    }
  return { progress, text: current?.text, focus: current?.staging?.focus ?? ('all' as const) };
}

/** Compile authored subjects into the existing shell/model/Story owners. */
export async function mountStoryDocument(
  root: HTMLElement,
  source: unknown,
  options: StoryDocumentMountOptions = {},
) {
  let document = validateStoryDocument(source);
  if (!document.models.length) {
    if (!options.chapters) throw new Error('Authored chapters need their presentation factories.');
    return (
      await IllustratedStory.mount(root, { ...options, document, chapters: options.chapters })
    ).scene;
  }
  for (const key of ['chapters', 'parameters', 'theme', 'transition'] as const)
    if (options[key] !== undefined)
      throw new Error(`A prepared division document does not accept ${key} presentation options.`);
  const model = divisionSubject(document);
  let aligned = options.script;
  let narrationLoaded = Boolean(options.script);
  let acceptedAudio = options.audio;
  let preparedNarration: StoryDocument | undefined;
  await SceneShell.ready();
  let controller: Story<Inputs, string, DivisionState> | undefined;
  let state = divisionState(model.inputs.count, model.inputs.divisor, { id: model.id });
  let activeFrame: Frame | undefined;
  const shell = SceneShell.mount(root, {
    title: document.title ?? 'Остаток от деления',
    heading: document.title !== undefined,
    frame: options.frame,
    captions: options.captions,
    parameters: [
      {
        key: 'count',
        label: 'Предметов',
        type: 'stepper',
        value: model.inputs.count,
        min: 0,
        max: 36,
        step: 1,
      },
      {
        key: 'divisor',
        label: 'В группе',
        type: 'stepper',
        value: model.inputs.divisor,
        min: 1,
        max: 12,
        step: 1,
      },
    ],
    onInput(values) {
      if (controller) return;
      const next = derive(document, values as Inputs);
      render(document, next);
      state = next;
    },
  });
  const drawing = surface(shell.stage, {
    id: `story-${++surfaceSerial}`,
    title: document.title ?? 'Деление на полные группы и остаток',
    description: 'Меняйте количество предметов или размер группы и проверяйте результат.',
    width: shell.layout.width,
    height: shell.layout.height,
    grid: false,
  });
  const diagram = divisionDiagram(drawing, model.id);
  shell.onDispose(diagram.dispose);
  shell.onDispose(drawing.dispose);
  const handle = root.scene!;
  function derive(document: StoryDocument, values: Inputs) {
    const model = divisionSubject(document);
    if (values.count > 36 || values.divisor > 12)
      throw new Error('groups: this drawing supports count ≤ 36 and divisor ≤ 12.');
    return divisionState(values.count, values.divisor, { id: model.id });
  }
  function drawingOptions(document: StoryDocument, frame?: Frame) {
    const layout = shell.layout;
    return {
      width: layout.width,
      height: layout.height,
      scale: layout.scale,
      ...pose(document, frame),
      showEquation: document.views.some((view) => view.kind === 'equation'),
      viewIds: {
        groups: document.views.find((view) => view.kind === 'groups')!.id,
        equation: document.views.find((view) => view.kind === 'equation')?.id,
      },
    };
  }
  function render(document: StoryDocument, next: DivisionState, frame?: Frame) {
    const settings = drawingOptions(document, frame);
    drawing.resize(settings.width, settings.height, false);
    diagram.render(next, settings);
    state = next;
    activeFrame = frame;
  }
  function prepare(source: unknown, provisional = false, authoredInputs: readonly string[] = []) {
    const next = validateStoryDocument(source),
      model = divisionSubject(next),
      previousModel = divisionSubject(document);
    if (
      !Array.isArray(authoredInputs) ||
      authoredInputs.some((key) => !['count', 'divisor'].includes(key))
    )
      throw new Error('authoredInputs: choose count or divisor.');
    if (!provisional && model.id !== previousModel.id)
      throw new Error('model.id: retain the subject identity while editing this story.');
    const previous = controller?.presented;
    const current = previous?.values ?? state;
    const values = Object.fromEntries(
      (['count', 'divisor'] as const).map((key) => [
        key,
        !authoredInputs.includes(key) && model.inputs[key] === previousModel.inputs[key]
          ? current[key]
          : model.inputs[key],
      ]),
    ) as Inputs;
    const derived = derive(next, values);
    const timing = next.chapters.length
      ? (options.script ?? (hasStorySpeech(next) ? aligned : undefined))
      : undefined;
    const narrated =
      hasStorySpeech(next) && options.audio && options.audio.dataset.silent !== 'true' && timing;
    if (narrated) validateStoryNarration(next, timing!, preparedNarration);
    const compiled = compileStoryDocument(next, timing);
    const settings = drawingOptions(next);
    const captions = new Set([
      undefined,
      ...next.chapters.flatMap((chapter) => chapter.beats.map((beat) => beat.text)),
    ]);
    for (const text of captions) diagram.validate(derived, { ...settings, text });
    return { next, values, derived, previous, compiled, narrated };
  }
  async function replace(
    source: unknown,
    {
      signal,
      provisional = false,
      authoredInputs,
    }: { signal?: AbortSignal; provisional?: boolean; authoredInputs?: readonly string[] } = {},
  ) {
    signal?.throwIfAborted();
    if (hasStorySpeech(validateStoryDocument(source)) && !narrationLoaded) {
      aligned = await storyNarrationScript(options.audio);
      narrationLoaded = true;
      signal?.throwIfAborted();
    }
    const { next, values, derived, previous, compiled, narrated } = prepare(
      source,
      provisional,
      authoredInputs,
    );
    let cleanupError: unknown;
    if (!compiled.script) {
      render(next, derived);
      try {
        shell.detachController();
      } catch (error) {
        // Detachment completes all cleanup before reporting a failure. Publish the
        // prepared static frame; the destroyed previous player cannot be restored.
        cleanupError = error;
      }
      controller = undefined;
      shell.syncParameters(values);
      handle.extend({ snapshot: () => state });
      document = next;
    } else {
      const script: Script = compiled.script;
      let active = false;
      let prepared: { state: DivisionState; frame: Frame } | undefined;
      const group = next.chapters
        .flatMap((chapter) => chapter.beats.map((beat) => ({ chapter, beat })))
        .find(({ beat }) => beat.staging?.operation === 'group');
      const groupEnd = group ? script.cues[`${group.chapter.id}.${group.beat.id}`]!.end : 0;
      const audioSource = hasStorySpeech(next) ? acceptedAudio : undefined;
      const ownedAudio =
        initialized && audioSource && audioSource.dataset.silent !== 'true'
          ? cloneAudio(audioSource)
          : undefined;
      const candidate = story<Inputs, string, DivisionState>({
        script,
        audio: ownedAudio ?? audioSource,
        exploreTimeline: true,
        stateAt: () => ({ ...divisionSubject(next).inputs }),
        derive: (values) => derive(next, values),
        resolveInput(patch, current) {
          return { values: { ...current.values, ...patch }, time: group ? groupEnd : current.time };
        },
        render(state, frame) {
          if (active) render(next, state, frame);
          else prepared = { state, frame };
        },
      });
      try {
        if (previous || initialized)
          candidate.restoreInputs(values, {
            time: previous ? Math.min(previous.time, script.duration) : groupEnd,
            mode: previous?.mode ?? 'explore',
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
        if (!prepared) throw new Error('Story has no prepared model frame.');
        render(next, prepared.state, prepared.frame);
        shell.attachController(candidate);
        controller = candidate;
        if (ownedAudio) acceptedAudio = ownedAudio;
        document = next;
        active = true;
      } catch (error) {
        candidate.dispose();
        throw error;
      }
    }
    if (narrated && !preparedNarration) preparedNarration = next;
    initialized = true;
    shell.setTitle(next.title ?? 'Остаток от деления', { visible: next.title !== undefined });
    drawing.element.querySelector('title')!.textContent =
      next.title ?? 'Деление на полные группы и остаток';
    if (cleanupError)
      root.dispatchEvent(
        new CustomEvent('scene-playback-error', { bubbles: true, detail: cleanupError }),
      );
  }
  let initialized = false;
  let redraw = 0;
  const resize = () => {
    if (controller || redraw) return;
    redraw = requestAnimationFrame(() => {
      redraw = 0;
      if (!controller) render(document, state, activeFrame);
    });
  };
  const observer = new ResizeObserver(resize);
  observer.observe(shell.stage);
  root.addEventListener('scene-frame-resize', resize);
  shell.onDispose(() => {
    observer.disconnect();
    root.removeEventListener('scene-frame-resize', resize);
    cancelAnimationFrame(redraw);
  });
  try {
    await replace(document);
    handle.extend({
      authoring: {
        get document() {
          return structuredClone(document);
        },
        validate(source: unknown, options) {
          prepare(source, false, options?.authoredInputs);
        },
        replace,
      },
    });
    return handle;
  } catch (error) {
    shell.dispose();
    throw error;
  }
}
