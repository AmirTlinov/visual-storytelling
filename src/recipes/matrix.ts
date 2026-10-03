import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Surface } from '../ink/surface.js';
import type { Pigment } from '../ink/palette.js';

/** One stable cell per value; update changes values without rebuilding the drawing. */
export function matrix(
  view: Surface,
  id: string,
  options: {
    rows: number;
    columns: number;
    cellWidth?: number;
    cellHeight?: number;
    size?: number;
    minSize?: number;
    pigment?: Pigment;
    frame?: 'brackets' | 'cells';
  },
) {
  const { rows, columns } = options;
  const cw = options.cellWidth ?? 58,
    ch = options.cellHeight ?? 38;
  const width = columns * cw,
    height = rows * ch;
  const mark = object(view.layer, id, options.pigment);
  if (options.frame !== 'cells') {
    view.pen.path(
      mark.content,
      `${id}:brackets`,
      `M${-width / 2 + 5} ${-height / 2} H${-width / 2 - 2} V${height / 2} H${-width / 2 + 5} M${width / 2 - 5} ${-height / 2} H${width / 2 + 2} V${height / 2} H${width / 2 - 5}`,
      { width: 1.3 },
    );
  }
  const cells = Array.from({ length: rows * columns }, (_, i) => {
    const x = -width / 2 + ((i % columns) + 0.5) * cw,
      y = -height / 2 + (Math.floor(i / columns) + 0.5) * ch;
    if (options.frame === 'cells')
      view.pen.rect(mark.content, `${id}:cell:${i}`, x - cw / 2 + 2, y - ch / 2, cw - 4, ch, {
        width: 1.2,
      });
    return lettering(mark.content, '—', {
      x,
      y: y + (options.size ?? 23) * 0.25,
      size: options.size ?? 23,
      tabular: true,
      maxWidth: cw - 12,
      minSize: options.minSize,
    });
  });
  return {
    ...mark,
    width,
    height,
    set(values: readonly (readonly (number | string)[])[]) {
      if (values.length !== rows || values.some((row) => row.length !== columns))
        throw new Error('Matrix dimensions must stay fixed');
      values.flat().forEach((value, i) => cells[i]!.text(value));
      mark.element.dataset.values = JSON.stringify(values);
    },
  };
}
