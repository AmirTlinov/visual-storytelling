import { svg } from './dom.js';
import { lettering } from './lettering.js';

/** Measured lines keep a readable pen size as the available width changes. */
export function paragraph(
  parent: SVGElement,
  options: { size?: number; lineHeight?: number } = {},
) {
  const element = svg('g');
  parent.append(element);
  const size = options.size ?? 24,
    leading = size * (options.lineHeight ?? 1.4);
  if (![size, leading].every((v) => Number.isFinite(v) && v > 0))
    throw new Error('Paragraph size and leading must be positive');
  const measure = lettering(element, '', { size, anchor: 'start' });
  measure.element.style.opacity = '0';
  measure.element.setAttribute('aria-hidden', 'true');
  const widths = new Map<string, number>();
  const rows: ReturnType<typeof lettering>[] = [];
  let previous = '',
    count = 0;
  const widthOf = (text: string) => {
    if (!widths.has(text)) {
      measure.text(text);
      widths.set(text, measure.bounds.width);
    }
    return widths.get(text)!;
  };
  return {
    element,
    render(text: string, width: number, x: number, y: number) {
      if (!(width > 0) || ![width, x, y].every(Number.isFinite))
        throw new Error('Paragraph needs a finite position and positive width');
      const key = `${width}/${text}`;
      if (key !== previous) {
        const lines: string[] = [];
        for (const source of text.split('\n')) {
          let line = '';
          for (const word of source.split(/\s+/).filter(Boolean)) {
            const next = line ? `${line} ${word}` : word;
            if (line && widthOf(next) > width) {
              lines.push(line);
              line = '';
            }
            if (widthOf(word) <= width) line = line ? `${line} ${word}` : word;
            else
              for (const character of [...word]) {
                if (line && widthOf(line + character) > width) {
                  lines.push(line);
                  line = '';
                }
                line += character;
              }
          }
          lines.push(line);
        }
        while (rows.length > lines.length) rows.pop()!.dispose();
        lines.forEach((line, i) => {
          rows[i] ??= lettering(element, '', { size });
          rows[i]!.text(line);
          rows[i]!.at(0, i * leading);
        });
        count = lines.length;
        previous = key;
        measure.text('');
        widths.clear();
      }
      element.setAttribute('transform', `translate(${x} ${y})`);
      return count * leading;
    },
    dispose() {
      rows.forEach((row) => row.dispose());
      measure.dispose();
      element.remove();
    },
  };
}
