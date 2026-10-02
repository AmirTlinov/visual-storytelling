import { svg } from './dom.js';
import { SketchMotion } from './motion.js';
import { glyphs } from './glyphs.js';
export interface LetteringOptions {
  x?: number;
  y?: number;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  tabular?: boolean;
}
/** A label owns its text and pen strokes together; the pen geometry has one implementation. */
export function lettering(
  parent: SVGElement,
  initial: string | number,
  options: LetteringOptions = {},
) {
  const element = svg('g', { class: 'vs-lettering', role: 'img' });
  parent.append(element);
  const label = svg('text', {
    'font-size': options.size ?? 24,
    'font-family': 'SketchPencil,SketchShantell,sans-serif',
    fill: 'currentColor',
  });
  label.style.whiteSpace = 'pre';
  if (options.tabular) label.style.fontVariantNumeric = 'tabular-nums';
  element.append(label);
  let value = '',
    width = 0,
    progress = 1;
  const position = () =>
    element.setAttribute(
      'transform',
      `translate(${(options.x ?? 0) - (options.anchor === 'start' ? 0 : options.anchor === 'end' ? width : width / 2)} ${options.y ?? 0})`,
    );
  const write = (amount: number) => {
    progress = amount;
    if ([...value].every((c) => /\s/.test(c) || glyphs[c])) SketchMotion.write(label, amount);
    else label.style.opacity = amount >= 1 ? '1' : '0';
    element.style.visibility = amount > 0 ? 'visible' : 'hidden';
  };
  const text = (next: string | number) => {
    if (String(next) === value && label.textContent) return;
    SketchMotion.resetText(label);
    value = String(next);
    label.textContent = value;
    element.setAttribute('aria-label', value);
    width = label.getComputedTextLength();
    position();
    write(progress);
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
      SketchMotion.resetText(label);
      element.remove();
    },
  };
}
export type Lettering = ReturnType<typeof lettering>;
