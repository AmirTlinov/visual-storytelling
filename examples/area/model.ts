import type { Frame } from '@visual-storytelling/core';
import type narration from './narration.json';
export type AreaCue = keyof typeof narration.cues;
export const countCues = ['one', 'two', 'three', 'four', 'five'] as const;
export const rowCues = ['total_five', 'total_ten', 'total_fifteen', 'total_twenty'] as const;
export function areaAt(frame: Frame<AreaCue>) {
  const { has, reveal: p, between } = frame;
  return {
    rows: 4,
    columns: 5,
    rectangle: p('draw_rectangle'),
    height: p('height_side'),
    heightText: p('height_value'),
    width: p('width_side'),
    widthText: p('width_value'),
    paper: between('paper_cell', 'unit_square'),
    unit: between('unit_square', 'first_row'),
    recap: has('recap_unit'),
    squares: Array.from({ length: 20 }, (_, i) =>
      i === 0
        ? p('unit_square')
        : i < 5
          ? p(countCues[i]!)
          : Math.min(1, Math.max(0, p('add_rows') * 3 - (Math.floor(i / 5) - 1))),
    ),
    counted: rowCues.filter((id) => has(id)).length * 5,
    adding: between('sum_one', 'multiply'),
    multiplying: has('multiply'),
  };
}
export type AreaState = ReturnType<typeof areaAt>;
