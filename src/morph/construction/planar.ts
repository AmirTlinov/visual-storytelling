import type { Surface } from '../../ink/surface.js';
import { svg } from '../../ink/dom.js';
import { paragraph } from '../../ink/paragraph.js';
import { color } from '../../ink/palette.js';
import { placeLabels, type LabelBox, type LabelLimits } from '../../layout/labels.js';
import type { OverflowLabel } from '../../layout/label-overflow.js';
import { materialDrawing } from './material.js';
import type { AnnotationLayout } from './annotation-layout.js';
import type { DiagramPanel, DiagramPath, DiagramPoint, MaterialPatch } from './types.js';

type Stroke = ReturnType<Surface['pen']['polyline']>;
type Boundary = ReturnType<Surface['pen']['contour']>;
const points = (path: readonly DiagramPoint[]) =>
  path.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`);

export function planarPanelRenderer(sheet: Surface, id: string) {
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
  let overflow: OverflowLabel[] = [];

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
      placement: { bounded?: boolean; heading?: boolean; obstacles?: LabelBox[] } = {},
    ) {
      used = new Set();
      inkBounds.clear();

      root.setAttribute('transform', `translate(${x} ${y})`);
      const showHeading = placement.heading !== false;
      heading.element.style.display = showHeading ? '' : 'none';
      const headingHeight = showHeading
        ? heading.render(panel.title, width - 12, width / 2, 23)
        : 0;
      const [[left, bottom], [right, top]] = panel.bounds;
      const plotTop = showHeading ? 30 + headingHeight : 8;
      const leftMargin = Math.min(width * 0.44, margins.left),
        rightMargin = Math.min(width * 0.44, margins.right);
      const availableWidth = width - leftMargin - rightMargin;
      // A tall mathematical domain earns vertical room instead of shrinking to a tiny stamp.
      const readablePlotHeight =
        panel.aspect === 'free'
          ? 220
          : Math.min(480, (availableWidth * (top - bottom)) / Math.max(0.001, right - left));
      const requiredHeight = plotTop + 50 + readablePlotHeight;
      if (!placement.bounded && requiredHeight > height + 0.5) return requiredHeight;
      const availableHeight = Math.max(1, height - plotTop - (placement.bounded ? 18 : 50));
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
      if (!placement.bounded && labelHeight > height - plotTop + 9)
        return plotTop - 9 + labelHeight;
      const placed = placeLabels(
        preferred,
        {
          x: 3,
          y: Math.max(2, plotTop - 12),
          width: width - 6,
          height: Math.max(1, height - Math.max(2, plotTop - 12) - 3),
        },
        {
          limits: protectedSpace,
          obstacles: [...inkBounds.values(), ...(placement.obstacles ?? [])],
        },
      );
      overflow = entries.flatMap(({ item }, i) =>
        (item.opacity ?? 1) > 0 && placed[i]!.status === 'overflow'
          ? [{ id: `${id}/${item.id}`, label: item.text, subject: panel.title }]
          : [],
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
    get overflow() {
      return overflow;
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
