import { surface, type Surface } from '../../ink/surface.js';
import { svg } from '../../ink/dom.js';
import { paragraph } from '../../ink/paragraph.js';
import { fusionText } from '../../ink/fusion/text.js';
import { color } from '../../ink/palette.js';
import { placeLabels, type LabelBox, type LabelLimits } from '../../layout/labels.js';
import { contentViewport } from '../../layout/content.js';
import { materialDrawing } from './material.js';
import { spatialPanelRenderer } from './spatial.js';
import { constructionCamera } from './camera.js';
import { preparedAnnotations } from './plan.js';
import {
  mathMotionFrame,
  morphTiming,
  watchMotion,
  type MorphCues,
  type MorphTime,
} from '../timing.js';
import type {
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
type AnnotationLayout = {
  left: number;
  right: number;
  order: string[];
  inkSides: Map<string, 'top' | 'bottom'>;
  camera?: ReturnType<typeof constructionCamera>;
};

/** Reserve measured annotation space for the entire operation, so changing digits never move the drawing. */
function annotationLayout(plan: ConstructionPlan) {
  const margins = new Map<string, AnnotationLayout>(),
    positions = new Map<string, Map<string, { sum: number; count: number }>>(),
    widths = new Map<string, number>();
  const differences = new Map<string, number>();
  const prepared =
    preparedAnnotations(plan) ??
    Array.from(
      { length: plan.stages * 24 + 1 },
      (_, i) => plan.sample(i / (plan.stages * 24)).panels,
    );
  for (const panels of prepared) {
    for (const panel of panels) {
      const entry = margins.get(panel.id) ?? {
        left: 44,
        right: 44,
        order: [],
        inkSides: new Map(),
        camera: panel.space === '3d' ? constructionCamera(panel) : undefined,
      };
      const [lo, hi] = panel.bounds,
        span = hi[0] - lo[0];
      if (panel.space === '3d') entry.camera ??= constructionCamera(panel);
      const anchors = positions.get(panel.id) ?? new Map();
      positions.set(panel.id, anchors);
      for (const label of panel.labels ?? []) {
        for (const patch of panel.patches ?? [])
          if (patch.text) {
            const center = patch.map([
              (patch.domain[0][0] + patch.domain[1][0]) / 2,
              (patch.domain[0][1] + patch.domain[1][1]) / 2,
            ]);
            const key = `${panel.id}/${label.id}/${patch.id}`;
            const difference =
              (differences.get(key) ?? 0) +
              (label.at[1] + (label.to ?? label.at)[1]) / 2 -
              center[1];
            differences.set(key, difference);
            entry.inkSides.set(
              `${label.id}/${patch.id}`,
              label.side === 'bottom'
                ? 'bottom'
                : label.side === 'top'
                  ? 'top'
                  : difference >= 0
                    ? 'top'
                    : 'bottom',
            );
          }
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
  const materials = new Map<string, ReturnType<typeof materialDrawing>>();
  const inkBounds = new Map<string, LabelBox>();
  let used = new Set<string>();

  const draw = (item: DiagramPath, pixel: (point: DiagramPoint) => DiagramPoint) => {
    const key = item.id;
    used.add(key);
    const coordinates = item.points.map((p) => {
      const v = pixel(p);
      return [v[0], v[1]] as const;
    });
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
    let drawing = materials.get(patch.id);
    if (!drawing) {
      drawing = materialDrawing();
      materials.set(patch.id, drawing);
    }
    const art = drawing(patch);
    const mappedStrokes = art.strokes.map((stroke) => stroke.map((p) => pixel(patch.map(p))));
    const inkPoints = mappedStrokes.flat();
    if (inkPoints.length) {
      const xs = inkPoints.map((p) => p[0]),
        ys = inkPoints.map((p) => p[1]);
      const x = Math.min(...xs),
        y = Math.min(...ys);
      inkBounds.set(patch.id, {
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
        opacity: patch.opacity,
      });
    }
    draw(
      {
        id: patch.id,
        points: art.boundary.map(patch.map),
        closed: true,
        fill: patch.fill !== false,
        pigment: patch.pigment,
        opacity: patch.opacity,
      },
      pixel,
    );
    art.grid.forEach((line, i) =>
      draw(
        {
          id: `${patch.id}-grid-${i}`,
          points: line.map(patch.map),
          quiet: true,
          pigment: patch.pigment,
          opacity: patch.opacity,
        },
        pixel,
      ),
    );
    mappedStrokes.forEach((stroke, i) => {
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
      mark.setAttribute('d', `M${points(stroke).join('L')}`);
      mark.setAttribute('stroke-width', String(Math.max(1.5, Math.min(3.2, art.weight * units))));
      mark.style.opacity = String(patch.opacity ?? 1);
    });
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
      inkBounds.clear();

      root.setAttribute('transform', `translate(${x} ${y})`);
      const headingHeight = heading.render(panel.title, width - 12, width / 2, 23);
      const [[left, bottom], [right, top]] = panel.bounds;
      const plotTop = 30 + headingHeight;
      const leftMargin = Math.min(width * 0.44, margins.left),
        rightMargin = Math.min(width * 0.44, margins.right);
      const availableWidth = width - leftMargin - rightMargin;
      // A tall mathematical domain earns vertical room instead of shrinking to a tiny stamp.
      const readablePlotHeight =
        panel.aspect === 'free'
          ? 220
          : Math.min(480, (availableWidth * (top - bottom)) / Math.max(0.001, right - left));
      const requiredHeight = plotTop + 50 + readablePlotHeight;
      if (requiredHeight > height + 0.5) return requiredHeight;
      const availableHeight = height - plotTop - 50;
      let sx = availableWidth / Math.max(0.001, right - left),
        sy = availableHeight / Math.max(0.001, top - bottom);
      if (panel.aspect !== 'free') sx = sy = Math.min(sx, sy);
      const pixel = ([px, py]: DiagramPoint): DiagramPoint => [
        leftMargin + availableWidth / 2 + (px - (left + right) / 2) * sx,
        plotTop + availableHeight / 2 - (py - (top + bottom) / 2) * sy,
      ];
      for (const patch of panel.patches ?? []) material(patch, pixel, Math.min(sx, sy));
      for (const item of panel.paths ?? []) draw(item, pixel);
      for (const mark of panel.marks ?? []) {
        const [cx, cy] = pixel(mark.at);
        draw(
          {
            id: mark.id,
            points: Array.from(
              { length: 24 },
              (_, i) =>
                [
                  cx + 3.8 * Math.cos((i * Math.PI) / 12),
                  cy + 3.8 * Math.sin((i * Math.PI) / 12),
                ] as DiagramPoint,
            ),
            closed: true,
            fill: true,
            pigment: mark.pigment,
            opacity: mark.opacity,
          },
          (p) => p,
        );
      }
      // Preserve the prepared ordering; transparent labels do not occupy the drawing.
      const visible = [...(panel.labels ?? [])].sort(
        (a, b) => margins.order.indexOf(a.id) - margins.order.indexOf(b.id),
      );
      const preferred: LabelBox[] = [];
      const protectedSpace: LabelLimits[] = [];
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
        const limits: LabelLimits = { top: plotTop - 12, bottom: height - 3 };
        cx = Math.max(box.width / 2 + 6, Math.min(width - box.width / 2 - 6, cx));
        for (const [id, obstacle] of inkBounds) {
          if ((obstacle.opacity ?? 1) <= 0) continue;
          // The relation is prepared across the operation. A moving label never swaps sides.
          const direction = margins.inkSides.get(`${item.id}/${id}`);
          if (!direction) continue;
          const clearance =
            Math.abs(cx - (obstacle.x + obstacle.width / 2)) - (box.width + obstacle.width) / 2;
          const amount = Math.max(0, Math.min(1, (32 - clearance) / 24));
          const blend = amount * amount * (3 - 2 * amount);
          if (direction === 'top')
            limits.bottom = Math.min(
              limits.bottom!,
              height - 3 + blend * (obstacle.y - 10 - (height - 3)),
            );
          else
            limits.top = Math.max(
              limits.top!,
              plotTop - 12 + blend * (obstacle.y + obstacle.height + 10 - (plotTop - 12)),
            );
          const edge =
            direction === 'top'
              ? obstacle.y - box.height / 2 - 10
              : obstacle.y + obstacle.height + box.height / 2 + 10;
          cy += blend * (direction === 'top' ? Math.min(0, edge - cy) : Math.max(0, edge - cy));
        }
        preferred.push({
          x: cx - box.width / 2 - 3,
          y: cy - box.height / 2 - 2,
          width: box.width + 6,
          height: box.height + 4,
          opacity: item.opacity,
        });
        protectedSpace.push(limits);
        return { entry, box, item, anchor: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as DiagramPoint };
      });
      const labelHeight = preferred.reduce(
        (sum, box) => ((box.opacity ?? 1) > 0 ? sum + box.height + 8 : sum),
        -8,
      );
      // Reserve the visible stack before solving its protected regions and material obstacles.
      if (labelHeight > height - plotTop + 9) return plotTop - 9 + labelHeight;
      const placed = placeLabels(
        preferred,
        {
          x: 3,
          y: plotTop - 12,
          width: width - 6,
          height: height - plotTop + 9,
        },
        { limits: protectedSpace, obstacles: [...inkBounds.values()] },
      );
      root.dataset.labelOverflowCount = String(
        placed.filter((p) => (p.opacity ?? 1) > 0 && p.status === 'overflow').length,
      );
      entries.forEach(({ entry, box, item, anchor }, i) => {
        const p = placed[i]!;
        entry.wrapper.dataset.layoutStatus = p.status;
        if (p.status === 'overflow') return;
        entry.wrapper.setAttribute('transform', `translate(${p.x + 3 - box.x} ${p.y + 2 - box.y})`);
        const edge: DiagramPoint = [
          Math.max(p.x, Math.min(p.x + p.width, anchor[0])),
          Math.max(p.y, Math.min(p.y + p.height, anchor[1])),
        ];
        const distance = Math.hypot(edge[0] - anchor[0], edge[1] - anchor[1]);
        if (distance > 24 && !item.to)
          draw(
            {
              id: `leader-${item.id}`,
              points: [anchor, edge],
              pigment: item.pigment,
              quiet: true,
              opacity: (item.opacity ?? 1) * Math.min(1, (distance - 24) / 16),
            },
            (p) => p,
          );
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
      for (const key of materials.keys())
        if (!panel.patches?.some((p) => p.id === key)) materials.delete(key);
      return height;
    },
    dispose() {
      root.remove();
      heading.dispose();
      paths.forEach((p) => p.shape.dispose());
      labels.forEach((p) => p.text.dispose());
      materials.clear();
    },
  };
}

/** Shared geometry, pen, layout, measured labels and narrative motion for mathematical constructions. */
export function mountConstruction(
  parent: HTMLElement,
  operation: ConstructionPlan,
  { layout = 'content' }: { layout?: 'scene' | 'content' } = {},
) {
  let plan = operation,
    disposed = false,
    lastTime: MorphTime = 0,
    lastCues: MorphCues | undefined;
  let projection: '2d' | '3d' = '2d';
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
  sheet.element.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const viewport = layout === 'scene' ? undefined : contentViewport(parent);
  const equation = paragraph(sheet.layer, { size: 26 }),
    explanation = paragraph(sheet.layer, { size: 20 });
  equation.element.style.color = color('purple');
  const panels = new Map<
    string,
    {
      space: '2d' | '3d';
      up: string;
      renderer: ReturnType<typeof panelRenderer> | ReturnType<typeof spatialPanelRenderer>;
    }
  >();
  function render(time: MorphTime, cues?: MorphCues) {
    if (disposed) return;
    const timing = morphTiming(time, cues, plan.stages);
    const frame = mathMotionFrame(plan, timing);
    projection = frame.panels.some((p) => p.space === '3d') ? '3d' : '2d';
    const width = Math.max(280, parent.clientWidth),
      gap = 24;
    const columns = width >= 680 ? Math.min(2, frame.panels.length) : 1;
    const panelWidth = (width - gap * (columns - 1)) / columns;
    let panelHeight =
      columns === 1 && frame.panels.length === 1 ? Math.max(290, Math.min(430, width * 0.55)) : 330;
    const renderPanels = () =>
      Math.max(
        ...frame.panels.map((panel, i) => {
          let entry = panels.get(panel.id);
          const space = panel.space ?? '2d';
          const up = margins.get(panel.id)?.camera?.up;
          const upKey = String(up ?? [0, 1, 0]);
          if (entry && (entry.space !== space || entry.up !== upKey)) {
            entry.renderer.dispose();
            panels.delete(panel.id);
            entry = undefined;
          }
          if (!entry) {
            entry = {
              space,
              up: upKey,
              renderer:
                space === '3d'
                  ? spatialPanelRenderer(sheet, panel.id, up)
                  : panelRenderer(sheet, panel.id),
            };
            panels.set(panel.id, entry);
          }
          return entry.renderer.render(
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
    if (layout === 'scene')
      sheet.fitViewport(Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight));
    viewport?.resize(height);
    for (const [id, entry] of panels)
      if (!frame.panels.some((p) => p.id === id)) {
        entry.renderer.dispose();
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
    panels.forEach((p) => p.renderer.dispose());
    equation.dispose();
    explanation.dispose();
    viewport?.dispose();
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
        panels.forEach((p) => {
          'reset' in p.renderer && p.renderer.reset();
        });
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
      return projection;
    },
    setOperation(operation: ConstructionPlan) {
      const next = operation,
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
