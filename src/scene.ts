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
import { exportCompositionSVG } from './export/composition.js';
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
/** Explanation keeps annotations on the sheet; stage gives the subject the complete frame. */
export type SceneFramePresentation = 'explanation' | 'stage';
export interface SceneOptions {
  title: string;
  /** Shared controls can follow a product interface while the subject owns its brand. */
  appearance?: 'sketch' | 'interface';
  paper?: boolean;
  presentation?: SceneFramePresentation;
  /** 1280×720 drawing by default. Playback and status stay outside the composition. */
  frame?: SceneFrameOptions;
  /** Hide the shell heading when the subject supplies its own title. */
  heading?: boolean;
  /** Hide shared chapter/mode/history navigation when the subject supplies its own. Camera and history ownership are unchanged. */
  navigation?: boolean;
  /** Optional visible word-aligned captions; omitted keeps the accessible chapter text. */
  captions?:
    | true
    | (CaptionOptions & {
        /** Below a stage frame, text keeps its screen size. Whole-scene frames include it. */
        placement?: 'overlay' | 'below';
      });
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
  /** Current subject geometry, including the scale to the displayed CSS pixels. */
  readonly layout: SceneLayout;
  readonly mode: 'story' | 'explore';
  setMode(mode: 'story' | 'explore'): void;
  /** Publish the current subject's frame without changing its clock, inputs or player. */
  setPresentation(presentation: SceneFramePresentation): void;
  /** Reflect subject-owned edits in an editable shell; story edits use story.input(). */
  syncParameters(values: Record<string, ControlValue>): void;
  /** Commit a subject-owned user action through the existing controls and undo history. */
  input(values: Record<string, ControlValue>): void;
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
export interface SceneLayout {
  /** Available subject space in the composition's logical coordinates. */
  readonly width: number;
  readonly height: number;
  /** Subject size after the complete composition has been fitted to its surface. */
  readonly displayWidth: number;
  readonly displayHeight: number;
  /** Uniform composition scale; 1 before the hidden subject can be measured. */
  readonly scale: number;
  readonly compact: boolean;
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
let shellSerial = 0;
function mount(
  root: HTMLElement,
  {
    title,
    paper,
    presentation = 'explanation',
    appearance = 'sketch',
    parameters = [],
    onInput = () => {},
    onMode = () => {},
    exploration = 'model',
    frame = { width: 1280, height: 720, scope: 'scene' },
    heading: showHeading = true,
    navigation: showNavigation = true,
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
  let inputStory:
    | ((
        next: Record<string, ControlValue>,
        position?: { time: number; mode: 'story' | 'explore' },
      ) => void)
    | undefined;
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
  const toolbar = node('div', { class: 've-scene-toolbar' }),
    actions = node('div', { class: 've-view-actions' }),
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
  const completeFrame = frame.scope === 'scene';
  const showHistory = parameters.length > 0 && retainHistory && showNavigation;
  const sheet = completeFrame ? node('div') : root;
  const composition = sceneFrame(completeFrame ? sheet : stage, frame);
  const conditionsId = `ve-conditions-${++shellSerial}`,
    conditions = node('div', {
      id: conditionsId,
      class: 've-scene-conditions',
      popover: 'auto',
      role: 'dialog',
      'aria-label': 'Условия объяснения',
    }),
    conditionsButton = node(
      'button',
      {
        type: 'button',
        class: 've-conditions-trigger',
        popovertarget: conditionsId,
        'aria-expanded': 'false',
        'aria-controls': conditionsId,
        hidden: '',
      },
      'Условия',
    ),
    header = node('div', { class: 've-scene-header' }),
    conditionsTitle = node('div', { class: 've-conditions-heading' });
  conditionsTitle.append(
    node('h2', {}, title),
    node(
      'button',
      {
        type: 'button',
        popovertarget: conditionsId,
        popovertargetaction: 'hide',
        'aria-label': 'Закрыть условия',
      },
      '×',
    ),
  );
  conditions.append(conditionsTitle);
  header.append(heading, conditionsButton);
  heading.title = title;
  let subjectWidth = frame.width,
    subjectHeight = frame.height;
  cleanups.add(composition.dispose);
  if (completeFrame) toolbar.append(modes, actions);
  sheet.append(
    completeFrame ? header : heading,
    ...(completeFrame ? [toolbar] : [modes, actions]),
    fields,
    completeFrame ? stage : composition.element,
  );
  if (captions && !completeFrame && (captions === true || captions.placement !== 'below'))
    stage.append(caption);
  else sheet.append(caption);
  if (completeFrame) root.append(composition.element);
  root.append(controls, status);
  if (completeFrame) root.append(conditions);
  let shownPresentation: SceneFramePresentation | undefined;
  const visibleContent = (element: Element): boolean => {
    if (element.hasAttribute('hidden') || getComputedStyle(element).display === 'none')
      return false;
    return (
      element.matches('input,textarea,button') ||
      [...element.childNodes].some((child) =>
        child instanceof Element ? visibleContent(child) : Boolean(child.textContent?.trim()),
      )
    );
  };
  function placeConditions() {
    if (!conditions.matches(':popover-open')) return;
    const viewport = window.visualViewport,
      left = viewport?.offsetLeft || 0,
      top = viewport?.offsetTop || 0,
      width = viewport?.width || innerWidth,
      height = viewport?.height || innerHeight,
      button = conditionsButton.getBoundingClientRect(),
      panelWidth = Math.min(520, width - 16, composition.element.getBoundingClientRect().width);
    conditions.style.width = `${Math.max(0, panelWidth)}px`;
    conditions.style.maxHeight = `${Math.max(0, height - 16)}px`;
    conditions.style.left = `${Math.max(left + 8, Math.min(button.right - panelWidth, left + width - panelWidth - 8))}px`;
    conditions.style.top = `${Math.max(top + 8, Math.min(button.bottom + 6, top + height - conditions.getBoundingClientRect().height - 8))}px`;
  }
  function updateChrome(preserveFocus = false) {
    if (!completeFrame || abort.signal.aborted) return;
    const toolbarVisible = [...toolbar.children].some(visibleContent);
    if (toolbar.hidden === toolbarVisible) toolbar.hidden = !toolbarVisible;
    const focused = document.activeElement,
      ownedFocus =
        focused instanceof HTMLElement && (toolbar.contains(focused) || fields.contains(focused)),
      compact = composition.element.getBoundingClientRect().width < 640,
      hasUI = toolbarVisible || visibleContent(fields),
      popup = shownPresentation === 'explanation' && compact && hasUI,
      hasConditions = popup || showHistory;
    sheet.dataset.compactChrome = String(compact);
    conditionsButton.hidden = !hasConditions;
    header.hidden = heading.hidden && !hasConditions;
    if (shownPresentation === 'stage') {
      if (header.parentElement !== root) controls.before(header);
    } else if (header.parentElement !== sheet) sheet.prepend(header);
    const parent = shownPresentation === 'stage' ? root : popup ? conditions : sheet;
    const moved = toolbar.parentElement !== parent || fields.parentElement !== parent;
    const leavingConditions =
      moved && parent !== conditions && toolbar.parentElement === conditions;
    const keepEdit = moved && preserveFocus && ownedFocus,
      restoreFocus = keepEdit && document.hasFocus();
    if (keepEdit)
      for (const controls of [toolbar, fields]) controls.dataset.sceneControlsMoving = '';
    try {
      if ((!hasConditions || leavingConditions) && conditions.matches(':popover-open'))
        conditions.hidePopover();
      if (moved) {
        if (parent === conditions) {
          const historyBar = conditions.querySelector(':scope > .ve-experiment-history');
          conditions.insertBefore(toolbar, historyBar);
          conditions.insertBefore(fields, historyBar);
        } else if (parent === root) controls.before(toolbar, fields);
        else stage.before(toolbar, fields);
      }
      // Reparenting a native field emits blur/focus. Its draft and history gesture
      // still belong to the same edit; only an actual departure commits them.
      if (restoreFocus) {
        if (popup && !conditions.matches(':popover-open')) conditions.showPopover();
        if (focused.checkVisibility() && document.activeElement !== focused)
          focused.focus({ preventScroll: true });
      }
    } finally {
      if (keepEdit)
        for (const controls of [toolbar, fields]) delete controls.dataset.sceneControlsMoving;
    }
    placeConditions();
  }
  conditions.addEventListener(
    'toggle',
    () => {
      conditionsButton.setAttribute('aria-expanded', String(conditions.matches(':popover-open')));
      placeConditions();
    },
    options,
  );
  const dismissConditions = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (conditions.matches(':popover-open')) conditions.hidePopover();
    conditionsButton.focus({ preventScroll: true });
  };
  conditionsTitle.querySelector('button')!.addEventListener('click', dismissConditions, options);
  conditions.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) dismissConditions(event);
    },
    options,
  );
  root.addEventListener('scene-frame-resize', () => updateChrome(true), options);
  // Actions/chapter navigation are public extension points of this shell.
  const chromeObserver = new MutationObserver(() => updateChrome());
  if (completeFrame)
    chromeObserver.observe(toolbar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
  cleanups.add(() => {
    chromeObserver.disconnect();
    if (conditions.matches(':popover-open')) conditions.hidePopover();
  });
  function setPresentation(next: SceneFramePresentation) {
    assertLive();
    if (shownPresentation === next) return;
    shownPresentation = next;
    root.dataset.presentation = next;
    root.dataset.paper = String(next === 'stage' ? false : (paper ?? appearance === 'sketch'));
    heading.hidden = !showHeading || next === 'stage';
    if (completeFrame) {
      if (next === 'stage') controls.before(caption);
      else stage.after(caption);
    }
    updateChrome(true);
    composition.resize();
    updateChrome(true);
  }
  setPresentation(presentation);
  let transition: ((mode: 'story' | 'explore') => void) | undefined;
  let mode: 'story' | 'explore' = 'explore';
  let player: { dispose(): void } | undefined;
  let acceptedCondition = {};
  function refresh() {
    for (const [key, control] of inputs)
      if (control.value !== values[key]) control.setValue(values[key]!);
  }
  function changeValues(next: Record<string, ControlValue>) {
    if (history) history.change(() => applyValues(next));
    else applyValues(next);
  }
  function applyValues(
    next: Record<string, ControlValue>,
    position?: { time: number; mode: 'story' | 'explore' },
  ) {
    assertLive();
    if (inputStory) {
      try {
        inputStory(next, position);
      } finally {
        refresh();
      }
      onInput({ ...values });
      return;
    }
    const previous = { ...values },
      previousCondition = acceptedCondition;
    try {
      Object.assign(values, next);
      onInput({ ...values });
    } catch (error) {
      Object.assign(values, previous);
      acceptedCondition = previousCondition;
      refresh();
      throw error;
    }
    acceptedCondition = {};
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
    acceptedCondition = {};
    controls.hidden = false;
    controls.inert = false;
    caption.hidden = exploration === 'model' && mode !== 'story';
    fields.hidden = mode === 'story' || !fields.childElementCount;
    updateChrome();
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
  root.dataset.appearance = appearance;
  const handle = mountScene(
    root,
    {
      snapshot: () => ({ ...values }),
      get condition() {
        return acceptedCondition;
      },
      presentation: () => inspectPresentation(stage),
      exportSVG: () => exportCompositionSVG(completeFrame ? sheet : stage),
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
      setValues: (next, options) => (options?.restoring ? applyValues(next) : changeValues(next)),
      get restoreValues() {
        return inputStory ? applyValues : undefined;
      },
      view: () => view,
    },
  );
  if (parameters.length && retainHistory) {
    const bar = node('div', { class: 've-experiment-history', hidden: '' });
    const undo = node('button', { type: 'button', disabled: '' }, 'Отменить условие'),
      redo = node('button', { type: 'button', disabled: '' }, 'Повторить');
    bar.append(undo, redo);
    // Undo belongs to the editing session, not the exported subject or its geometry.
    if (completeFrame) conditions.append(bar);
    else controls.before(bar);
    bar.hidden = !showNavigation;
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
    get layout(): SceneLayout {
      // Hidden preparation keeps the last logical space without inventing a visible frame.
      // clientWidth rounds fractional CSS geometry and would invent a second scale.
      const bounds = stage.getBoundingClientRect(),
        frameBounds = composition.element.getBoundingClientRect(),
        scale = frameBounds.width > 0 ? frameBounds.width / frame.width : 1;
      if (bounds.width > 0) subjectWidth = bounds.width / scale;
      if (bounds.height > 0) subjectHeight = bounds.height / scale;
      return Object.freeze({
        width: subjectWidth,
        height: subjectHeight,
        displayWidth: bounds.width,
        displayHeight: bounds.height,
        scale,
        compact: frameBounds.width < 640,
      });
    },
    get mode() {
      return mode;
    },
    setMode,
    setPresentation,
    input: changeValues,
    syncParameters(next: Record<string, ControlValue>) {
      assertLive();
      if (inputStory) throw new Error('Story parameters belong to story.input()');
      if (Object.entries(next).some(([key, value]) => values[key] !== value)) {
        Object.assign(values, next);
        acceptedCondition = {};
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
      if (player) modes.hidden = !showNavigation || (!count && !view);
      updateChrome();
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
      modes.hidden = !showNavigation;
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
    inputStory = (next, position) => {
      if (position) controller.restoreInputs(next as Partial<P>, position);
      else controller.input(next as Partial<P>);
    };
    playback = () => controller.player.state.playing;
    const chapters = chapterNavigation(
      heading,
      controller.sheet.script.segments ?? [],
      controller.seek,
      completeFrame ? toolbar : undefined,
      showHeading && showNavigation,
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
    const requestLayout = () => {
      if (layoutFrame) return;
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        controller.update();
      });
    };
    const layout = new ResizeObserver(() => {
      const width = stage.clientWidth,
        height = stage.clientHeight;
      if (width === stageWidth && height === stageHeight) return;
      stageWidth = width;
      stageHeight = height;
      requestLayout();
    });
    layout.observe(stage);
    // The logical canvas can stay fixed while its displayed size crosses a layout breakpoint.
    root.addEventListener('scene-frame-resize', requestLayout);
    let unsubscribe = () => {};
    player = {
      dispose() {
        layout.disconnect();
        root.removeEventListener('scene-frame-resize', requestLayout);
        cancelAnimationFrame(layoutFrame);
        unsubscribe();
        ui.dispose();
        chapters.dispose();
        stopSeeking();
        controller.dispose();
      },
    };
    storyButton.hidden = false;
    modes.hidden =
      !showNavigation ||
      (![...inputs.values()].some((control) => !control.element.hidden) && !view);
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
      chapters.update(controller.currentChapter);
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
      // A silent clock has no sound preference to carry into a narrated build.
      // Expose the media capability only when there is actual audio to mute.
      get mute() {
        return controller.player.state.hasAudio ? controller.player.mute : undefined;
      },
      setRate: controller.player.rate,
      get muted() {
        const state = controller.player.state;
        return state.hasAudio ? state.muted : undefined;
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
      get condition() {
        return controller.condition;
      },
      subject: controller.subject,
      get rendering(): SceneRendering {
        const moment = (value: StoryMoment<P, S>) => ({
          time: value.time,
          chapter: value.chapter,
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
      if (controller.waiting) return;
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
export const SceneShell = { mount, ready: loadFonts, frame: sceneFrame };
