import { SceneShell } from '../scene.js';
import { widgetState } from '../host/widget-state.js';
import { compileScore } from './score.js';
import { characterStage } from './stage.js';
import type { CharacterStoryOptions } from './types.js';

async function mount(root: HTMLElement, options: CharacterStoryOptions) {
  root.querySelector(':scope > [data-character-error]')?.remove();
  const score = compileScore(options);
  await SceneShell.ready();
  const shell = SceneShell.mount(root, { title: options.title, paper: false, frame: options.set });
  root.classList.add('ve-character-story');
  root.style.setProperty('--ve-character-aspect', String(options.set.width / options.set.height));
  shell.onDispose(() => {
    root.classList.remove('ve-character-story');
    root.style.removeProperty('--ve-character-aspect');
  });
  try {
    const drawing = await characterStage(shell.stage, options, score);
    shell.onDispose(drawing.dispose);
    const story = shell.attachStory({
      script: score.script,
      audio: options.audio,
      stateAt: (frame) => frame.time,
      render(time, frame) {
        drawing.render(time, frame.reduced);
        for (const beat of options.beats) {
          frame.has(beat.id);
          frame.target(beat.id, 'cast');
          for (const prop of Object.keys(beat.props ?? {})) frame.target(beat.id, prop);
        }
      },
    });
    root.scene!.snapshot = drawing.snapshot;
    root.scene!.checkpoints = options.beats.map((beat) => score.script.cues[beat.id]!.start);
    if (options.remember) {
      let restoring = false,
        previous = 0;
      const restore = (saved: { privateContent?: unknown } | null | undefined) => {
        const value = saved?.privateContent as
          | { version?: number; time?: number; title?: string }
          | undefined;
        if (value?.version !== 1 || value.title !== options.title || !Number.isFinite(value.time))
          return;
        restoring = true;
        try {
          story.pause();
          story.seek(value.time!);
          previous = story.currentTime;
        } finally {
          restoring = false;
        }
      };
      const state = widgetState(options.remember, restore);
      restore(state.read());
      previous = story.currentTime;
      const save = () => {
        if (restoring || previous === story.currentTime) return;
        previous = story.currentTime;
        state.save({
          modelContent: { story: options.title, time: previous },
          privateContent: { version: 1, title: options.title, time: previous },
        });
      };
      const unsubscribe = story.player.subscribe((value) => {
        if (!value.playing) save();
      });
      window.addEventListener('pagehide', save);
      shell.onDispose(() => {
        save();
        unsubscribe();
        state.dispose();
        window.removeEventListener('pagehide', save);
      });
    }
    return { scene: root.scene!, shell, story };
  } catch (error) {
    shell.dispose();
    const message = document.createElement('p');
    message.dataset.characterError = '';
    message.setAttribute('role', 'alert');
    message.textContent = `Не удалось открыть персонажей: ${error instanceof Error ? error.message : String(error)}`;
    root.append(message);
    throw error;
  }
}
export const CharacterStory = { mount };
