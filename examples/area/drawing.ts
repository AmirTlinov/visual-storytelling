import { surface, object, lettering, measure, formula } from '@visual-storytelling/core';
import type { Frame } from '@visual-storytelling/core';
import { countCues, rowCues, type AreaCue, type AreaState } from './model';

export function drawing(parent: HTMLElement, width: number) {
  const unit = Math.min(64, Math.floor((width - 108) / 10) * 2);
  const left = (width - unit * 5) / 2,
    top = 74,
    bottom = top + unit * 4;
  const view = surface(parent, {
    id: 'area',
    width,
    height: bottom + 174,
    title: 'Площадь прямоугольника',
    description:
      'Четыре ряда по пять квадратных сантиметров. Один сантиметр занимает две клетки бумаги.',
    grid: { step: unit / 2, x: left, y: top },
  });
  const outline = object(view.layer, 'rectangle');
  const boundary = view.pen.rect(
    outline.content,
    'rectangle:boundary',
    left,
    top,
    unit * 5,
    unit * 4,
  );
  const widthMark = measure(view, 'width', {
    from: [left, top],
    to: [left + 5 * unit, top],
    pixelsPerUnit: unit,
    unit: 'см',
    pigment: 'blue',
    size: 26,
  });
  const heightMark = measure(view, 'height', {
    from: [left, top + 4 * unit],
    to: [left, top],
    pixelsPerUnit: unit,
    unit: 'см',
    pigment: 'ochre',
    size: 26,
  });
  const widthSide = object(view.layer, 'spoken-width', 'blue');
  const widthStroke = view.pen.line(
    widthSide.content,
    'spoken-width:line',
    [left, top],
    [left + 5 * unit, top],
    { width: 2.2 },
  );
  const heightSide = object(view.layer, 'spoken-height', 'ochre');
  const heightStroke = view.pen.line(
    heightSide.content,
    'spoken-height:line',
    [left, top],
    [left, bottom],
    { width: 2.2 },
  );
  const squares = Array.from({ length: 20 }, (_, i) => {
    const mark = object(view.layer, `square-${i}`, 'blue');
    mark.at(left + (i % 5) * unit, top + Math.floor(i / 5) * unit);
    const shape = view.pen.rect(mark.content, `square-${i}:shape`, 0, 0, unit, unit, {
      fill: 'marker',
      width: 1.25,
      stroke: 'pencil',
    });
    const digit = lettering(mark.content, (i % 5) + 1, { x: unit / 2, y: unit / 2 + 8, size: 22 });
    return { mark, shape, digit };
  });
  const paper = object(view.layer, 'paper', 'ochre');
  paper.at(left, top);
  const paperShape = view.pen.rect(paper.content, 'paper:shape', 0, 0, unit / 2, unit / 2, {
    fill: 'hatch',
  });
  const paperSize = measure(view, 'paper-size', {
    from: [left, top],
    to: [left + unit / 2, top],
    pixelsPerUnit: unit / 10,
    unit: 'мм',
    pigment: 'ochre',
    size: 18,
  });
  const unitWidth = measure(view, 'unit-width', {
    from: [left, top],
    to: [left + unit, top],
    pixelsPerUnit: unit,
    unit: 'см',
    pigment: 'ochre',
    size: 20,
  });
  const unitHeight = measure(view, 'unit-height', {
    from: [left, top + unit],
    to: [left, top],
    pixelsPerUnit: unit,
    unit: 'см',
    pigment: 'ochre',
    size: 20,
  });
  const unitLabel = object(view.layer, 'unit-label', 'ochre');
  unitLabel.at(left + unit / 2, top + unit / 2 + 5);
  const unitText = lettering(unitLabel.content, '1 см²', { size: Math.min(19, unit * 0.32) });
  const unitHint = object(view.layer, 'unit-hint', 'ochre');
  unitHint.at(left + unit + 12, top + unit / 2 + 6);
  const unitHintText = lettering(unitHint.content, '2 × 2 клетки', {
    size: width < 440 ? 17 : 20,
    anchor: 'start',
  });
  const rows = Array.from({ length: 4 }, (_, r) => {
    const group = object(view.layer, `row-count-${r}`, 'blue');
    group.at(left + unit * 5 + 24, top + (r + 0.5) * unit + 8);
    return { group, label: lettering(group.content, '5', { size: 25 }) };
  });
  const count = object(view.layer, 'count', 'green');
  count.at(width / 2, bottom + 42);
  const countText = lettering(count.content, 'Всего: 0', { size: 29 });
  const fourRows = object(view.layer, 'four-rows', 'ochre');
  fourRows.at(left + unit * 5 + 24, top + 2 * unit, 90);
  const rowsText = lettering(fourRows.content, '4 ряда', { size: 24 });
  const sumIds = [
    'sum_one',
    'sum_plus_one',
    'sum_two',
    'sum_plus_two',
    'sum_three',
    'sum_plus_three',
    'sum_four',
    'sum_equals',
    'sum_result',
  ] as const;
  const sum = formula(
    view.layer,
    'sum',
    sumIds.map((id, i) => ({
      id,
      text: i === 7 ? '=' : i === 8 ? '20' : i % 2 ? '＋' : '5',
      pigment: i === 8 ? ('green' as const) : i % 2 ? ('ink' as const) : ('blue' as const),
    })),
    width < 440 ? 23 : 29,
  );
  sum.at(width / 2, bottom + 44);
  const product = formula(
    view.layer,
    'product',
    [
      { id: 'product_four', text: '4', pigment: 'ochre' },
      { id: 'product_sign', text: '×' },
      { id: 'product_five', text: '5', pigment: 'blue' },
      { id: 'product_equals', text: '=' },
      { id: 'product_result', text: '20', pigment: 'green' },
    ] as const,
    34,
  );
  product.at(width / 2, bottom + 48);
  const underline = object(view.layer, 'answer-underline', 'green');
  const underlineStroke = view.pen.path(
    underline.content,
    'answer-underline:path',
    `M${width / 2 + product.width / 2 - 42} ${bottom + 60} q24 3 48 -1`,
  );
  const meaning = formula(
    view.layer,
    'meaning',
    [
      { id: 'times_four', text: 4, pigment: 'ochre' },
      { id: 'times_repeat', text: 'раза по' },
      { id: 'times_five', text: 5, pigment: 'blue' },
    ] as const,
    29,
  );
  meaning.at(width / 2, bottom + 45);
  const answer = formula(
    view.layer,
    'answer',
    [
      { id: 'answer_area', text: 'Площадь', pigment: 'green' },
      { id: 'answer_value', text: '20', pigment: 'green' },
      { id: 'answer_units', text: 'см²', pigment: 'green' },
    ] as const,
    26,
  );
  answer.at(width / 2, bottom + 106);
  const general = object(view.layer, 'general-area');
  lettering(general.content, 'S = a × b', { x: width / 2, y: bottom + 151, size: 27 });
  const gridFocus = Array.from({ length: 4 }, (_, i) => {
    const group = object(view.layer, `recap-${i}`, 'ochre');
    const shape = view.pen.rect(
      group.content,
      `recap-${i}:shape`,
      left + ((i % 2) * unit) / 2,
      top + (Math.floor(i / 2) * unit) / 2,
      unit / 2,
      unit / 2,
      { fill: 'hatch' },
    );
    return { group, shape };
  });
  // Local annotation is deliberately on top of its own fill.
  view.layer.append(unitLabel.element);
  return {
    view,
    dispose: view.dispose,
    render(state: AreaState, frame: Frame<AreaCue>, formulas: boolean) {
      const p = frame.reveal;
      boundary.reveal(state.rectangle);
      widthMark.reveal(0, state.widthText);
      heightMark.reveal(0, state.heightText);
      widthSide.show(
        frame.between('width_side', 'area_question') ||
          frame.between('answer_width', 'answer_units'),
      );
      heightSide.show(
        frame.between('height_side', 'width_side') ||
          frame.between('answer_height', 'answer_width'),
      );
      widthStroke.reveal(frame.has('answer') ? p('answer_width') : state.width);
      heightStroke.reveal(frame.has('answer') ? p('answer_height') : state.height);
      widthMark.show(!state.paper && !state.unit);
      heightMark.show(!state.paper && !state.unit);
      paper.show(state.paper);
      paperShape.reveal(p('paper_cell'));
      paperSize.show(state.paper);
      paperSize.reveal(p('paper_length'));
      unitWidth.show(state.unit);
      unitWidth.reveal(p('unit_side'));
      unitHeight.show(state.unit);
      unitHeight.reveal(p('unit_side'));
      unitLabel.show(state.unit || (state.recap && !frame.has('recap_grid')));
      unitText.write(state.recap ? 1 : p('unit_area'));
      unitHint.show(state.unit);
      unitHintText.write(p('unit_grid'));
      const rowNumberFocus = frame.between('four_rows', 'each_row');
      const counting = frame.between('count_rows', 'addition');
      const activeRow = rowCues.findLastIndex(frame.has);
      const addedRow = (['sum_one', 'sum_two', 'sum_three', 'sum_four'] as const).findLastIndex(
        frame.has,
      );
      const activeColumn = countCues.findLastIndex(frame.has);
      squares.forEach(({ mark, shape, digit }, i) => {
        mark.show(state.squares[i]! > 0);
        shape.reveal(state.squares[i]!);
        mark.pigment(i === 0 && (state.unit || state.recap) ? 'ochre' : 'blue');
        const row = Math.floor(i / 5);
        const highlighted =
          rowNumberFocus ||
          (counting && row <= activeRow) ||
          (state.adding && row <= addedRow) ||
          (i === activeColumn && frame.between('one', 'row_total')) ||
          (i === 0 && (state.unit || state.recap));
        mark.element.style.setProperty('--vs-wash-strength', highlighted ? '34%' : '18%');
        digit.write(i < 5 && frame.between('one', 'more_rows') ? p(countCues[i]!) : 0);
      });
      rows.forEach(({ group, label }, i) => {
        group.show(!rowNumberFocus && frame.has(i === 0 ? 'row_total' : 'each_row'));
        label.write(p(i === 0 ? 'row_total' : 'each_row'));
      });
      fourRows.show(rowNumberFocus);
      rowsText.write(p('four_rows'));
      count.show(frame.between('total_five', 'addition'));
      countText.text(`Всего: ${state.counted}`);
      sum.show(state.adding);
      sum.write((id) => (id === 'sum_equals' ? Number(frame.has('sum_result')) : p(id)));
      meaning.show(frame.between('multiply', 'product_four'));
      meaning.write(p);
      product.show(state.multiplying);
      product.write(p);
      underlineStroke.reveal(p('product_result'));
      answer.show(frame.has('answer_area'));
      answer.write(p);
      general.show(formulas && p('answer_units') === 1);
      gridFocus.forEach(({ group, shape }, i) => {
        const amount = Math.max(0, Math.min(1, p('recap_grid') * 4 - i));
        group.show(amount > 0);
        shape.reveal(amount);
      });
      if (formulas) {
        widthMark.label.text('b = 5 см');
        heightMark.label.text('a = 4 см');
      } else {
        widthMark.label.text('5 см');
        heightMark.label.text('4 см');
      }
      view.element.dataset.visibleSquares = String(
        state.squares.filter((value) => value > 0).length,
      );
      view.element.dataset.cm = String(unit);
      view.element.dataset.paperStep = String(unit / 2);
      view.element.dataset.countedRows = String(rowCues.filter((id) => frame.has(id)).length);
    },
  };
}
