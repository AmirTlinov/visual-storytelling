import { bookTransition } from './transition.js';
import { PaperPage, paperSize, type BookPage, type PageFrame, type PaperPalette } from './paper.js';
import { pigments } from '../ink/palette.js';
import type { ControlValue } from '../controls/fields.js';

export interface BookState extends PageFrame {
  open: number;
  /** A completed camera flight releases the page to ordinary exploration. */
  focus: number;
  page: number;
  turn: number;
}
/** A transparent measured workspace with a short book opening and page transitions. */
function mount(
  parent: HTMLElement,
  options: {
    topic: string;
    pages: readonly BookPage[];
    values?: Readonly<Record<string, ControlValue>>;
  },
) {
  if (!options.pages.length) throw new Error('A book needs at least one page');
  const current = new PaperPage(),
    previous = new PaperPage();
  const animation = document.createElement('div');
  Object.assign(animation.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  animation.setAttribute('aria-hidden', 'true');
  parent.append(animation);
  const transition = bookTransition(animation, { topic: options.topic, current, previous });
  {
    const paper = current;
    const canvas = paper.canvas;
    canvas.hidden = true;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', options.topic);
    Object.assign(canvas.style, { position: 'absolute', inset: '0', cursor: 'default' });
    Object.assign(canvas, {
      __visualReview: () => {
        const box = canvas.getBoundingClientRect();
        return {
          objects: paper.marks.map((mark) => ({
            id: mark.id,
            visible: !canvas.hidden,
            x: box.x + (mark.box.x * box.width) / paperSize.width,
            y: box.y + (mark.box.y * box.height) / paperSize.height,
            width: (mark.box.width * box.width) / paperSize.width,
            height: (mark.box.height * box.height) / paperSize.height,
          })),
        };
      },
    });
    parent.append(canvas);
  }
  const swatch = document.createElement('span');
  swatch.hidden = true;
  parent.append(swatch);
  const palette: PaperPalette = {};
  let state: BookState | undefined;
  const draw = (index: number, paper: PaperPage, frame: PageFrame) => {
    const definition = options.pages[index]!;
    const resolved: PageFrame = {
      ...frame,
      values: frame.values ?? { ...options.values, ...definition.valuesAt?.(frame) },
      mode: frame.mode ?? 'story',
    };
    paper.reset(palette);
    paper.context.save();
    try {
      definition.draw(paper, resolved);
      if (paper === current)
        paper.canvas.setAttribute(
          'aria-label',
          definition.describe?.(resolved) ??
            (resolved.mode === 'explore' ? definition.title : definition.text),
        );
    } finally {
      paper.context.restore();
    }
  };
  const render = (next: BookState) => {
    if (!Number.isInteger(next.page) || next.page < 0 || next.page >= options.pages.length)
      throw new Error('Unknown book page');
    if (![next.time, next.progress, next.open, next.focus, next.turn].every(Number.isFinite))
      throw new Error('Book state must be finite');
    state = { ...next };
    const flat = next.mode === 'explore' || next.reduced || (next.focus >= 1 && next.turn >= 1);
    animation.hidden = flat;
    current.canvas.hidden = !flat;
    draw(next.page, current, next);
    if (!flat) {
      if (next.page > 0)
        draw(next.page - 1, previous, {
          time: options.pages[next.page - 1]!.seconds,
          progress: 1,
          reduced: next.reduced,
        });
      transition.render(next);
    }
  };
  const theme = () => {
    for (const name of [...Object.keys(pigments), 'grid-ink']) {
      swatch.style.color = `var(--ve-${name})`;
      palette[name] = getComputedStyle(swatch).color;
    }
    if (state) render(state);
  };
  const observer = new MutationObserver(theme);
  for (let node: HTMLElement | null = parent; node; node = node.parentElement)
    observer.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', theme);
  window.addEventListener('openai:set_globals', theme);
  const dispose = () => {
    observer.disconnect();
    media.removeEventListener('change', theme);
    window.removeEventListener('openai:set_globals', theme);
    transition.dispose();
    animation.remove();
    swatch.remove();
    for (const paper of [current, previous]) {
      Reflect.deleteProperty(paper.canvas, '__visualReview');
      paper.canvas.remove();
    }
  };
  try {
    theme();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    render,
    snapshot: () => ({ state, paper: paperSize, marks: current.marks }),
    dispose,
  };
}
export const BookStage = { mount };
