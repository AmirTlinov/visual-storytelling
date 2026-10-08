import { clamp, svg } from './dom.js';
import { lettering } from './lettering.js';
import { measureText } from './text-measure.js';

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
  // Wrapping candidates need font advances, not hundreds of invisible pen strokes.
  // Only the final rows become lettering; their actual ink is checked below.
  const measure = svg('text', {
    'font-size': size,
    'font-family': 'SketchPencil,SketchShantell,sans-serif',
    'aria-hidden': 'true',
    opacity: 0,
  });
  measure.style.whiteSpace = 'pre';
  element.append(measure);
  const widths = new Map<string, number>();
  const rows: ReturnType<typeof lettering>[] = [];
  let previous = '',
    count = 0,
    progress = 1;
  let lengths: number[] = [];
  const write = () => {
    const total = lengths.reduce((sum, length) => sum + length, 0);
    let offset = 0;
    rows.forEach((row, i) => {
      const length = lengths[i]!;
      row.write(clamp((progress * total - offset) / length));
      offset += length;
    });
  };
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  const widthOf = (text: string) => {
    if (!widths.has(text)) {
      measure.textContent = text;
      if (widths.size >= 512) widths.delete(widths.keys().next().value!);
      widths.set(
        text,
        measureText(measure, (text) => text.getComputedTextLength()),
      );
    }
    return widths.get(text)!;
  };
  return {
    element,
    get bounds() {
      return { ...bounds };
    },
    /** One reversible pen pass across wrapped lines, driven by the caller's clock. */
    write(value: number) {
      if (!Number.isFinite(value)) throw new Error('Paragraph write progress must be finite');
      progress = clamp(value);
      write();
    },
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
        for (let i = 0; i < lines.length; i++) {
          rows[i] ??= lettering(element, '', { size });
          rows[i]!.text(lines[i]!);
          // Font advances and visible pencil overhang differ slightly. Repair the
          // rare overfull row using the rendered ink, never by shrinking the text.
          let remainder = '';
          while (rows[i]!.bounds.width > width && [...lines[i]!].length > 1) {
            const line = lines[i]!;
            const space = line.lastIndexOf(' ');
            const cut = space > 0 ? space : line.length - [...line].at(-1)!.length;
            remainder = line.slice(cut) + remainder;
            lines[i] = line.slice(0, cut).trimEnd();
            rows[i]!.text(lines[i]!);
          }
          if (remainder) lines.splice(i + 1, 0, remainder.trim());
          rows[i]!.at(0, i * leading);
        }
        while (rows.length > lines.length) rows.pop()!.dispose();
        const boxes = rows.map((row) => row.bounds);
        const left = Math.min(...boxes.map((b) => b.x)),
          top = Math.min(...boxes.map((b) => b.y));
        bounds = {
          x: left,
          y: top,
          width: Math.max(...boxes.map((b) => b.x + b.width)) - left,
          height: Math.max(...boxes.map((b) => b.y + b.height)) - top,
        };
        count = lines.length;
        lengths = lines.map((line) => Math.max(1, [...line].length));
        write();
        previous = key;
        measure.textContent = '';
      }
      element.setAttribute('transform', `translate(${x} ${y})`);
      return count * leading;
    },
    dispose() {
      rows.forEach((row) => row.dispose());
      measure.remove();
      element.remove();
    },
  };
}
