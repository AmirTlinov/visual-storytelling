import type { Surface } from '../ink/surface.js';
import type { Pigment } from '../ink/palette.js';
import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { InkDrawing } from '../story/ink-chapter.js';
import type { ChapterFrame } from '../story/composition.js';

export interface ComparisonOptions {
  items: readonly { id: string; label: string; pigment?: Pigment }[];
  values(frame: ChapterFrame): Readonly<Record<string, number>>;
  /** Shared upper bound keeps scale stable across interaction and animation. */
  maximum: number;
  unit?: string;
  conclusion?(frame: ChapterFrame): string;
}
/** Values grow against one fixed ruler; labels follow their own bars at every intermediate frame. */
export function comparisonDiagram(view: Surface, options: ComparisonOptions): InkDrawing {
  if (
    !(options.maximum > 0) ||
    !Number.isFinite(options.maximum) ||
    !options.items.length ||
    new Set(options.items.map((i) => i.id)).size !== options.items.length
  )
    throw new Error('Comparison needs unique items and a positive shared maximum');
  const marks = options.items.map((item, i) => {
    const mark = object(view.layer, item.id, item.pigment ?? (i % 2 ? 'orange' : 'blue'));
    mark.element.dataset.reviewId = item.id;
    const bar = view.pen.rect(mark.content, `${item.id}-bar`, 0, 0, 1, 28, { fill: 'marker' });
    const label = lettering(mark.content, item.label, { size: 23 });
    const number = lettering(mark.content, '', { size: 23, tabular: true });
    return { mark, bar, label, number };
  });
  const ruler = object(view.layer, 'comparison-ruler', 'ink');
  const conclusion = lettering(ruler.content, '', { size: 23 });
  let signature = '',
    clear: (() => void)[] = [],
    snapshot: unknown;
  return {
    render(frame, { width, height }) {
      const left = 24,
        right = width - 24,
        span = right - left,
        top = 28,
        bottom = height - (options.conclusion ? 80 : 48);
      const key = `${width}:${height}`;
      if (key !== signature) {
        signature = key;
        clear.forEach((f) => f());
        clear = [];
        for (let i = 0; i <= 4; i++) {
          const x = left + (span * i) / 4;
          const line = view.pen.path(ruler.content, `ruler-${i}`, `M${x} 18V${bottom + 10}`, {
            width: 0.5,
            pencil: true,
          });
          const label = lettering(
            ruler.content,
            `${Number(((options.maximum * i) / 4).toFixed(2))}`,
            { x, y: bottom + 30, size: 17 },
          );
          clear.push(line.dispose, label.dispose);
        }
      }
      const values = options.values(frame),
        drawn: Record<string, number> = {};
      const p =
        frame.mode === 'explore' || frame.reduced
          ? 1
          : Math.min(1, Math.max(0, frame.progress * 1.4));
      for (const [i, item] of options.items.entries()) {
        const value = values[item.id];
        if (value === undefined || !Number.isFinite(value) || value < 0 || value > options.maximum)
          throw new Error(
            `Comparison ${item.id} is outside the shared [0, ${options.maximum}] scale`,
          );
        const visible = value * p,
          w = Math.max(0.001, (span * visible) / options.maximum),
          y = top + ((bottom - top) * (i + 0.5)) / marks.length;
        const m = marks[i]!;
        m.mark.at(left, y);
        m.label.at(Math.max(m.label.bounds.width / 2, 0), -14);
        m.bar.update(`M0 0H${w}V28H0Z`, { x: 0, y: 0, width: w, height: 28 });
        m.number.text(`${Number(visible.toFixed(1))}${options.unit ? ` ${options.unit}` : ''}`);
        m.number.at(
          Math.min(
            span - m.number.bounds.width / 2,
            Math.max(w + 14 + m.number.bounds.width / 2, m.number.bounds.width / 2),
          ),
          21,
        );
        drawn[item.id] = visible;
      }
      const result = p === 1 ? (options.conclusion?.(frame) ?? '') : '';
      conclusion.text(result);
      conclusion.at(width / 2, height - 9);
      snapshot = { values, drawn, maximum: options.maximum, conclusion: result };
    },
    snapshot: () => snapshot,
    dispose() {
      clear.forEach((f) => f());
      conclusion.dispose();
      ruler.dispose();
      for (const m of marks) {
        m.label.dispose();
        m.number.dispose();
        m.bar.dispose();
        m.mark.dispose();
      }
    },
  };
}
