import type { Surface } from '../ink/surface.js';
import { lettering } from '../ink/lettering.js';
import { object } from '../ink/object.js';
import type { InkDrawing } from '../story/ink-chapter.js';
import type { ChapterFrame } from '../story/composition.js';

/** Count explicitly bounded square centimetres; the paper grid remains a visual material. */
export function areaDiagram(
  view: Surface,
  options: {
    width?: string;
    height?: string;
    maxColumns?: number;
    maxRows?: number;
    /** Reserve the added strip; the original columns retain their colour and position. */
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
            Math.min(single ? 220 : 128, (width - 240) / maxColumns, (height - 144) / maxRows) / 2,
          ),
        reservedColumns = options.compareColumns ? maxColumns : columns,
        x = Math.round((width - reservedColumns * unit) / 2),
        y = Math.round((height - 86 - rows * unit) / 2);
      if (unit < 14)
        throw new Error(
          'Area diagram needs more drawing space to keep the grid and labels readable',
        );
      const key = [width, height, columns, rows].join(':');
      if (key !== signature) {
        clear();
        signature = key;
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
        const outline = object(view.layer, 'area', 'blue');
        outline.describe({
          label: 'Прямоугольник из единичных квадратов',
          value: () => ({ columns, rows, area: columns * rows }),
          unit: 'см²',
        });
        cleanups.push(outline.dispose);
        cleanups.push(
          view.pen.contour(
            outline.content,
            'area-outline',
            [
              [x, y],
              [x + columns * unit, y],
              [x + columns * unit, y + rows * unit],
              [x, y + rows * unit],
            ],
            { width: 1.8 },
          ).dispose,
        );
        for (let i = 0; i < columns * rows; i++) {
          const column = i % columns,
            row = Math.floor(i / columns),
            added = options.compareColumns !== undefined && column >= options.compareColumns,
            square = object(view.layer, `unit-${i}`, added ? 'orange' : 'blue'),
            cx = x + column * unit,
            cy = y + row * unit;
          square.element.dataset.areaRow = String(row);
          cleanups.push(square.dispose);
          cleanups.push(
            view.pen.contour(
              square.content,
              `square-${i}`,
              [
                [cx, cy],
                [cx + unit, cy],
                [cx + unit, cy + unit],
                [cx, cy + unit],
              ],
              { fill: 'marker', width: 1.05 },
            ).dispose,
          );
          squares.push(square.element);
        }
        const dimensions = object(view.layer, 'area-dimensions', 'blue');
        cleanups.push(dimensions.dispose);
        cleanups.push(
          view.pen.polyline(
            dimensions.content,
            'width-bracket',
            [
              [x, y + rows * unit + 9],
              [x, y + rows * unit + 17],
              [x + columns * unit, y + rows * unit + 17],
              [x + columns * unit, y + rows * unit + 9],
            ],
            { width: 1.3 },
          ).dispose,
        );
        cleanups.push(
          view.pen.polyline(
            dimensions.content,
            'height-bracket',
            [
              [x - 9, y],
              [x - 17, y],
              [x - 17, y + rows * unit],
              [x - 9, y + rows * unit],
            ],
            { width: 1.3 },
          ).dispose,
        );
        label('width', `${columns} см`, x + (columns * unit) / 2, y + rows * unit + 49, 30, 'blue');
        label('height', `${rows} см`, x - 64, y + (rows * unit) / 2 + 10, 30, 'blue');
        if (single) {
          label('unit-area', '1 см²', x + unit / 2, y + unit / 2 + 14, 42, 'blue');
        } else {
          for (let row = 0; row < rows; row++) {
            rowLabels.push(
              label(
                `row-${row}`,
                String(columns),
                x + columns * unit + 39,
                y + (row + 0.5) * unit + 10,
                30,
                'blue',
              ),
            );
            if (row)
              rowLabels.push(
                label(
                  `row-plus-${row}`,
                  '+',
                  x + columns * unit + 39,
                  y + row * unit + 8,
                  23,
                  'blue',
                ),
              );
          }
          const unchanged = options.compareColumns,
            added = unchanged !== undefined && columns > unchanged;
          if (unchanged !== undefined) {
            const comparison = object(view.layer, 'area-comparison', 'orange');
            cleanups.push(comparison.dispose);
            if (!added) {
              const future = view.pen.contour(
                comparison.content,
                'added-outline',
                [
                  [x + columns * unit, y],
                  [x + maxColumns * unit, y],
                  [x + maxColumns * unit, y + rows * unit],
                  [x + columns * unit, y + rows * unit],
                ],
                { pencil: true, width: 1.3 },
              );
              future.element.setAttribute('stroke-dasharray', '7 7');
              cleanups.push(future.dispose);
            } else {
              answers.push(
                label(
                  'original-part',
                  `${unchanged * rows}`,
                  x + (unchanged * unit) / 2,
                  y + (rows * unit) / 2 + 14,
                  42,
                  'blue',
                ),
              );
              answers.push(
                label(
                  'added-part',
                  `+ ${(columns - unchanged) * rows}`,
                  x + (unchanged + (columns - unchanged) / 2) * unit,
                  y + (rows * unit) / 2 + 14,
                  42,
                  'orange',
                ),
              );
            }
            const start = x + unchanged * unit,
              end = x + maxColumns * unit;
            cleanups.push(
              view.pen.arrow(
                comparison.content,
                'doubling-direction',
                [start + 8, y - 17],
                [end - 2, y - 17],
                { width: 1.5 },
              ).dispose,
            );
          }
          const formula = added
            ? `${unchanged! * rows} + ${(columns - unchanged!) * rows} = ${columns * rows} см²`
            : `${columns} × ${rows} = ${columns * rows} см²`;
          answers.push(label('formula', formula, width / 2, height - 4, 37, 'blue'));
        }
      }
      const count = Math.max(
        0,
        Math.min(squares.length, options.visibleUnits?.(frame) ?? squares.length),
      );
      squares.forEach((square, i) => {
        square.style.opacity = i < count ? '1' : '.18';
        square.dataset.counted = String(i < count);
      });
      const showRows = options.showRows?.(frame) ?? false;
      rowLabels.forEach((label) => {
        const id = label.dataset.object!,
          row = Number(id.split('-').at(-1));
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
        rowUnits: Array.from({ length: rows }, () => columns),
        visibleUnits: count,
        pixelsPerCm: unit,
        bounds: { x, y, width: columns * unit, height: rows * unit },
      };
    },
    snapshot: () => snapshot,
    dispose: clear,
  };
}
