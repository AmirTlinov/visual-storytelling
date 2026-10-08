import { mountScene } from './scene-handle.js';
import {
  story,
  type Story,
  type StoryOptions,
  type StoryStatus,
  type StoryMoment,
} from './story/story.js';
import { chapterNavigation } from './story/chapters.js';
import { captionTrack, type CaptionOptions } from './story/captions.js';
import { sceneFrame, inspectPresentation, type SceneFrameOptions } from './scene-frame.js';
export type { SceneFrameOptions, ScenePresentation } from './scene-frame.js';
import { loadFonts } from './ink/fonts.js';
import { theme } from './ink/palette.js';
import { SceneHistory } from './controls/history.js';
import { player as statePlayer } from './controls/player.js';
import type { SceneHandle } from './scene-handle.js';
import type { SceneInspection, SceneRendering } from './scene-access.js';
import type { SceneCheckpoint, SceneView } from './scene-checkpoint.js';
export type {
  SceneCheckpoint,
  SceneCaptureOptions,
  SceneView,
  SceneRestoreNotice,
  SceneSubject,
} from './scene-checkpoint.js';
export { mountScene } from './scene-handle.js';
export type { SceneHandle, SceneRuntime, SceneHost } from './scene-handle.js';
export interface SceneOptions {
  title: string;
  /** Shared controls can follow a product interface while the subject owns its brand. */
  appearance?: 'sketch' | 'interface';
  paper?: boolean;
  /** Logical composition dimensions for a fixed video frame. Controls remain outside. */
  frame?: SceneFrameOptions;
  /** Hide the shell heading when the subject supplies its own title. */
  heading?: boolean;
  /** Optional visible word-aligned captions; omitted keeps the accessible chapter text. */
  captions?: true | CaptionOptions;
  parameters?: (ControlParameter & { key: string })[];
  onInput?: (values: Record<string, ControlValue>) => void;
  onMode?: (mode: 'story' | 'explore') => void;
  /** View-only exploration leaves narration and model time running. */
  exploration?: 'model' | 'view';
  /** Disable when the subject supplies its own SceneHistory for richer editable state. */
  history?: boolean;
}
export interface SceneMount {
  stage: HTMLDivElement;
  fields: HTMLDivElement;
  actions: HTMLDivElement;
  status: HTMLParagraphElement;
  parameters: Record<string, ControlValue>;
  readonly mode: 'story' | 'explore';
  setMode(mode: 'story' | 'explore'): void;
  /** Reflect subject-owned edits in an editable shell; story inputs use story.explore(). */
  syncParameters(values: Record<string, ControlValue>): void;
  showParameters(keys?: readonly string[]): void;
  describeParameter(key: string, description: ControlDescription): void;
  attachStory<P, K extends string, S = P>(options: StoryOptions<P, K, S>): Story<P, K, S>;
  attachController<P, K extends string, S>(controller: Story<P, K, S>): SceneHandle;
  /** Register subject-owned observers, animations and subscriptions for removal. */
  onDispose(cleanup: () => void): () => void;
  /** View gestures keep media running; mode buttons and seeking restore the authored shot. */
  attachView(view: SceneView): void;
  dispose(): void;
}
import {
  SketchControls,
  type ControlDescription,
  type ControlParameter,
  type ControlValue,
} from './controls/fields.js';
/* Shared presentation shell. Subject state and rendering stay in scene.js. */

const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number | boolean> = {},
  text?: string,
) => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
};
function mount(
  root: HTMLElement,
  {
    title,
    paper,
    appearance = 'sketch',
    parameters = [],
    onInput = () => {},
    onMode = () => {},
    exploration = 'model',
    frame,
    heading: showHeading = true,
    captions,
    history: retainHistory = true,
  }: SceneOptions,
): SceneMount {
  if (parameters.some((p, i) => !p.key || parameters.findIndex((q) => q.key === p.key) !== i))
    throw new Error('Scene parameters need unique, nonempty keys');
  parameters = parameters.map((p) => ({ ...p }));
  root.scene?.dispose();
  const abort = new AbortController(),
    options = { signal: abort.signal };
  const cleanups = new Set<() => void>();
  const sceneTheme = theme(root);
  cleanups.add(sceneTheme.dispose);
  const values = Object.fromEntries(parameters.map((p) => [p.key, p.value]));
  let inputStory: ((next: Record<string, ControlValue>) => void) | undefined;
  let playback: (() => boolean) | undefined;
  let view: SceneView | undefined;
  let history: ReturnType<typeof SceneHistory.mount<SceneCheckpoint, SceneInspection>> | undefined;
  const heading = node('h1', { class: 've-heading' }, title),
    modes = node('div', { class: 'modes', role: 'group', 'aria-label': 'Режим сцены' });
  const storyButton = node(
    'button',
    { type: 'button', 'data-mode': 'story', 'aria-pressed': 'false', hidden: '' },
    'Рассказ',
  );
  const exploreButton = node(
    'button',
    { type: 'button', 'data-mode': 'explore', 'aria-pressed': 'true' },
    'Исследовать',
  );
  modes.append(storyButton, exploreButton);
  const stage = node('div', { class: 've-stage' }),
    fields = node('div', { class: 've-parameters' });
  fields.style.setProperty('--ve-parameter-columns', String(Math.min(3, parameters.length) || 1));
  modes.hidden = true;
  fields.hidden = !parameters.length;
  const inputs = new Map<string, ReturnType<typeof SketchControls.field>>();
  for (const p of parameters) {
    const control = SketchControls.field(p, (value) => {
      try {
        changeValues({ [p.key]: value });
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
        return;
      }
      status.textContent = '';
    });
    fields.append(control.element);
    inputs.set(p.key, control);
  }
  const actions = node('div', { class: 've-view-actions' }),
    controls = node('div', { 'data-player': '', hidden: '' });
  heading.hidden = !showHeading;
  const caption = node('p', {
      class: captions ? 've-captions' : 'caption sr-only',
      'data-caption': '',
      role: 'status',
    }),
    status = node('p', { class: 've-status', role: 'alert' });
  root.addEventListener(
    'scene-restored',
    (event) => {
      const notices = (event as CustomEvent<import('./scene-checkpoint.js').SceneRestoreNotice[]>)
        .detail;
      status.textContent = notices.map((notice) => notice.message).join(' ');
    },
    options,
  );
  root.addEventListener(
    'scene-playback-error',
    (event) => {
      const error = (event as CustomEvent<unknown>).detail;
      status.textContent = error instanceof Error ? error.message : String(error);
    },
    options,
  );
  const composition = frame ? sceneFrame(stage, frame) : undefined;
  if (composition) cleanups.add(composition.dispose);
  root.append(heading, modes, actions, fields, composition?.element ?? stage);
  if (captions && composition) stage.append(caption);
  else root.append(caption);
  root.append(controls, status);
  composition?.resize();
  let transition: ((mode: 'story' | 'explore') => void) | undefined;
  let mode: 'story' | 'explore' = 'explore';
  let player: { dispose(): void } | undefined;
  function refresh() {
    for (const [key, control] of inputs)
      if (control.value !== values[key]) control.setValue(values[key]!);
  }
  function changeValues(next: Record<string, ControlValue>) {
    if (history) history.change(() => applyValues(next));
    else applyValues(next);
  }
  function applyValues(next: Record<string, ControlValue>) {
    assertLive();
    if (inputStory) {
      try {
        inputStory(next);
      } finally {
        refresh();
      }
      onInput({ ...values });
      return;
    }
    const previous = { ...values };
    try {
      Object.assign(values, next);
      onInput({ ...values });
    } catch (error) {
      Object.assign(values, previous);
      refresh();
      throw error;
    }
    refresh();
  }
  function setMode(next: 'story' | 'explore') {
    if (next === mode || (next === 'story' && !player)) return;
    const previous = mode;
    mode = next;
    try {
      transition?.(next);
    } catch (error) {
      mode = previous;
      throw error;
    }
    controls.hidden = exploration === 'model' && mode !== 'story';
    caption.hidden = controls.hidden;
    fields.hidden = mode === 'story' || !fields.childElementCount;
    storyButton.setAttribute('aria-pressed', String(mode === 'story'));
    exploreButton.setAttribute('aria-pressed', String(mode === 'explore'));
    root.dataset.sceneMode = mode;
    onMode(mode);
    if (next === 'story') history?.clear();
  }
  function selectMode(next: 'story' | 'explore') {
    const from = view?.capture?.();
    setMode(next);
    view?.reset({ animate: true, from });
  }
  storyButton.addEventListener('click', () => selectMode('story'), options);
  exploreButton.addEventListener('click', () => selectMode('explore'), options);
  refresh();
  root.dataset.sceneMode = mode;
  root.dataset.paper = String(paper ?? appearance === 'sketch');
  root.dataset.appearance = appearance;
  const handle = mountScene(
    root,
    {
      snapshot: () => ({ ...values }),
      presentation: () => inspectPresentation(stage),
      setTheme: sceneTheme.set,
      dispose,
    },
    {
      playing: (): boolean => playback?.() ?? handle.playing ?? false,
      mode: () => mode,
      values: () => ({ ...values }),
      parameters,
      visible: (key) => !inputs.get(key)!.element.hidden,
      get setMode() {
        return player ? selectMode : undefined;
      },
      setValues: changeValues,
      view: () => view,
    },
  );
  if (parameters.length && retainHistory) {
    const bar = node('div', { class: 've-experiment-history', hidden: '' });
    const undo = node('button', { type: 'button' }, 'Отменить условие'),
      redo = node('button', { type: 'button' }, 'Повторить');
    bar.append(undo, redo);
    actions.append(bar);
    history = SceneHistory.mount(root, {
      read: () => handle.capture({ basis: 'requested' }),
      restore: handle.restore,
      gestureRoot: fields,
      equal: (a, b) => a.mode === b.mode && JSON.stringify(a.values) === JSON.stringify(b.values),
      onError: (error) => {
        status.textContent = error instanceof Error ? error.message : String(error);
      },
      changed: () => {
        const focused = document.activeElement;
        undo.disabled = !history!.state.undo;
        redo.disabled = !history!.state.redo;
        bar.hidden = !history!.state.undo && !history!.state.redo;
        if (focused === undo && undo.disabled && !redo.disabled)
          redo.focus({ preventScroll: true });
        else if (focused === redo && redo.disabled && !undo.disabled)
          undo.focus({ preventScroll: true });
        root.dispatchEvent(new CustomEvent('scene-history', { bubbles: true }));
      },
    });
    handle.undoExperiment = history.undo;
    handle.redoExperiment = history.redo;
    handle.restore = history.restore;
    Object.defineProperty(handle, 'experimentHistory', {
      configurable: true,
      get: () => history!.state,
    });
    cleanups.add(history.dispose);
    const travel = (direction: 'undo' | 'redo') =>
      void history![direction]().catch((e) => {
        status.textContent = e.message;
      });
    undo.addEventListener('click', () => travel('undo'), options);
    redo.addEventListener('click', () => travel('redo'), options);
  }
  return {
    stage,
    fields,
    actions,
    status,
    parameters: values,
    get mode() {
      return mode;
    },
    setMode,
    syncParameters(next: Record<string, ControlValue>) {
      assertLive();
      if (inputStory) throw new Error('Story parameters belong to story.explore()');
      if (Object.entries(next).some(([key, value]) => values[key] !== value)) {
        Object.assign(values, next);
        refresh();
      }
    },
    showParameters(keys?: readonly string[]) {
      let count = 0;
      for (const [key, control] of inputs) {
        control.element.hidden = keys !== undefined && !keys.includes(key);
        if (!control.element.hidden) count++;
      }
      fields.style.setProperty('--ve-parameter-columns', String(Math.min(3, count) || 1));
    },
    describeParameter(key: string, description: ControlDescription) {
      const control = inputs.get(key);
      if (!control) throw new Error(`Unknown scene parameter: ${key}`);
      control.describe(description);
    },
    attachStory<P, K extends string, S = P>(options: StoryOptions<P, K, S>): Story<P, K, S> {
      assertLive();
      const controller = story(options);
      try {
        attachController(controller);
      } catch (error) {
        controller.dispose();
        throw error;
      }
      return controller;
    },
    attachController,
    onDispose(cleanup: () => void) {
      if (abort.signal.aborted) cleanup();
      else cleanups.add(cleanup);
      return () => cleanups.delete(cleanup);
    },
    attachView(next: SceneView) {
      assertLive();
      if (view === next) return;
      view?.dispose();
      view = next;
      const focus = (ids: readonly string[]) => next.focus!(ids);
      handle.extend({
        get focus() {
          return next.focus ? focus : undefined;
        },
      });
      modes.hidden = false;
    },
    dispose: handle.dispose,
  };

  function assertLive() {
    if (abort.signal.aborted) throw new Error(`Scene "${title}" has been disposed`);
  }
  function attachController<P, K extends string, S>(controller: Story<P, K, S>) {
    assertLive();
    for (const { key } of parameters) {
      if (
        !controller.requested.values ||
        typeof controller.requested.values !== 'object' ||
        !(key in controller.requested.values)
      )
        throw new Error(`Scene "${title}": parameter "${key}" is missing from stateAt()`);
    }
    const segments = controller.sheet.script.segments;
    const track = captionTrack(
      {
        segments: captions ? segments : segments?.map(({ words: _words, ...chapter }) => chapter),
        captionAliases: controller.sheet.script.captionAliases,
      },
      captions === true ? {} : captions,
    );
    player?.dispose();
    transition = (next) => {
      if (exploration === 'model' && controller.requested.mode !== next) {
        if (next === 'explore') controller.explore(controller.requested.values);
        else controller.resume();
      }
    };
    const ui = statePlayer(controls, {
      transport: controller.player,
      stops: controller.sheet.script.segments?.map((s) => s.start),
      captions: { element: caption, track },
      onSeek: controller.seek,
      onPlay: preparePlayback,
    });
    inputStory = (next) => {
      controller.explore({ ...controller.requested.values, ...next });
    };
    playback = () => controller.player.state.playing;
    const chapters = chapterNavigation(
      heading,
      controller.sheet.script.segments ?? [],
      controller.seek,
    );
    let resetAfterSeek = false;
    const stopSeeking = controller.onSeek(() => {
      resetAfterSeek = true;
    });
    // Layout can change the stage height. Render outside ResizeObserver delivery so
    // that surface.resize() cannot create a same-frame observation loop.
    let layoutFrame = 0,
      stageWidth = stage.clientWidth,
      stageHeight = stage.clientHeight;
    const layout = new ResizeObserver(() => {
      const width = stage.clientWidth,
        height = stage.clientHeight;
      if (width === stageWidth && height === stageHeight) return;
      stageWidth = width;
      stageHeight = height;
      if (layoutFrame) return;
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        controller.update();
      });
    });
    layout.observe(stage);
    let unsubscribe = () => {};
    player = {
      dispose() {
        layout.disconnect();
        cancelAnimationFrame(layoutFrame);
        unsubscribe();
        ui.dispose();
        chapters.dispose();
        stopSeeking();
        controller.dispose();
      },
    };
    storyButton.hidden = false;
    modes.hidden = !parameters.length && !view;
    function reflectState({ requested, phase, error }: StoryStatus<P, S>) {
      const { mode: next, values: state } = requested;
      if (next !== 'story') resetAfterSeek = false;
      if (phase === 'ready' && resetAfterSeek) {
        resetAfterSeek = false;
        view?.reset();
        if (exploration === 'view') setMode('story');
      }
      if (error)
        status.textContent =
          error.cause instanceof Error ? error.cause.message : String(error.cause);
      else status.textContent = '';
      if (phase === 'preparing') stage.setAttribute('aria-busy', 'true');
      else stage.removeAttribute('aria-busy');
      for (const { key } of parameters) values[key] = (state as Record<string, ControlValue>)[key]!;
      if (exploration === 'model') setMode(next);
      refresh();
      chapters.update(controller.currentTime);
    }
    unsubscribe = controller.subscribe(reflectState);
    setMode('story');
    handle.extend({
      play: () => {
        assertLive();
        preparePlayback();
        return controller.player.play();
      },
      seek: controller.seek,
      ready: controller.ready,
      pause: controller.pause,
      mute: controller.player.mute,
      setRate: controller.player.rate,
      get muted() {
        return controller.player.state.muted;
      },
      get rate() {
        return controller.player.state.rate;
      },
      review: controller.review,
      duration: controller.duration,
      get currentTime() {
        return controller.currentTime;
      },
      snapshot: () => controller.presented?.state,
      subject: controller.subject,
      get rendering(): SceneRendering {
        const moment = (value: StoryMoment<P, S>) => ({
          time: value.time,
          mode: exploration === 'view' ? mode : value.mode,
          values: Object.fromEntries(
            parameters.map(({ key }) => [
              key,
              (value.values as Record<string, ControlValue>)[key]!,
            ]),
          ),
        });
        const requested = moment(controller.requested);
        return {
          phase: controller.phase,
          requested,
          presented:
            controller.presented === controller.requested
              ? requested
              : controller.presented && moment(controller.presented),
          error: controller.error && {
            stage: controller.error.stage,
            message:
              controller.error.cause instanceof Error
                ? controller.error.cause.message
                : String(controller.error.cause),
          },
        };
      },
      setReduced: controller.setReduced,
    });
    return handle;
    function preparePlayback() {
      if (controller.currentTime >= controller.duration - 0.02) view?.reset();
      if (exploration === 'model') setMode('story');
      else controller.resume();
    }
  }

  function dispose() {
    if (abort.signal.aborted) return;
    abort.abort();
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    player?.dispose();
    view?.dispose();
    for (const control of inputs.values()) control.dispose();
    root.replaceChildren();
    inputStory = undefined;
    Reflect.deleteProperty(root, 'scene');
  }
}
export const SceneShell = { mount, ready: loadFonts };
