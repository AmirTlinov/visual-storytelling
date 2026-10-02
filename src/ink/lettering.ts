import { glyphs } from './glyphs.js';
import { svg } from './dom.js';
import { strokes } from './strokes.js';

export interface LetteringOptions {
  x?: number;
  y?: number;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
}
export function lettering(
  parent: SVGElement,
  initial: string | number,
  options: LetteringOptions = {},
) {
  const element = svg('g', { class: 'vs-lettering', role: 'img' });
  parent.append(element);
  const size = options.size ?? 24;
  const scale = size / 14;
  let value = '',
    width = 0,
    progress = 1;
  let reveal = (_p: number) => {};
  const position = () =>
    element.setAttribute(
      'transform',
      `translate(${(options.x ?? 0) - (options.anchor === 'start' ? 0 : options.anchor === 'end' ? width : width / 2)} ${options.y ?? 0})`,
    );
  const text = (next: string | number) => {
    if (String(next) === value && element.childElementCount) return;
    value = String(next);
    element.replaceChildren();
    element.setAttribute('aria-label', value);
    let x = 0;
    for (const char of value) {
      const paths = glyphs[char];
      const advance =
        char === ' ' ? size * 0.28 : char === '1' || char === 'і' ? size * 0.43 : size * 0.57;
      if (paths) {
        const letter = svg('g', { transform: `translate(${x} ${-10 * scale}) scale(${scale})` });
        for (const d of paths)
          letter.append(
            svg('path', {
              d,
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': 0.72,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            }),
          );
        element.append(letter);
      } else if (char !== ' ') {
        element.append(svg('text', { x, y: 0, 'font-size': size, fill: 'currentColor' }, char));
      }
      x += advance;
    }
    width = Math.max(0, x - size * 0.09);
    position();
    reveal = strokes(element);
    write(progress);
  };
  const write = (p: number) => {
    progress = p;
    reveal(p);
    element.style.visibility = p > 0 ? 'visible' : 'hidden';
    // Unsupported glyphs remain accessible and use the bundled handwriting font.
    for (const node of element.querySelectorAll('text')) node.style.opacity = p === 1 ? '1' : '0';
  };
  text(initial);
  return {
    element,
    text,
    write,
    get width() {
      return width;
    },
    at(x: number, y: number) {
      options.x = x;
      options.y = y;
      position();
    },
    dispose() {
      element.remove();
    },
  };
}
export type Lettering = ReturnType<typeof lettering>;
