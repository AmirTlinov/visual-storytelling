import { html } from './ink/dom.js';
import { theme, type Theme } from './ink/palette.js';
import { SceneShell } from './scene.js';
import type { SceneOptions } from './scene.js';
import type { Story } from './story/story.js';
/** Convenience construction of the shared shell for stateAt/render stories. */
export function notebook(
  parent: HTMLElement,
  options: {
    title: string;
    theme?: Theme;
    parameters?: SceneOptions['parameters'];
  },
) {
  const element = html('section', 've-scene vs-notebook');
  parent.append(element);
  const appearance = theme(element, options.theme),
    shell = SceneShell.mount(element, {
      title: options.title,
      paper: false,
      parameters: options.parameters,
    });
  shell.fields.hidden = false;
  shell.onDispose(appearance.dispose);
  shell.onDispose(() => element.remove());
  return {
    element,
    stage: shell.stage,
    parameters: shell.fields,
    footer: element.querySelector<HTMLElement>('[data-player]')!,
    theme: appearance.set,
    attach<P, K extends string, S>(story: Story<P, K, S>) {
      return shell.attachController(story);
    },
    onDispose: shell.onDispose,
    dispose: shell.dispose,
  };
}
