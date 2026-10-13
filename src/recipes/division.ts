import { DIVISION_MAX_COUNT } from './division-capacity.js';
import { divisionParts } from './division-parts.js';
import type { Surface } from '../ink/surface.js';
import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { svg } from '../ink/dom.js';
import { pen, type Point } from '../ink/pen.js';
import { token, regroup } from './tokens.js';
import { formula } from './formula.js';
import {
  divisionState,
  divisionItemId,
  divisionGroupId,
  divisionProgress,
  type DivisionState,
} from '../math/division.js';

/** Drawing capacity, separate from the unbounded safe-integer arithmetic model. */
export { DIVISION_MAX_COUNT } from './division-capacity.js';
export type DivisionFocusTarget = 'groups' | 'remainder' | 'equation';
export type DivisionFocus = 'all' | readonly DivisionFocusTarget[];
export interface DivisionDiagramOptions {
  width: number;
  height: number;
  /** Logical drawing unit to displayed CSS pixels. */
  scale: number;
  progress: number;
  showEquation: boolean;
  text?: string;
  focus?: DivisionFocus;
  viewIds?: { groups: string; equation?: string };
}

function grid(count: number, width: number, height: number, cellWidth = 1.4, cellHeight = 1.4) {
  let result = { columns: 1, rows: 1, size: Math.min(width, height) };
  if (!count) return result;
  result.size = 0;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const size = Math.min(width / (columns * cellWidth), height / (rows * cellHeight));
    if (size > result.size) result = { columns, rows, size };
  }
  return result;
}

/** A collection on the left becomes complete, individually traceable groups on the right. */
export function divisionDiagram(surface: Surface, id: string) {
  if (!id.trim()) throw new Error('Division diagram needs a stable ID');
  let disposed = false;
  let current: ReturnType<typeof prepare> | undefined;
  let key = '';
  let preparation = 0;

  function validate(state: DivisionState, options: DivisionDiagramOptions) {
    const expected = divisionState(state.count, state.divisor, { id: state.id });
    if (state.quotient !== expected.quotient || state.remainder !== expected.remainder)
      throw new Error('Division result does not match its accepted inputs');
    if (state.count > DIVISION_MAX_COUNT)
      throw new Error(`This drawing supports at most ${DIVISION_MAX_COUNT} individual objects`);
    if (![options.width, options.height, options.scale].every((v) => Number.isFinite(v) && v > 0))
      throw new Error('Division drawing dimensions and scale must be positive');
    if (
      typeof options.showEquation !== 'boolean' ||
      (options.text !== undefined && typeof options.text !== 'string')
    )
      throw new Error('Division drawing needs valid equation and text options');
    if (
      options.focus !== undefined &&
      options.focus !== 'all' &&
      (!Array.isArray(options.focus) ||
        options.focus.some((target) => !['groups', 'remainder', 'equation'].includes(target)))
    )
      throw new Error('Unknown division focus');
    if (
      options.viewIds &&
      (typeof options.viewIds.groups !== 'string' ||
        !options.viewIds.groups.trim() ||
        (options.viewIds.equation !== undefined &&
          (typeof options.viewIds.equation !== 'string' ||
            !options.viewIds.equation.trim() ||
            options.viewIds.equation === options.viewIds.groups)))
    )
      throw new Error('Division views need distinct, non-empty IDs');
    divisionProgress(state, options.progress);
  }

  function prepare(state: DivisionState, options: DivisionDiagramOptions) {
    // Work in displayed pixels, then convert once to the scene's logical units.
    const width = options.width * options.scale,
      height = options.height * options.scale;
    const margin = Math.min(24, Math.max(10, width * 0.025));
    const font = Math.max(16, Math.min(25, width / 32));
    const sentence = options.text?.trim() ?? '';
    const textHeight = sentence ? font * 2.7 : 0;
    const equationY = height - margin - textHeight;
    const top = margin + font * 1.7;
    const drawingHeight = equationY - font * 1.7 - top;
    const availableWidth = width - margin * 2;
    const gap = Math.max(15, availableWidth * 0.045);
    const sourceWidth = (availableWidth - gap) * 0.4;
    const targetWidth = availableWidth - sourceWidth - gap;
    if (width < 260 || drawingHeight < 28 || sourceWidth < font * 5)
      throw new Error('Division drawing needs more room for readable objects and labels');
    const sourceX = margin + sourceWidth / 2;
    const targetX = margin + sourceWidth + gap + targetWidth / 2;
    const centerY = top + drawingHeight / 2;
    const sourceGrid = grid(state.count, sourceWidth, drawingHeight);
    const members = Math.min(state.count, state.divisor);
    const memberColumns = members <= 4 ? Math.max(1, members) : Math.ceil(Math.sqrt(members));
    const memberRows = Math.ceil(members / memberColumns);
    const groupWidth = memberColumns * 1.4 + 0.8;
    const groupHeight = Math.max(1, memberRows) * 1.4 + 0.8;
    const groupGrid = grid(
      state.quotient,
      targetWidth,
      drawingHeight,
      groupWidth + 0.7,
      groupHeight + 0.7,
    );
    const size = Math.min(32, sourceGrid.size, state.quotient ? groupGrid.size : 32);
    if (state.count && size < 7)
      throw new Error(
        'Division drawing cannot keep this many individual objects distinct at this size',
      );
    const point = (x: number, y: number): Point => [x / options.scale, y / options.scale];
    const positions = (
      count: number,
      columns: number,
      x: number,
      y: number,
      spacing = size * 1.4,
    ) =>
      Array.from({ length: count }, (_, i): Point => {
        const row = Math.floor(i / columns);
        const rowCount = Math.min(columns, count - row * columns);
        return point(
          x + ((i % columns) - (rowCount - 1) / 2) * spacing,
          y + (row - (Math.ceil(count / columns) - 1) / 2) * spacing,
        );
      });
    const from = positions(state.count, sourceGrid.columns, sourceX, centerY);
    const leftovers = positions(
      state.remainder,
      Math.min(sourceGrid.columns, Math.max(1, state.remainder)),
      sourceX,
      centerY,
    );
    const groupCenters = Array.from({ length: state.quotient }, (_, i): Point => {
      const row = Math.floor(i / groupGrid.columns);
      const rowCount = Math.min(groupGrid.columns, state.quotient - row * groupGrid.columns);
      return [
        targetX + ((i % groupGrid.columns) - (rowCount - 1) / 2) * (groupWidth + 0.7) * size,
        centerY + (row - (groupGrid.rows - 1) / 2) * (groupHeight + 0.7) * size,
      ];
    });
    const to = groupCenters
      .flatMap(([x, y]) => positions(state.divisor, memberColumns, x, y))
      .concat(leftovers);

    // A hidden preparation layer permits font measurement without touching the last displayed frame.
    const canvas = svg('svg', {
      id: `${surface.element.id}-division-${++preparation}`,
      viewBox: `0 0 ${options.width} ${options.height}`,
      width: options.width,
      height: options.height,
      visibility: 'hidden',
      'aria-hidden': 'true',
      overflow: 'visible',
    });
    const layer = svg('g', { 'data-division': id });
    canvas.append(layer);
    surface.layer.append(canvas);
    const drawingPen = pen(canvas);
    const cleanups: (() => void)[] = [];
    const picture = object(layer, options.viewIds?.groups ?? id);
    picture.describe({
      label: 'Предметы собираются в полные группы',
      value: () => state.count,
      interactive: false,
    });
    const scope = { ...surface, layer: picture.content, pen: drawingPen };
    const observed = {
      completedGroups: 0,
      ungrouped: state.count,
      complete: false,
      parts: divisionParts(state, options.progress),
    };
    try {
      const items = from.map((_, i) => {
        const itemId = divisionItemId(state, i);
        const mark = token(scope, itemId, '', { size: 32, pigment: 'blue' });
        mark.describe({
          label: `Предмет ${i + 1}`,
          value: () => 1,
          unit: 'предмет',
          provenance: () => observed.parts[i],
          interactive: false,
        });
        cleanups.push(() => {
          mark.label.dispose();
          mark.dispose();
        });
        return mark;
      });
      const groups = groupCenters.map(([x, y], i) => {
        const groupId = divisionGroupId(state, i);
        const mark = object(picture.content, groupId, 'blue');
        const itemIds = Array.from({ length: state.divisor }, (_, member) =>
          divisionItemId(state, i * state.divisor + member),
        );
        mark.describe({
          label: `Группа ${i + 1} из ${state.divisor} предметов`,
          value: () => (observed.completedGroups > i ? state.divisor : 0),
          inputs: () => itemIds,
          interactive: false,
        });
        const [cx, cy] = point(x, y);
        mark.at(cx, cy);
        const border = drawingPen.rect(
          mark.content,
          `${groupId}:boundary`,
          (-groupWidth * size) / options.scale / 2,
          (-groupHeight * size) / options.scale / 2,
          (groupWidth * size) / options.scale,
          (groupHeight * size) / options.scale,
          { width: 1.1 / options.scale, stroke: 'currentColor' },
        );
        // Group contours sit behind the objects that establish their membership.
        picture.content.prepend(mark.element);
        return { mark, border };
      });
      const source = object(picture.content, `${state.id}:remainder`, 'ink');
      source.describe({
        label: 'Ещё не собранные предметы и остаток',
        value: () => observed.ungrouped,
        inputs: () =>
          from
            .slice(observed.completedGroups * state.divisor)
            .map((_, i) => divisionItemId(state, observed.completedGroups * state.divisor + i)),
        provenance: () => ({ kind: observed.complete ? 'remainder' : 'ungrouped' }),
        interactive: false,
      });
      const sourceLabel = lettering(source.content, '', { size: font / options.scale });
      source.at(...point(sourceX, margin + font));
      cleanups.push(sourceLabel.dispose);
      const target = object(picture.content, `${state.id}:quotient`, 'blue');
      target.describe({
        label: 'Полные группы',
        value: () => observed.completedGroups,
        inputs: () =>
          groups.slice(0, observed.completedGroups).map((_, i) => divisionGroupId(state, i)),
        interactive: false,
      });
      const targetLabel = lettering(target.content, '', { size: font / options.scale });
      target.at(...point(targetX, margin + font));
      cleanups.push(targetLabel.dispose);
      // Check every counter caption before a future frame can select it.
      for (let completed = 0; completed <= state.quotient; completed++) {
        sourceLabel.text(`Ещё: ${state.count - completed * state.divisor}`);
        targetLabel.text(`Группы: ${completed}`);
        if (
          sourceLabel.width * options.scale > sourceWidth ||
          targetLabel.width * options.scale > targetWidth
        )
          throw new Error('Division counter labels need a wider drawing');
      }
      for (const caption of [`Всего: ${state.count}`, `Остаток: ${state.remainder}`]) {
        sourceLabel.text(caption);
        if (sourceLabel.width * options.scale > sourceWidth)
          throw new Error('Division remainder label needs a wider drawing');
      }
      const identity = formula(
        layer,
        options.viewIds?.equation ?? `${state.id}:identity`,
        [
          { id: 'count', text: state.count },
          { id: 'equals', text: '=' },
          { id: 'quotient', text: state.quotient, pigment: 'blue' },
          { id: 'times', text: '×', pigment: 'blue' },
          { id: 'divisor', text: state.divisor, pigment: 'blue' },
          { id: 'plus', text: '+' },
          { id: 'remainder', text: state.remainder, pigment: 'red' },
        ],
        font / options.scale,
      );
      identity.at(...point(width / 2, equationY));
      identity.describe({
        label: `${state.count} = ${state.quotient} × ${state.divisor} + ${state.remainder}`,
        inputs: () => [`${state.id}:quotient`, `${state.id}:remainder`],
        interactive: false,
      });
      cleanups.push(identity.dispose);
      if (identity.width * options.scale > availableWidth)
        throw new Error('Division identity needs a wider drawing at a readable text size');
      const lines: string[] = [];
      const narration = lettering(layer, '', { size: font / options.scale });
      cleanups.push(narration.dispose);
      let line = '';
      for (const word of sentence.split(/\s+/).filter(Boolean)) {
        narration.text(line ? `${line} ${word}` : word);
        if (narration.width * options.scale > availableWidth) {
          if (!line)
            throw new Error('Division narration contains a word that needs a wider drawing');
          lines.push(line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push(line);
      if (lines.length > 2) throw new Error('Division narration needs at most two readable lines');
      for (const line of lines) {
        narration.text(line);
        if (narration.width * options.scale > availableWidth)
          throw new Error('Division narration contains a word that needs a wider drawing');
      }
      narration.text(lines[0] ?? '');
      narration.at(...point(width / 2, equationY + font * 1.45));
      if (lines[1]) {
        const second = lettering(layer, lines[1], { size: font / options.scale });
        second.at(...point(width / 2, equationY + font * 2.7));
        cleanups.push(second.dispose);
      }
      const focuses = (['groups', 'remainder', 'equation'] as const).map((target) => {
        const x = target === 'groups' ? targetX : target === 'equation' ? width / 2 : sourceX;
        const y = target === 'equation' ? equationY + font * 0.3 : margin + font * 1.25;
        return {
          target,
          mark: drawingPen.path(
            layer,
            `${id}:focus:${target}`,
            `M${(x - sourceWidth * 0.28) / options.scale} ${y / options.scale} h${(sourceWidth * 0.56) / options.scale}`,
            { width: 1.5 / options.scale },
          ),
        };
      });
      return {
        canvas,
        layer,
        items,
        groups,
        source,
        sourceLabel,
        targetLabel,
        identity,
        focuses,
        observed,
        from,
        to,
        size,
        dispose() {
          for (const cleanup of cleanups) cleanup();
          canvas.remove();
        },
      };
    } catch (error) {
      for (const cleanup of cleanups) cleanup();
      canvas.remove();
      throw error;
    }
  }

  function render(state: DivisionState, options: DivisionDiagramOptions) {
    if (disposed) throw new Error('Division drawing has been disposed');
    validate(state, options);
    const moment = divisionProgress(state, options.progress);
    const nextKey = JSON.stringify([
      state,
      options.width,
      options.height,
      options.scale,
      options.text ?? '',
      options.viewIds,
    ]);
    let next = current;
    if (nextKey !== key || !next) next = prepare(state, options);
    const groupedCount = state.quotient * state.divisor;
    const locations = next.from.map((start, i) => {
      const amount =
        i < groupedCount
          ? Math.max(
              0,
              Math.min(1, options.progress * state.quotient - Math.floor(i / state.divisor)),
            )
          : options.progress;
      return regroup([start], [next.to[i]!], amount)[0]!;
    });
    // After preparation, rendering only applies already validated positions and captions.
    Object.assign(next.observed, moment, { parts: divisionParts(state, options.progress) });
    next.items.forEach((mark, i) => {
      const [x, y] = locations[i]!;
      mark.element.setAttribute(
        'transform',
        `translate(${x} ${y}) scale(${next.size / options.scale / 32})`,
      );
      mark.pigment(moment.complete && i >= groupedCount ? 'red' : 'blue');
      mark.element.dataset.divisionRole =
        moment.complete && i >= groupedCount
          ? 'remainder'
          : i < moment.completedGroups * state.divisor
            ? 'grouped'
            : 'ungrouped';
    });
    next.groups.forEach(({ mark, border }, i) => {
      const amount = Math.max(0, Math.min(1, options.progress * state.quotient - i));
      mark.show(amount > 0);
      border.reveal(amount);
      mark.element.dataset.complete = String(i < moment.completedGroups);
    });
    next.sourceLabel.text(
      moment.complete
        ? `Остаток: ${state.remainder}`
        : options.progress === 0
          ? `Всего: ${state.count}`
          : `Ещё: ${moment.ungrouped}`,
    );
    next.source.pigment(moment.complete ? 'red' : 'ink');
    next.targetLabel.text(`Группы: ${moment.completedGroups}`);
    next.identity.show(options.showEquation && moment.complete);
    const focus = options.focus ?? 'all';
    for (const { target, mark } of next.focuses)
      mark.reveal(
        focus !== 'all' &&
          focus.includes(target) &&
          (target !== 'equation' || (options.showEquation && moment.complete))
          ? 1
          : 0,
      );
    next.layer.dataset.count = String(state.count);
    next.layer.dataset.completedGroups = String(moment.completedGroups);
    next.layer.dataset.ungrouped = String(moment.ungrouped);
    next.layer.dataset.complete = String(moment.complete);
    next.layer.dataset.focus = focus === 'all' ? focus : focus.join(' ');
    if (next !== current) {
      current?.dispose();
      current = next;
      key = nextKey;
      next.canvas.removeAttribute('visibility');
      next.canvas.removeAttribute('aria-hidden');
    }
  }

  return {
    render,
    /** Check the complete future composition without replacing the accepted drawing. */
    validate(state: DivisionState, options: DivisionDiagramOptions) {
      if (disposed) throw new Error('Division drawing has been disposed');
      validate(state, options);
      const prepared = prepare(state, options);
      prepared.dispose();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      current?.dispose();
      current = undefined;
    },
  };
}
