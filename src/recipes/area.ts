import type { Surface } from '../ink/surface.js';
import { lettering } from '../ink/lettering.js';
import { object } from '../ink/object.js';
import type { InkDrawing } from '../story/ink-chapter.js';

/** One centimetre is always two grid cells. Layout changes; the measurement does not. */
export function areaDiagram(
  view: Surface,
  options: { width?: string; height?: string; maxColumns?: number; maxRows?: number } = {},
): InkDrawing {
  const columnKey = options.width ?? 'width',
    rowKey = options.height ?? 'height';
  const maxColumns = options.maxColumns ?? 6,
    maxRows = options.maxRows ?? 5;
  let signature = '',
    cleanups: (() => void)[] = [],
    cells: SVGGElement[] = [],
    snapshot: unknown;
  const clear = () => {
    cleanups.forEach((f) => f());
    cleanups = [];
    cells = [];
  };
  return {
    render(frame, viewport) {
      const columns = Number(frame.values[columnKey]),
        rows = Number(frame.values[rowKey]);
      if (
        ![columns, rows, maxColumns, maxRows].every((n) => Number.isInteger(n) && n > 0) ||
        columns > maxColumns ||
        rows > maxRows
      )
        throw new Error(
          'Area sides must be positive integers within the prepared diagram capacity',
        );
      const { width: w, height: h } = viewport,
        compact = w < 540,
        short = h < 220;
      const unit =
        Math.floor(
          Math.min(
            56,
            (w * (compact ? 1 : 0.55) - 70) / maxColumns,
            (h - (compact ? (short ? 80 : 114) : 140)) / maxRows,
          ) / 2,
        ) * 2;
      if (unit < 10)
        throw new Error(
          'Area diagram needs more drawing space to keep the grid and labels readable',
        );
      const key = [w, h, columns, rows].join(':');
      if (key !== signature) {
        clear();
        signature = key;
        const font = compact ? 20 : Math.max(20, Math.min(25, w / 28));
        const x = (Math.round((compact ? (w - columns * unit) / 2 : 70) / (unit / 2)) * unit) / 2;
        const y = (Math.round((compact ? (short ? 36 : 43) : 70) / (unit / 2)) * unit) / 2;
        view.grid({ step: unit / 2 });
        const diagram = object(view.layer, 'area', 'blue');
        cleanups.push(diagram.dispose);
        const outline = view.pen.contour(
          diagram.content,
          'outline',
          [
            [x, y],
            [x + columns * unit, y],
            [x + columns * unit, y + rows * unit],
            [x, y + rows * unit],
          ],
          { width: 1.4 },
        );
        cleanups.push(outline.dispose);
        for (let i = 0; i < columns * rows; i++) {
          const cell = object(view.layer, `unit-${i}`, i % columns < 3 ? 'blue' : 'orange');
          cleanups.push(cell.dispose);
          const cx = x + (i % columns) * unit,
            cy = y + Math.floor(i / columns) * unit;
          view.pen.contour(
            cell.content,
            `cell-${i}`,
            [
              [cx, cy],
              [cx + unit, cy],
              [cx + unit, cy + unit],
              [cx, cy + unit],
            ],
            { fill: 'marker', width: 1.1 },
          );
          cells.push(cell.element);
        }
        const label = (
          id: string,
          value: string,
          lx: number,
          ly: number,
          size: number,
          color: 'blue' | 'orange' | 'ink' = 'ink',
        ) => {
          const mark = object(view.layer, id, color);
          cleanups.push(mark.dispose);
          const text = lettering(mark.content, value, { x: lx, y: ly, size });
          cleanups.push(text.dispose);
        };
        label(
          'width',
          `${columns} см`,
          x + (columns * unit) / 2,
          y + rows * unit + font + (short ? 1 : 5),
          font,
        );
        label('height', `${rows} см`, x - font * 1.05, y + (rows * unit) / 2, font);
        label(
          'formula',
          `${columns} × ${rows} = ${columns * rows} см²`,
          compact ? w / 2 : w * 0.77,
          compact ? 24 : h * 0.29,
          compact ? 20 : Math.min(34, w / 24),
          'blue',
        );
        label(
          'unit-fact',
          '1 см² = 4 клетки',
          compact ? w / 2 : w * 0.77,
          compact ? h - (short ? 2 : 14) : h * 0.65,
          font,
          'orange',
        );
        if (!compact) {
          const mark = object(view.layer, 'unit-square', 'orange');
          cleanups.push(mark.dispose);
          const ux = (Math.round((w * 0.77 - unit / 2) / (unit / 2)) * unit) / 2,
            uy = (Math.round((h * 0.43) / (unit / 2)) * unit) / 2;
          view.pen.contour(
            mark.content,
            'unit-square',
            [
              [ux, uy],
              [ux + unit, uy],
              [ux + unit, uy + unit],
              [ux, uy + unit],
            ],
            { fill: 'marker' },
          );
          label('total-cells', `${columns * rows * 4} маленьких клеток`, w * 0.77, h * 0.76, font);
        }
      }
      const count =
        frame.mode === 'explore'
          ? cells.length
          : Math.min(cells.length, Math.floor(frame.progress * (cells.length + 2)));
      cells.forEach((cell, i) => {
        cell.style.visibility = i < count ? '' : 'hidden';
      });
      view.element.querySelector('desc')!.textContent =
        `${columns} на ${rows} см: ${columns * rows} см²; ${columns * rows * 4} клеток.`;
      snapshot = {
        columns,
        rows,
        area: columns * rows,
        cells: columns * rows * 4,
        visibleUnits: count,
        pixelsPerCm: unit,
        gridStep: unit / 2,
      };
    },
    snapshot: () => snapshot,
    dispose: clear,
  };
}
