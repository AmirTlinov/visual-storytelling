import { html } from './ink/dom.js';
import { theme, type Theme } from './ink/palette.js';
import { SceneShell } from './scene.js';
import type { Story } from './story/story.js';
/** Convenience construction of the shared shell for stateAt/render stories. */
export function notebook(
  parent: HTMLElement,
  options: { title: string; subtitle?: string; theme?: Theme },
) {
  const element = html('section', 've-scene vs-notebook');
  parent.append(element);
  const appearance = theme(element, options.theme),
    shell = SceneShell.mount(element, { title: options.title, paper: false });
  shell.stage.style.height = 'auto';
  shell.fields.hidden = false;
  if (options.subtitle)
    element.querySelector('h1')!.after(html('p', 'vs-subtitle', options.subtitle));
  return {
    element,
    stage: shell.stage,
    parameters: shell.fields,
    footer: element.querySelector<HTMLElement>('[data-player]')!,
    theme: appearance.set,
    attach<P, K extends string>(story: Story<P, K>) {
      shell.attachController(story);
    },
    dispose() {
      shell.dispose();
      appearance.dispose();
      element.remove();
    },
  };
}
