import { html } from './ink/dom.js';
import { theme, type Theme } from './ink/palette.js';
import { button } from './controls/button.js';
import { player } from './controls/player.js';
import type { Story } from './story/story.js';

export function notebook(
  parent: HTMLElement,
  options: { title: string; subtitle?: string; theme?: Theme },
) {
  const element = html('section', 'vs-notebook');
  const header = html('header', 'vs-heading');
  const title = html('h1', undefined, options.title);
  header.append(title);
  if (options.subtitle) header.append(html('p', undefined, options.subtitle));
  const stage = html('div', 'vs-stage');
  const parameters = html('div', 'vs-parameters');
  const footer = html('div', 'vs-footer');
  element.append(header, stage, parameters, footer);
  parent.append(element);
  const appearance = theme(element, options.theme);
  const cleanup: (() => void)[] = [];
  let attached = false;
  return {
    element,
    stage,
    parameters,
    footer,
    theme: appearance.set,
    attach<P, K extends string>(story: Story<P, K>) {
      if (attached) throw new Error('A notebook has one story owner');
      attached = true;
      const back = button('Вернуться к рассказу', () => story.resume());
      back.element.classList.add('vs-return');
      parameters.after(back.element);
      const ui = player(footer, {
        transport: story.player,
        stops: story.sheet.script.segments?.map((part) => part.start),
        onSeek: story.seek,
        onPlay: story.resume,
      });
      const unsubscribe = story.subscribe((mode) => {
        back.element.hidden = mode !== 'explore';
        element.dataset.mode = mode;
      });
      const caption = html('p', 'vs-sr');
      caption.setAttribute('aria-live', 'polite');
      footer.append(caption);
      let previous = '';
      const stopCaption = story.player.subscribe((state) => {
        const text =
          story.sheet.script.segments?.findLast((segment) => state.time >= segment.start)?.text ??
          '';
        if (text !== previous) {
          caption.textContent = text;
          previous = text;
        }
      });
      cleanup.push(() => {
        stopCaption();
        unsubscribe();
        back.dispose();
        ui.dispose();
        story.dispose();
      });
    },
    dispose() {
      for (const stop of cleanup) stop();
      appearance.dispose();
      element.remove();
    },
  };
}
