import type { Story } from './story/story.js';
import { player as statePlayer } from './controls/player.js';
import type { MediaClock } from './story/clock.js';
import type { AudioStoryOptions } from './story/audio.js';
export interface SceneOptions {
  title: string;
  paper?: boolean;
  parameters?: (ControlParameter & { key: string })[];
  onInput?: (values: Record<string, ControlValue>) => void;
  onMode?: (mode: 'story' | 'explore') => void;
  /** View-only exploration leaves narration and model time running. */
  exploration?: 'model' | 'view';
}
import { SketchControls, type ControlParameter, type ControlValue } from './controls/fields.js';
import { resolveMedia } from './story/media.js';
import { SketchPlayer } from './story/audio.js';
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
  { title, paper = true, parameters = [], onInput = () => {}, onMode = () => {}, exploration = 'model' }: SceneOptions,
) {
  const abort = new AbortController(),
    options = { signal: abort.signal };
  const values = Object.fromEntries(parameters.map((p) => [p.key, p.value]));
  const heading = node('h1', {}, title),
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
      setMode('explore');
      values[p.key] = value;
      refresh();
      onInput({ ...values });
    });
    fields.append(control.element);
    inputs.set(p.key, control);
  }
  const actions = node('div', { class: 've-view-actions' }),
    controls = node('div', { 'data-player': '', hidden: '' });
  const caption = node('p', { class: 'caption sr-only', 'data-caption': '', role: 'status' }),
    status = node('p', { class: 've-status', role: 'alert' });
  root.append(heading, modes, stage, fields, actions, controls, caption, status);
  let transition: ((mode: 'story' | 'explore') => void) | undefined;
  let mode: 'story' | 'explore' = 'explore';
  let media: Pick<MediaClock, 'pause'> | undefined,
    player: { seek(time: number): void; update(): void; dispose(): void } | undefined;
  function refresh() {
    for (const [key, control] of inputs) control.setValue(values[key]!);
  }
  function setMode(next: 'story' | 'explore') {
    if (next === mode || (next === 'story' && !player)) return;
    mode = next;
    transition?.(next);
    if (exploration === 'model') media?.pause();
    controls.hidden = exploration === 'model' && mode !== 'story';
    fields.hidden = mode === 'story' || !fields.childElementCount;
    storyButton.setAttribute('aria-pressed', String(mode === 'story'));
    exploreButton.setAttribute('aria-pressed', String(mode === 'explore'));
    root.dataset.sceneMode = mode;
    onMode(mode);
    if (mode === 'story') player?.update();
  }
  storyButton.addEventListener('click', () => setMode('story'), options);
  exploreButton.addEventListener('click', () => setMode('explore'), options);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) media?.pause();
    },
    options,
  );
  refresh();
  root.dataset.sceneMode = mode;
  root.dataset.paper = String(paper);
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
    setParameters(next: Record<string, ControlValue>) {
      if (Object.entries(next).some(([key, value]) => values[key] !== value)) {
        Object.assign(values, next);
        refresh();
      }
    },
    attachStory({
      audio,
      timing,
      render,
      stops,
      sound = Boolean(audio),
    }: Omit<AudioStoryOptions, 'audio'> & { audio: HTMLAudioElement | null }) {
      player?.dispose();
      transition = undefined;
      media?.pause();
      const activeMedia = resolveMedia(audio, timing.duration);
      media = activeMedia;
      if (audio?.dataset.src && !audio.getAttribute('src')) audio.src = audio.dataset.src;
      storyButton.hidden = false;
      modes.hidden = false;
      const mounted = SketchPlayer.mount(root, {
        audio: activeMedia,
        timing,
        stops,
        sound,
        render: (t, cues, reduced) => {
          if (mode === 'story' || exploration === 'view') render(t, cues, reduced);
        },
      });
      player = mounted;
      return {
        review: mounted.review,
        seek: (time: number) => {
          if (exploration === 'model') setMode('story');
          player!.seek(time);
        },
        pause: () => activeMedia.pause(),
        get currentTime() {
          return activeMedia.currentTime;
        },
      };
    },
    attachController<P, K extends string>(controller: Story<P, K>) {
      player?.dispose();
      media?.pause();
      media = { pause: controller.player.pause };
      transition = (next) => {
        if (controller.mode !== next) {
          if (next === 'explore') controller.explore(controller.values);
          else controller.resume();
        }
      };
      const ui = statePlayer(controls, {
        transport: controller.player,
        stops: controller.sheet.script.segments?.map((s) => s.start),
        onSeek: (t) => {
          setMode('story');
          controller.seek(t);
        },
        onPlay: () => setMode('story'),
      });
      let unsubscribe = () => {};
      player = {
        seek: controller.seek,
        update: () => controller.resume(),
        dispose() {
          unsubscribe();
          ui.dispose();
          controller.dispose();
        },
      };
      storyButton.hidden = false;
      modes.hidden = false;
      unsubscribe = controller.subscribe((next) => setMode(next));
    },
    dispose() {
      media?.pause();
      player?.dispose();
      abort.abort();
      for (const control of inputs.values()) control.dispose();
      root.replaceChildren();
    },
  };
}
export const SceneShell = { mount };
