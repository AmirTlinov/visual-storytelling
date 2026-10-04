import { surface, type Surface } from '../../ink/surface.js';
import { svg } from '../../ink/dom.js';
import { paragraph } from '../../ink/paragraph.js';
import { fusionText } from '../../ink/fusion/text.js';
import { color } from '../../ink/palette.js';
import { placeLabels, type LabelBox } from '../../layout/labels.js';
import { contentViewport } from '../../layout/content.js';
import { constructionPlan } from './plan.js';
import {
  mathMotionFrame,
  morphTiming,
  watchMotion,
  type MorphCues,
  type MorphTime,
} from '../timing.js';
import type {
  ConstructionOperation,
  ConstructionPlan,
  DiagramPanel,
  DiagramPath,
  DiagramPoint,
  MaterialPatch,
} from './types.js';

let serial = 0;
type Stroke = ReturnType<Surface['pen']['polyline']>;
type Boundary = ReturnType<Surface['pen']['contour']>;
const points = (path: readonly DiagramPoint[]) =>
  path.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`);
type AnnotationLayout = { left: number; right: number; order: string[] };

/** Reserve measured annotation space for the entire operation, so changing digits never move the drawing. */
function annotationLayout(plan: ConstructionPlan) {
  const margins = new Map<string, AnnotationLayout>(),
    positions = new Map<string, Map<string, { sum: number; count: number }>>(),
    widths = new Map<string, number>();
  for (let i = 0; i <= plan.stages * 24; i++) {
    for (const panel of plan.sample(i / (plan.stages * 24)).panels) {
      const entry = margins.get(panel.id) ?? { left: 44, right: 44, order: [] };
      const [lo, hi] = panel.bounds,
        span = hi[0] - lo[0];
      const anchors = positions.get(panel.id) ?? new Map();
      positions.set(panel.id, anchors);
      for (const label of panel.labels ?? []) {
        const anchor = anchors.get(label.id) ?? { sum: 0, count: 0 };
        anchor.sum +=
          ((label.at[1] + (label.to ?? label.at)[1]) / 2 - lo[1]) / (hi[1] - lo[1]) +
          (label.side === 'top' ? 0.12 : label.side === 'bottom' ? -0.12 : 0);
        anchor.count++;
        anchors.set(label.id, anchor);
        if (
          (label.side === 'left' && label.at[0] <= lo[0] + span * 0.18) ||
          (label.side === 'right' && label.at[0] >= hi[0] - span * 0.18)
        ) {
          let width = widths.get(label.text);
          if (width === undefined) {
            width = fusionText(label.text, { size: 19 }).bounds.width;
            widths.set(label.text, width);
          }
          entry[label.side] = Math.max(entry[label.side], width + 24);
        }
      }
      margins.set(panel.id, entry);
    }
  }
  for (const [id, entry] of margins)
    entry.order = [...positions.get(id)!]
      .sort(([a, p], [b, q]) => q.sum / q.count - p.sum / p.count || a.localeCompare(b))
      .map(([id]) => id);
  return margins;
}

function panelRenderer(sheet: Surface, id: string) {
  const root = svg('g', { 'data-subject': id }),
    geometry = svg('g'),
    annotations = svg('g');
  root.append(geometry, annotations);
  sheet.layer.append(root);
  const heading = paragraph(root, { size: 20 });
  const paths = new Map<string, { shape: Stroke | Boundary; signature: string }>();
  const ink = new Map<string, SVGPathElement>();
  const labels = new Map<
    string,
    { wrapper: SVGGElement; text: ReturnType<typeof paragraph>; background: SVGRectElement }
  >();
  const texts = new Map<string, ReturnType<typeof fusionText>>();
  let used = new Set<string>();
  let usedText = new Set<string>();
  const draw = (item: DiagramPath, pixel: (point: DiagramPoint) => DiagramPoint) => {
    const key = item.id;
    used.add(key);
    const coordinates = item.points.map(pixel);
    if (coordinates.length < 2 || coordinates.some((p) => !p.every(Number.isFinite)))
      throw new Error('A construction path needs finite geometry');
    const signature = `${Boolean(item.closed)}/${Boolean(item.fill)}/${Boolean(item.quiet)}`;
    let entry = paths.get(key);
    if (entry && entry.signature !== signature) {
      entry.shape.dispose();
      paths.delete(key);
      entry = undefined;
    }
    if (!entry) {
      const options = {
        width: item.quiet ? 1 : 1.8,
        fill: item.fill ? ('marker' as const) : ('none' as const),
      };
      entry = {
        signature,
        shape: item.closed
          ? sheet.pen.contour(geometry, `${id}-${key}`, coordinates, options)
          : sheet.pen.polyline(geometry, `${id}-${key}`, coordinates, options),
      };
      paths.set(key, entry);
    } else entry.shape.update(coordinates);
    entry.shape.element.style.color = color(item.pigment ?? 'ink');
    entry.shape.element.style.opacity = String((item.opacity ?? 1) * (item.quiet ? 0.44 : 1));
    entry.shape.element.style.strokeDasharray = item.dashed ? '5 5' : '';
    entry.shape.element.setAttribute('data-subject', key);
    if (item.arrow && coordinates.length > 1) {
      const a = coordinates.at(-2)!,
        b = coordinates.at(-1)!;
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 4)
        draw(
          {
            ...item,
            id: `${key}-tip`,
            arrow: false,
            points: [
              [b[0] - 7 * Math.cos(angle - 0.45), b[1] - 7 * Math.sin(angle - 0.45)],
              b,
              [b[0] - 7 * Math.cos(angle + 0.45), b[1] - 7 * Math.sin(angle + 0.45)],
            ],
          },
          (p) => p,
        );
    }
  };
  const material = (
    patch: MaterialPatch,
    pixel: (point: DiagramPoint) => DiagramPoint,
    units: number,
  ) => {
    const [[x0, y0], [x1, y1]] = patch.domain;
    const edge = (a: DiagramPoint, b: DiagramPoint) =>
      Array.from(
        { length: 25 },
        (_, i): DiagramPoint => [a[0] + ((b[0] - a[0]) * i) / 25, a[1] + ((b[1] - a[1]) * i) / 25],
      );
    const boundary = [
      ...edge([x0, y0], [x1, y0]),
      ...edge([x1, y0], [x1, y1]),
      ...edge([x1, y1], [x0, y1]),
      ...edge([x0, y1], [x0, y0]),
    ].map(patch.map);
    draw(
      {
        id: patch.id,
        points: boundary,
        closed: true,
        fill: true,
        pigment: patch.pigment,
        opacity: patch.opacity,
      },
      pixel,
    );
    const at = (x: number, y: number) => pixel(patch.map([x, y]));
    if (patch.grid)
      for (const axis of [0, 1] as const) {
        const divisions = patch.grid[axis];
        for (let i = 1; i < divisions; i++) {
          const value =
            patch.domain[0][axis] +
            ((patch.domain[1][axis] - patch.domain[0][axis]) * i) / divisions;
          draw(
            {
              id: `${patch.id}-grid-${axis}-${i}`,
              points: Array.from({ length: 33 }, (_, j) =>
                patch.map(
                  axis === 0
                    ? [value, y0 + ((y1 - y0) * j) / 32]
                    : [x0 + ((x1 - x0) * j) / 32, value],
                ),
              ),
              pigment: patch.pigment,
              quiet: true,
              opacity: patch.opacity,
            },
            pixel,
          );
        }
      }
    if (patch.text) {
      const textKey = patch.text;
      usedText.add(textKey);
      let shape = texts.get(textKey);
      if (!shape) {
        shape = fusionText(patch.text, { size: 100, maxWidth: 1200 });
        texts.set(textKey, shape);
      }
      const k = Math.min(
        ((x1 - x0) * 0.66) / shape.bounds.width,
        ((y1 - y0) * 0.5) / shape.bounds.height,
        38 / (shape.bounds.height * units),
      );
      const center = at((x0 + x1) / 2, (y0 + y1) / 2),
        across = at((x0 + x1) / 2 + k, (y0 + y1) / 2);
      const weight = Math.max(
        1.5,
        Math.min(3.2, Math.hypot(center[0] - across[0], center[1] - across[1]) * 2.8),
      );
      shape.paths.forEach((stroke, i) => {
        const key = `${patch.id}-ink-${i}`;
        used.add(key);
        let mark = ink.get(key);
        if (!mark) {
          mark = svg('path', {
            fill: 'none',
            stroke: 'var(--ve-ink)',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          });
          ink.set(key, mark);
          geometry.append(mark);
        }
        const mapped = stroke.map((p) => at((x0 + x1) / 2 + p[0] * k, (y0 + y1) / 2 - p[1] * k));
        mark.setAttribute('d', `M${points(mapped).join('L')}`);
        mark.setAttribute('stroke-width', String(weight));
        mark.style.opacity = String(patch.opacity ?? 1);
      });
    }
  };
  return {
    render(
      panel: DiagramPanel,
      x: number,
      y: number,
      width: number,
      height: number,
      margins: AnnotationLayout,
    ) {
      used = new Set();
      usedText = new Set();
      root.setAttribute('transform', `translate(${x} ${y})`);
      const headingHeight = heading.render(panel.title, width - 12, width / 2, 23);
      const [[left, bottom], [right, top]] = panel.bounds;
      const plotTop = 30 + headingHeight;
      const leftMargin = Math.min(width * 0.44, margins.left),
        rightMargin = Math.min(width * 0.44, margins.right);
      const availableWidth = width - leftMargin - rightMargin,
        availableHeight = height - plotTop - 50;
      let sx = availableWidth / Math.max(0.001, right - left),
        sy = availableHeight / Math.max(0.001, top - bottom);
      if (panel.aspect !== 'free') sx = sy = Math.min(sx, sy);
      const pixel = ([px, py]: DiagramPoint): DiagramPoint => [
        leftMargin + availableWidth / 2 + (px - (left + right) / 2) * sx,
        plotTop + availableHeight / 2 - (py - (top + bottom) / 2) * sy,
      ];
      for (const patch of panel.patches ?? []) material(patch, pixel, Math.min(sx, sy));
      for (const item of panel.paths ?? []) draw(item, pixel);
      // Keep the prepared ordering, including hidden labels. Fade-in cannot rearrange its neighbours.
      const visible = [...(panel.labels ?? [])].sort(
        (a, b) => margins.order.indexOf(a.id) - margins.order.indexOf(b.id),
      );
      const preferred: LabelBox[] = [];
      const entries = visible.map((item) => {
        const key = `label-${item.id}`;
        used.add(key);
        let entry = labels.get(key);
        if (!entry) {
          const wrapper = svg('g'),
            background = svg('rect', { rx: 3, fill: 'var(--ve-surface)', opacity: 0.92 });
          wrapper.append(background);
          annotations.append(wrapper);
          entry = { wrapper, background, text: paragraph(wrapper, { size: 19, lineHeight: 1.25 }) };
          labels.set(key, entry);
        }
        entry.wrapper.style.color = color(item.pigment ?? 'ink');
        entry.wrapper.style.opacity = String(item.opacity ?? 1);
        const span = right - left;
        const labelWidth =
          item.side === 'left' && item.at[0] <= left + span * 0.18
            ? leftMargin - 14
            : item.side === 'right' && item.at[0] >= right - span * 0.18
              ? rightMargin - 14
              : width - 24;
        entry.text.render(item.text, Math.max(38, labelWidth), 0, 0);
        const box = entry.text.bounds;
        const a = pixel(item.at),
          b = item.to ? pixel(item.to) : a;
        const side = item.side ?? 'top',
          ox = side === 'left' ? -1 : side === 'right' ? 1 : 0,
          oy = side === 'top' ? -1 : side === 'bottom' ? 1 : 0;
        let cx = (a[0] + b[0]) / 2 + ox * (box.width / 2 + 12),
          cy = (a[1] + b[1]) / 2 + oy * (box.height / 2 + 12);
        if (item.to && Math.hypot(a[0] - b[0], a[1] - b[1]) > 2) {
          const offset = 14;
          const endA: DiagramPoint = [a[0] + ox * offset, a[1] + oy * offset],
            endB: DiagramPoint = [b[0] + ox * offset, b[1] + oy * offset];
          draw(
            {
              id: `measure-${item.id}`,
              points: [endA, endB],
              pigment: item.pigment,
              quiet: true,
              opacity: item.opacity,
            },
            (p) => p,
          );
          for (const [i, end] of [endA, endB].entries())
            draw(
              {
                id: `measure-${item.id}-${i}`,
                points: [
                  [end[0] - oy * 3, end[1] + ox * 3],
                  [end[0] + oy * 3, end[1] - ox * 3],
                ],
                pigment: item.pigment,
                quiet: true,
                opacity: item.opacity,
              },
              (p) => p,
            );
          cx += ox * offset;
          cy += oy * offset;
        }
        preferred.push({
          x: cx - box.width / 2 - 3,
          y: cy - box.height / 2 - 2,
          width: box.width + 6,
          height: box.height + 4,
        });
        return { entry, box };
      });
      const labelHeight = preferred.reduce((sum, box) => sum + box.height + 8, -8);
      // This upper bound makes every prepared pair constraint feasible, including stacked labels.
      if (labelHeight > height - plotTop + 9) return plotTop - 9 + labelHeight;
      const placed = placeLabels(preferred, {
        x: 3,
        y: plotTop - 12,
        width: width - 6,
        height: height - plotTop + 9,
      });
      entries.forEach(({ entry, box }, i) => {
        const p = placed[i]!;
        entry.wrapper.setAttribute('transform', `translate(${p.x + 3 - box.x} ${p.y + 2 - box.y})`);
        for (const [key, value] of Object.entries({
          x: box.x - 3,
          y: box.y - 2,
          width: box.width + 6,
          height: box.height + 4,
        }))
          entry.background.setAttribute(key, String(value));
      });
      for (const [key, value] of paths)
        if (!used.has(key)) {
          value.shape.dispose();
          paths.delete(key);
        }
      for (const [key, value] of ink)
        if (!used.has(key)) {
          value.remove();
          ink.delete(key);
        }
      for (const [key, value] of labels)
        if (!used.has(key)) {
          value.text.dispose();
          value.wrapper.remove();
          labels.delete(key);
        }
      for (const key of texts.keys()) if (!usedText.has(key)) texts.delete(key);
      return height;
    },
    dispose() {
      root.remove();
      heading.dispose();
      paths.forEach((p) => p.shape.dispose());
      labels.forEach((p) => p.text.dispose());
      texts.clear();
    },
  };
}

/** Shared geometry, pen, layout, measured labels and narrative motion for mathematical constructions. */
export function mountConstruction(
  parent: HTMLElement,
  operation: ConstructionOperation | ConstructionPlan,
) {
  let plan = constructionPlan(operation),
    disposed = false,
    lastTime: MorphTime = 0,
    lastCues: MorphCues | undefined;
  let margins = annotationLayout(plan);
  const sheet = surface(parent, {
    id: `math-construction-${serial++}`,
    width: 800,
    height: 480,
    title: 'Математическое преобразование',
    description: '',
    grid: false,
  });
  sheet.element.classList.add('ve-construction');
  const viewport = contentViewport(parent);
  const equation = paragraph(sheet.layer, { size: 26 }),
    explanation = paragraph(sheet.layer, { size: 20 });
  equation.element.style.color = color('purple');
  const panels = new Map<string, ReturnType<typeof panelRenderer>>();
  function render(time: MorphTime, cues?: MorphCues) {
    if (disposed) return;
    const timing = morphTiming(time, cues, plan.stages);
    const frame = mathMotionFrame(plan, timing);
    const width = Math.max(280, parent.clientWidth),
      gap = 24;
    const columns = width >= 680 ? Math.min(2, frame.panels.length) : 1;
    const panelWidth = (width - gap * (columns - 1)) / columns;
    let panelHeight =
      columns === 1 && frame.panels.length === 1 ? Math.max(290, Math.min(430, width * 0.55)) : 330;
    const renderPanels = () =>
      Math.max(
        ...frame.panels.map((panel, i) => {
          let renderer = panels.get(panel.id);
          if (!renderer) {
            renderer = panelRenderer(sheet, panel.id);
            panels.set(panel.id, renderer);
          }
          return renderer.render(
            panel,
            (i % columns) * (panelWidth + gap),
            Math.floor(i / columns) * (panelHeight + 16),
            panelWidth,
            panelHeight,
            margins.get(panel.id)!,
          );
        }),
      );
    const measuredHeight = renderPanels();
    if (measuredHeight > panelHeight) {
      panelHeight = measuredHeight;
      renderPanels();
    }
    const rows = Math.ceil(frame.panels.length / columns),
      drawingHeight = rows * panelHeight + (rows - 1) * 16;
    const formulaY = drawingHeight + 22;
    const equationHeight = equation.render(frame.formula, width - 28, width / 2, formulaY);
    const descriptionY = formulaY + Math.max(equationHeight, width < 480 ? 64 : 36) + 22;
    const descriptionHeight = explanation.render(
      frame.explanation,
      width - 32,
      width / 2,
      descriptionY,
    );
    const height = Math.ceil(
      descriptionY + Math.max(descriptionHeight, width < 480 ? 140 : 70) + 14,
    );
    sheet.resize(width, height, false);
    viewport.resize(height);
    for (const [id, renderer] of panels)
      if (!frame.panels.some((p) => p.id === id)) {
        renderer.dispose();
        panels.delete(id);
      }
    sheet.element.querySelector('desc')!.textContent = `${frame.formula}. ${frame.explanation}`;
    sheet.element.dataset.stage = String(frame.stage);
    lastTime = time;
    lastCues = cues;
    return frame;
  }
  const observer = new ResizeObserver(() => render(lastTime, lastCues));
  observer.observe(parent);
  const unwatch = watchMotion(() => render(lastTime, lastCues));
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    unwatch();
    panels.forEach((p) => p.dispose());
    equation.dispose();
    explanation.dispose();
    viewport.dispose();
    sheet.dispose();
  }
  try {
    render(0);
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    element: sheet.element,
    view: {
      reset() {
        render(lastTime, lastCues);
      },
      dispose,
    },
    render,
    dispose,
    get plan() {
      return plan;
    },
    get projection() {
      return '2d' as const;
    },
    setOperation(operation: ConstructionOperation | ConstructionPlan) {
      const next = constructionPlan(operation),
        nextMargins = annotationLayout(next);
      const previous = { plan, margins, time: lastTime, cues: lastCues };
      plan = next;
      margins = nextMargins;
      try {
        render(0);
      } catch (error) {
        plan = previous.plan;
        margins = previous.margins;
        render(previous.time, previous.cues);
        throw error;
      }
    },
  };
}
