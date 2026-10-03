import {
  SketchMotion,
  SvgLayout,
  story,
  player as storyPlayer,
  rough,
} from '@visual-storytelling/core';
import narrationTiming from './timeline.json' with { type: 'json' };
window.galleryReady = (async () => {
  const root = document.getElementById('ve-scene');
  const svg = root.querySelector('svg.canvas'),
    layer = root.querySelector('[data-drawing]');
  const audio = root.querySelector('audio'),
    timing = narrationTiming;
  const { element: el, place, row, observe, box } = SvgLayout;
  const { write, trace, draw, resetText } = SketchMotion;
  const model = { rows: 4, columns: 5, paperCellMm: 5 };
  const unitSize = 60,
    cellsPerCm = 10 / model.paperCellMm;
  const total = model.rows * model.columns;
  const C = timing.cues,
    ink = 'var(--ve-ink)',
    blue = 'var(--ve-blue)',
    orange = 'var(--ve-orange)',
    green = 'var(--ve-green)';
  const rc = rough.svg(svg),
    countCues = ['one', 'two', 'three', 'four', 'five'];
  const totalCues = ['total_five', 'total_ten', 'total_fifteen', 'total_twenty'];
  const sumTerms = ['sum_one', 'sum_two', 'sum_three', 'sum_four'];
  const sumCues = [
    'sum_one',
    'sum_plus_one',
    'sum_two',
    'sum_plus_two',
    'sum_three',
    'sum_plus_three',
    'sum_four',
  ];
  const meaningCues = ['times_four', 'times_repeat', 'times_five'];
  const productCues = [
    'product_four',
    'product_sign',
    'product_five',
    'product_equals',
    'product_result',
  ];
  const answerCues = ['answer_area', 'answer_value', 'answer_units'];
  const text = (value, cls = '') => {
    const group = el('g', { 'data-label': '' }),
      node = el('text', { class: cls }, value);
    group.append(node);
    layer.append(group);
    return node;
  };
  const title = text('Почему 4 × 5 = 20?', 'title');
  const paperLabel = text('5 мм', 'tiny muted');
  const unitArea = text('1 см²', 'small orange');
  const unitWidth = text('1 см', 'tiny orange'),
    unitHeight = text('1 см', 'tiny orange');
  const unitGridHint = text('2 × 2 клетки', 'tiny muted');
  const paperCell = el('rect', {
    fill: 'var(--ve-orange-wash)',
    stroke: orange,
    'stroke-width': 1.3,
  });
  const measure = () =>
    el('path', { fill: 'none', stroke: orange, 'stroke-width': 1.3, 'stroke-linecap': 'round' });
  const paperMeasure = measure(),
    unitMeasure = measure();
  const heightSide = measure(),
    widthSide = measure();
  [heightSide, widthSide].forEach((node) => {
    node.setAttribute('stroke', blue);
    node.setAttribute('stroke-width', 2.2);
  });
  heightSide.setAttribute('stroke', orange);
  layer.append(paperCell, paperMeasure, unitMeasure, heightSide, widthSide);
  const widthLabel = text(`${model.columns} см`, 'number blue');
  const heightLabel = text(`${model.rows} см`, 'number orange');
  const boundary = el('g');
  boundary.append(
    rc.rectangle(0, 0, model.columns * unitSize, model.rows * unitSize, {
      seed: 49,
      roughness: 0.35,
      disableMultiStroke: true,
      stroke: ink,
      strokeWidth: 1.7,
    }),
  );
  layer.prepend(boundary);
  const tiles = Array.from({ length: total }, (_, i) => {
    const group = el('g', { 'data-square': i, 'data-area-cm2': 1 });
    const shape = rc.rectangle(0, 0, unitSize, unitSize, {
      seed: 121 + i,
      roughness: 0.22,
      disableMultiStroke: true,
      stroke: 'var(--ve-pencil)',
      strokeWidth: 1.25,
    });
    const fill = el('rect', {
      x: 1,
      y: 1,
      width: unitSize - 2,
      height: unitSize - 2,
      fill: 'var(--ve-wash)',
    });
    group.append(fill, shape);
    layer.append(group);
    const digit =
      i < model.columns
        ? el(
            'text',
            { x: unitSize / 2, y: unitSize / 2 + 9, 'text-anchor': 'middle', class: 'small blue' },
            i + 1,
          )
        : null;
    if (digit) {
      const label = el('g', { 'data-label': '' });
      label.append(digit);
      group.append(label);
    }
    return { group, fill, shape, digit };
  });
  const rowValues = Array.from({ length: model.rows }, () => text(model.columns, 'small blue'));
  const rowsLabel = text(`${model.rows} ряда`, 'tiny orange');
  const countLabel = text('Всего: 0', 'number green');
  const sumParts = Array.from({ length: model.rows }, (_, i) => [
    text(model.columns, 'number blue'),
    ...(i < model.rows - 1 ? [text('+')] : []),
  ]).flat();
  sumParts.push(text('='), text(total, 'number green'));
  const equation = [
    text(model.rows, 'number orange'),
    text('×', 'number'),
    text(model.columns, 'number blue'),
    text('='),
    text(total, 'number green'),
  ];
  const meaning = [
    text(model.rows, 'number orange'),
    text('раза по', 'small muted'),
    text(model.columns, 'number blue'),
  ];
  const answer = [
    text('Площадь:', 'small green'),
    text(total, 'small green'),
    text('см²', 'small green'),
  ];
  const generic = text('S = a × b', 'small green');
  const underline = el('path', {
    fill: 'none',
    stroke: green,
    'stroke-width': 2.5,
    'stroke-linecap': 'round',
  });
  layer.append(underline);
  const paperCells = Array.from({ length: cellsPerCm ** 2 }, () => {
    const node = el('rect', { fill: 'var(--ve-orange-soft)', stroke: orange, 'stroke-width': 1.2 });
    layer.append(node);
    return node;
  });
  // The annotation stays above its tile's translucent fill.
  layer.append(unitArea.parentElement);
  let formulas = false,
    player,
    layout;
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const show = (node, yes) => {
    const target = node.parentElement.hasAttribute('data-label') ? node.parentElement : node;
    target.style.opacity = yes ? '1' : '0';
  };
  const reveal = (node, p) => {
    show(node, p > 0);
    trace([...node.querySelectorAll('path')], p);
  };
  const progress = (start, duration, time, reduced) =>
    reduced ? Number(time >= start) : clamp((time - start) / Math.max(0.1, duration));
  function setText(node, value) {
    if (node.textContent !== String(value)) {
      resetText(node);
      node.textContent = String(value);
    }
  }
  function render(frame) {
    const { time: t, reduced } = frame;
    const p = frame.reveal;
    const paperFocus = frame.between('unit', 'unit_square');
    const unitFocus = frame.between('unit_square', 'first_row');
    const recapFocus = frame.has('recap_unit');
    const rowNumberFocus = frame.between('four_rows', 'each_row');
    const counting = frame.between('count_rows', 'addition');
    const activeRow = totalCues.findLastIndex((id) => frame.has(id));
    const adding = frame.between('sum_one', 'multiply');
    const addedRow = sumTerms.findLastIndex((id) => frame.has(id));
    const activeColumn = countCues.findLastIndex((id) => frame.has(id));
    // The frame is a pure projection of audio time. No separate animation clock.
    // Every new fact uses its spoken word cue, not the enclosing paragraph's duration.
    write(title, progress(0, 1.4, t, reduced));
    write(paperLabel, p('paper_length'));
    show(paperLabel, paperFocus);
    show(paperCell, paperFocus && frame.has('paper_cell'));
    draw(paperMeasure, p('paper_length'));
    show(paperMeasure, paperFocus);
    write(unitWidth, p('unit_side'));
    write(unitHeight, p('unit_side'));
    draw(unitMeasure, p('unit_side'));
    [unitWidth, unitHeight, unitMeasure].forEach((node) => show(node, unitFocus));
    write(unitArea, p('unit_area'));
    show(unitArea, unitFocus || (recapFocus && !frame.has('recap_grid')));
    write(unitGridHint, p('unit_grid'));
    show(unitGridHint, unitFocus);
    reveal(boundary, p('draw_rectangle'));
    write(widthLabel, p('width_value'));
    write(heightLabel, p('height_value'));
    [widthLabel, heightLabel].forEach((node) => show(node, !paperFocus && !unitFocus));
    draw(heightSide, !frame.has('answer') ? p('height_side') : p('answer_height'));
    draw(widthSide, !frame.has('answer') ? p('width_side') : p('answer_width'));
    show(
      heightSide,
      (frame.has('height_side') && !frame.has('width_side')) ||
        (frame.has('answer_height') && !frame.has('answer_width')),
    );
    show(
      widthSide,
      (frame.has('width_side') && !frame.has('area_question')) ||
        (frame.has('answer_width') && t <= frame.cue('answer_width').end),
    );
    tiles.forEach(({ group, shape, fill, digit }, i) => {
      const r = Math.floor(i / model.columns),
        c = i % model.columns;
      const amount =
        i === 0
          ? p('unit_square')
          : r === 0
            ? p(countCues[c])
            : clamp(p('add_rows') * (model.rows - 1) - (r - 1));
      show(group, amount > 0);
      reveal(shape, amount);
      fill.style.opacity = amount;
      const countingTile =
        r === 0 && c === activeColumn && frame.has('one') && !frame.has('row_total');
      const highlighted =
        (counting && r <= activeRow) ||
        (adding && r <= addedRow) ||
        countingTile ||
        rowNumberFocus ||
        (recapFocus && i === 0);
      const unitTile = i === 0 && (unitFocus || paperFocus || recapFocus);
      fill.setAttribute(
        'fill',
        unitTile
          ? 'var(--ve-orange-soft)'
          : highlighted
            ? 'var(--ve-blue-soft)'
            : 'var(--ve-blue-wash)',
      );
      if (digit) {
        write(digit, p(countCues[c]));
        show(digit, !frame.has('more_rows'));
      }
    });
    rowValues.forEach((node, r) => {
      write(node, p(r === 0 ? 'row_total' : 'each_row'));
      show(node, !rowNumberFocus);
    });
    write(rowsLabel, p('four_rows'));
    show(rowsLabel, rowNumberFocus);
    const rowCount = totalCues.filter((id) => frame.has(id)).length;
    setText(countLabel, `Всего: ${rowCount * model.columns}`);
    // Placement uses the full text after every number change.
    if (layout) place(countLabel, layout.width / 2, layout.bottom + 38);
    show(countLabel, rowCount > 0 && !frame.has('addition'));
    sumParts.slice(0, -2).forEach((node, i) => write(node, p(sumCues[i])));
    write(
      sumParts.at(-2),
      progress(
        frame.cue('sum_four').end,
        frame.cue('sum_result').start - frame.cue('sum_four').end,
        t,
        reduced,
      ),
    );
    write(sumParts.at(-1), p('sum_result'));
    sumParts.forEach((node) => show(node, !frame.has('multiply')));
    meaning.forEach((node, i) => {
      write(node, p(meaningCues[i]));
      show(node, !frame.has('product_four'));
    });
    equation.forEach((node, i) => write(node, p(productCues[i])));
    answer.forEach((node, i) => write(node, p(answerCues[i])));
    draw(underline, p('product_result'));
    show(generic, formulas && frame.finished('answer_units'));
    paperCells.forEach((node, i) => show(node, p('recap_grid') * paperCells.length > i));
    root.dataset.phase = timing.segments.findLast((s) => t >= s.start)?.id || 'intro';
    root.dataset.visibleSquares = String(
      tiles.filter((tile) => tile.group.style.opacity === '1').length,
    );
    root.dataset.counted = String(rowCount * model.columns);
  }
  const measured = await observe(svg, (width) => {
    layer.querySelectorAll('[data-label] > text').forEach(resetText);
    const small = width < 440;
    // One centimetre is exactly two paper cells. Both layers use this scale and origin.
    const paperStep = Math.min(
      unitSize / cellsPerCm,
      Math.floor((width - 100) / model.columns / cellsPerCm),
    );
    const cell = paperStep * cellsPerCm;
    const left = (width - cell * model.columns) / 2,
      top = 126;
    const paperBox = root.getBoundingClientRect(),
      svgBox = svg.getBoundingClientRect();
    root.style.setProperty('--ve-grid-step', `${paperStep}px`);
    root.style.setProperty('--ve-grid-x', `${svgBox.left - paperBox.left + left}px`);
    root.style.setProperty('--ve-grid-y', `${svgBox.top - paperBox.top + top}px`);
    root.dataset.cmPixels = cell;
    root.dataset.paperCellMm = model.paperCellMm;
    const bottom = top + cell * model.rows;
    title.style.fontSize = `${small ? 27 : 34}px`;
    const titleWidth = title.getComputedTextLength();
    if (titleWidth > width - 16)
      title.style.fontSize = `${((small ? 27 : 34) * (width - 16)) / titleWidth}px`;
    unitArea.style.fontSize = `${Math.min(20, Math.max(12, (cell - 6) / 2.5))}px`;
    paperLabel.style.fontSize =
      unitWidth.style.fontSize =
      unitHeight.style.fontSize =
        `${small ? 14 : 16}px`;
    const numeralSize = small ? 27 : 34;
    [...sumParts, ...equation].forEach((node) => {
      node.style.fontSize = `${numeralSize}px`;
    });
    place(title, width / 2, 37);
    paperCell.setAttribute('x', left);
    paperCell.setAttribute('y', top);
    paperCell.setAttribute('width', paperStep);
    paperCell.setAttribute('height', paperStep);
    const horizontalMeasure = (length) =>
      `M${left} ${top - 7}h${length}M${left} ${top - 10}v6M${left + length} ${top - 10}v6`;
    paperMeasure.setAttribute('d', horizontalMeasure(paperStep));
    unitMeasure.setAttribute(
      'd',
      `${horizontalMeasure(cell)}M${left - 7} ${top}v${cell}M${left - 10} ${top}h6M${left - 10} ${top + cell}h6`,
    );
    heightSide.setAttribute('d', `M${left} ${top}V${bottom}`);
    widthSide.setAttribute('d', `M${left} ${top}H${left + cell * model.columns}`);
    paperCells.forEach((node, i) => {
      node.setAttribute('x', left + (i % cellsPerCm) * paperStep);
      node.setAttribute('y', top + Math.floor(i / cellsPerCm) * paperStep);
      node.setAttribute('width', paperStep);
      node.setAttribute('height', paperStep);
    });
    place(paperLabel, left + paperStep / 2, top - 23);
    place(unitArea, left + cell / 2, top + cell / 2);
    place(unitWidth, left + cell / 2, top - 23);
    place(unitHeight, left - 23, top + cell / 2);
    unitHeight.parentElement.setAttribute(
      'transform',
      `rotate(-90 ${left - 23} ${top + cell / 2})`,
    );
    place(unitGridHint, left + cell + 15, top + cell / 2, { anchor: 'left' });
    widthLabel.style.fontSize = heightLabel.style.fontSize = `${formulas ? 20 : 26}px`;
    place(widthLabel, width / 2, top - 29);
    place(heightLabel, left - 26, top + (cell * model.rows) / 2);
    heightLabel.parentElement.setAttribute(
      'transform',
      `rotate(-90 ${left - 26} ${top + (cell * model.rows) / 2})`,
    );
    boundary.setAttribute('transform', `translate(${left} ${top}) scale(${cell / unitSize})`);
    tiles.forEach(({ group }, i) =>
      group.setAttribute(
        'transform',
        `translate(${left + (i % model.columns) * cell} ${top + Math.floor(i / model.columns) * cell}) scale(${cell / unitSize})`,
      ),
    );
    rowValues.forEach((node, r) =>
      place(node, left + cell * model.columns + 22, top + (r + 0.5) * cell),
    );
    const rowLabelX = left + cell * model.columns + 22,
      rowLabelY = top + (cell * model.rows) / 2;
    place(rowsLabel, rowLabelX, rowLabelY);
    rowsLabel.parentElement.setAttribute('transform', `rotate(90 ${rowLabelX} ${rowLabelY})`);
    row(sumParts, { x: width / 2, y: bottom + 38, gap: small ? 5 : 10 });
    place(countLabel, width / 2, bottom + 38);
    row(meaning, { x: width / 2, y: bottom + 38, gap: small ? 8 : 12 });
    row(equation, { x: width / 2, y: bottom + 38, gap: small ? 14 : 20 });
    row(answer, { x: width / 2, y: bottom + 90, gap: 8 });
    place(generic, width / 2, bottom + 132);
    const b = box(equation[equation.length - 1]);
    underline.setAttribute(
      'd',
      `M${b.x - 4} ${b.y + b.height + 6} Q${b.cx} ${b.y + b.height + 12} ${b.x + b.width + 4} ${b.y + b.height + 6}`,
    );
    layout = { width, bottom };
    player?.update();
    return bottom + (formulas ? 158 : 116);
  });
  function mode(value) {
    formulas = value;
    setText(widthLabel, formulas ? `b = ${model.columns} см` : `${model.columns} см`);
    setText(heightLabel, formulas ? `a = ${model.rows} см` : `${model.rows} см`);
    root.querySelector('[data-numbers]').setAttribute('aria-pressed', String(!formulas));
    root.querySelector('[data-formulas]').setAttribute('aria-pressed', String(formulas));
    measured.update();
    player.update();
  }
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  root.querySelector('[data-numbers]').addEventListener('click', () => mode(false), listen);
  root.querySelector('[data-formulas]').addEventListener('click', () => mode(true), listen);
  player = story({ script: timing, audio, stateAt: (frame) => frame, render });
  const stops = [
    { time: 0, label: 'Прямоугольник: 4 см в высоту, 5 см в ширину' },
    { time: C.unit.start, label: '1 см² — квадрат из 2 × 2 клеток бумаги' },
    { time: C.first_row.start, label: 'Считаем первый ряд: 1, 2, 3, 4, 5' },
    { time: C.more_rows.start, label: 'Четыре одинаковых ряда по пять квадратиков' },
    { time: C.count_rows.start, label: 'Считаем рядами: 5, 10, 15, 20' },
    { time: C.addition.start, label: '5 + 5 + 5 + 5 = 20' },
    { time: C.multiply.start, label: '4 раза по 5 → 4 × 5 = 20' },
    { time: C.answer.start, label: 'Площадь равна 20 см²: 20 квадратов по 2 × 2 клетки' },
  ];
  const ui = storyPlayer(root.querySelector('[data-player]'), {
    transport: player.player,
    stops: stops.map((stop) => stop.time),
    onSeek: player.seek,
    captions: {
      element: root.querySelector('[data-caption]'),
      segments: stops.map(({ time, label }) => ({ start: time, text: label })),
    },
  });
  root.scene = {
    duration: timing.duration,
    get currentTime() {
      return player.currentTime;
    },
    play: player.player.play,
    seek: player.seek,
    pause: player.pause,
    setReduced: player.setReduced,
    snapshot: () => ({ ...model, time: player.currentTime, formulas }),
    review: player.review,
    dispose() {
      if (abort.signal.aborted) return;
      abort.abort();
      ui.dispose();
      player.dispose();
      measured.dispose();
      root.replaceChildren();
      delete root.scene;
    },
  };
})().catch((error) => {
  const caption = document.querySelector('[data-caption]');
  caption.classList.remove('sr-only');
  caption.setAttribute('role', 'alert');
  caption.textContent = error.message;
  throw error;
});
