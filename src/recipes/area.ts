import type { Surface } from '../ink/surface.js';
import { lettering } from '../ink/lettering.js';
import { object } from '../ink/object.js';
import type { InkDrawing } from '../story/ink-chapter.js';
import type { ChapterFrame } from '../story/composition.js';

/** Count square centimetres on a measured grid; each square contains four small cells. */
export function areaDiagram(
  view: Surface,
  options: {
    width?: string;
    height?: string;
    maxColumns?: number;
    maxRows?: number;
    /** The unchanged columns keep their colour when another strip is added. */
    compareColumns?: number;
    visibleUnits?: (frame: ChapterFrame) => number;
    showRows?: (frame: ChapterFrame) => boolean;
    revealResult?: (frame: ChapterFrame) => boolean;
  } = {},
): InkDrawing {
  const columnKey = options.width ?? 'width',
    rowKey = options.height ?? 'height',
    maxColumns = options.maxColumns ?? 6,
    maxRows = options.maxRows ?? 5;
  let signature = '',
    cleanups: (() => void)[] = [],
    squares: SVGGElement[] = [],
    rowLabels: SVGGElement[] = [],
    answers: SVGGElement[] = [],
    snapshot: unknown;
  const clear = () => {
    cleanups.forEach((cleanup) => cleanup());
    cleanups = [];
    squares = [];
    rowLabels = [];
    answers = [];
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
      const { width, height } = viewport,
        single = maxColumns === 1 && maxRows === 1,
        unit =
          2 *
          Math.floor(
            Math.min(single ? 220 : 96, (width - 112) / maxColumns, (height - 108) / maxRows) / 2,
          );
      if (unit < 14)
        throw new Error(
          'Area diagram needs more drawing space to keep the grid and labels readable',
        );
      const key = [width, height, columns, rows].join(':');
      if (key !== signature) {
        clear();
        signature = key;
        const x = Math.round((width - (options.compareColumns ? maxColumns : columns) * unit) / 2),
          y = Math.round((height - 60 - rows * unit) / 2),
          font = width < 420 ? 21 : 24;
        view.grid({ step: unit / 2, x, y });
        const outline = object(view.layer, 'area', 'blue');
        outline.describe({
          label: 'Прямоугольник из единичных квадратов',
          value: () => ({ columns, rows, area: columns * rows }),
          unit: 'см²',
        });
        cleanups.push(outline.dispose);
        const boundary = view.pen.contour(
          outline.content,
          'area-outline',
          [
            [x, y],
            [x + columns * unit, y],
            [x + columns * unit, y + rows * unit],
            [x, y + rows * unit],
          ],
          { width: 1.6 },
        );
        cleanups.push(boundary.dispose);
        for (let i = 0; i < columns * rows; i++) {
          const column = i % columns,
            row = Math.floor(i / columns),
            added = options.compareColumns !== undefined && column >= options.compareColumns,
            square = object(view.layer, `unit-${i}`, added ? 'orange' : 'blue'),
            cx = x + column * unit,
            cy = y + row * unit;
          square.element.dataset.areaRow = String(row);
          cleanups.push(square.dispose);
          const contour = view.pen.contour(
            square.content,
            `square-${i}`,
            [
              [cx, cy],
              [cx + unit, cy],
              [cx + unit, cy + unit],
              [cx, cy + unit],
            ],
            { fill: 'marker', width: 1.05 },
          );
          cleanups.push(contour.dispose);
          squares.push(square.element);
        }
        const label = (
          id: string,
          value: string,
          lx: number,
          ly: number,
          size: number,
          pigment: 'blue' | 'orange' | 'ink' = 'ink',
        ) => {
          const mark = object(view.layer, id, pigment);
          cleanups.push(mark.dispose);
          const text = lettering(mark.content, value, { x: lx, y: ly, size });
          cleanups.push(text.dispose);
          return mark.element;
        };
        label(
          'width',
          `${columns} см`,
          x + (columns * unit) / 2,
          y + rows * unit + font + 10,
          font,
          'blue',
        );
        label('height', `${rows} см`, x - 34, y + (rows * unit) / 2 + font / 3, font, 'blue');
        if (single) {
          label('unit-area', '1 см²', x + unit / 2, y + unit / 2 + 10, 31, 'blue');
        } else {
          for (let row = 0; row < rows; row++)
            rowLabels.push(
              label(
                `row-${row}`,
                String(columns),
                x + columns * unit + 24,
                y + (row + 0.5) * unit + 7,
                21,
                'blue',
              ),
            );
          answers.push(
            label(
              'formula',
              `${columns} × ${rows} = ${columns * rows} см²`,
              width / 2,
              height - 8,
              Math.min(29, font + 3),
              'blue',
            ),
          );
        }
      }
      const count = Math.max(
        0,
        Math.min(squares.length, options.visibleUnits?.(frame) ?? squares.length),
      );
      squares.forEach((square, i) => {
        // The complete rectangle remains visible while the narration counts its rows.
        square.style.opacity = i < count ? '1' : '.18';
        square.dataset.counted = String(i < count);
      });
      const showRows = options.showRows?.(frame) ?? false;
      rowLabels.forEach((label, row) => {
        label.style.visibility = showRows && count >= (row + 1) * columns ? '' : 'hidden';
      });
      const revealed = options.revealResult?.(frame) !== false;
      answers.forEach((element) => {
        element.style.visibility = revealed ? '' : 'hidden';
      });
      view.element.querySelector('desc')!.textContent = revealed
        ? `${columns} на ${rows} см: ${rows} рядов по ${columns} единичных квадратов; площадь ${columns * rows} см².`
        : `Прямоугольник: ширина ${columns} см, высота ${rows} см.`;
      snapshot = {
        columns,
        rows,
        area: columns * rows,
        cells: columns * rows * 4,
        rowUnits: Array.from({ length: rows }, () => columns),
        visibleUnits: count,
        pixelsPerCm: unit,
        gridStep: unit / 2,
      };
    },
    snapshot: () => snapshot,
    dispose: clear,
  };
}
