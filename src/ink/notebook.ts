import type { Pigment } from './palette.js';
import { lettering, type Lettering, type LetteringOptions } from './lettering.js';
import { paragraph } from './paragraph.js';
import { object, type InkObject } from './object.js';
import type { Fill, Point } from './pen.js';
import type { Surface } from './surface.js';
import { svgButton } from '../controls/svg.js';
import { placeLabels, type LabelSegment } from '../layout/labels.js';
import { SvgLayout } from '../layout/svg.js';
import { describeObject, type ObjectMeaning } from '../scene-objects.js';
import { probabilityBar } from '../recipes/probability-bar.js';

export interface NotebookViewport {
  width: number;
  height: number;
  scale: number;
  compact?: boolean;
}

export interface NotebookButtonOptions {
  pressed?: boolean;
  pigment?: Pigment;
  height?: number;
  outline?: boolean;
  meaning?: Omit<ObjectMeaning, 'label'> & { label?: string };
  objectId?: string;
}

export interface NotebookVectorOptions {
  label?: string;
  id?: string;
  pigment?: Pigment;
  numbers?: boolean;
  height?: number;
  format?: (value: number) => string;
  meaning?: (value: number, index: number) => ObjectMeaning;
}

export function notebookDrawingMetrics({
  height,
  scale,
  compact,
}: Pick<NotebookViewport, 'height' | 'scale' | 'compact'>) {
  const size = Math.max(compact ? 24 : 25, 16 / Math.max(scale, 0.1));
  const hit = Math.max(48, 44 / Math.max(scale, 0.1));
  return { size, hit, detailActionY: height - 2 * hit - 32 };
}

/**
 * Shared notebook stage composer for custom 2D/SVG explanations.
 * Owns group creation, animated writing/reveal sequences, hit-target sizing,
 * obstacle-aware annotation placement, and vertical band layout.
 */
export function notebookDrawing(
  view: Surface,
  { width, height, scale, compact = false }: NotebookViewport,
) {
  const disposers: Array<() => void> = [],
    obstacles: Array<{ x: number; y: number; width: number; height: number }> = [],
    segments: LabelSegment[] = [],
    fixedText = new Set<SVGGraphicsElement>(),
    labels: Array<{
      label: Lettering;
      name: string;
      value: string;
      x: number;
      y: number;
      width: number;
      height: number;
      priority: number;
      inkX: number;
      inkY: number;
    }> = [],
    sequences: Array<{ name: string; draw: Array<(amount: number) => void> }> = [];
  let sequence: { name: string; draw: Array<(amount: number) => void> } | undefined;
  const animate = (draw: (amount: number) => void) => sequence?.draw.push(draw);
  const { size, hit, detailActionY } = notebookDrawingMetrics({ height, scale, compact });
  const overflow = SvgLayout.overflow(view.layer);
  disposers.push(() => overflow.dispose());
  let id = 0;

  const group = (name: string, pigment: Pigment = 'ink'): InkObject => {
    const result = object(view.layer, name, pigment);
    if (sequence) {
      result.element.dataset.storyStep = sequence.name;
      animate((amount) => {
        result.element.style.visibility = amount > 0 ? '' : 'hidden';
      });
    }
    return result;
  };

  const text = (
    value: string | number,
    x: number,
    y: number,
    options: LetteringOptions & { pigment?: Pigment } = {},
  ) => {
    const { pigment = 'ink', ...settings } = options;
    const g = group(`label-${++id}`, pigment);
    const label = lettering(g.content, value, {
      x,
      y,
      anchor: 'start',
      ...settings,
      size: Math.max(size, settings.size ?? size),
    });
    disposers.push(() => label.dispose());
    fixedText.add(label.element);
    animate((amount) => label.write(amount));
    return label;
  };

  const note = (
    value: string,
    x: number,
    y: number,
    maxWidth: number,
    options: { pigment?: Pigment; size?: number; lineHeight?: number } = {},
  ) => {
    const g = group(`note-${++id}`, options.pigment ?? 'muted');
    const p = paragraph(g.content, { ...options, size: Math.max(size, options.size ?? size) });
    p.render(value, maxWidth, x + maxWidth / 2, y);
    disposers.push(() => p.dispose());
    fixedText.add(p.element);
    return p;
  };

  const line = (
    from: Point,
    to: Point,
    pigment: Pigment = 'ink',
    arrow = false,
    thickness = 2,
  ) => {
    const g = group(`line-${++id}`, pigment);
    const mark = view.pen[arrow ? 'arrow' : 'line'](g.content, `stroke-${id}`, from, to, {
      width: thickness,
    });
    segments.push({ from, to, width: thickness });
    animate((amount) => mark.reveal(amount));
    return mark;
  };

  const box = (
    name: string,
    x: number,
    y: number,
    w: number,
    h: number,
    pigment: Pigment = 'ink',
    fill: Fill = 'none',
  ) => {
    const g = group(name, pigment);
    const mark = view.pen.rect(g.content, `${name}-box`, x, y, w, h, { width: 1.6, fill });
    animate((amount) => mark.reveal(amount));
    obstacles.push({ x, y, width: w, height: h });
    return g;
  };

  const probability = (
    name: string,
    value: number,
    x: number,
    y: number,
    w: number,
    h: number,
    meaning?: ObjectMeaning,
  ) => {
    const g = group(`${name}-group`);
    const bar = probabilityBar({ ...view, layer: g.content }, name, value, {
      x,
      y,
      width: w,
      height: h,
      size: compact ? size : Math.max(size, 30),
      meaning,
    });
    disposers.push(bar.dispose);
    obstacles.push({ x, y, width: w, height: h });
    return bar;
  };

  const buttonDimensions = (
    bounds: { width: number; height: number },
    w = 0,
    h = hit,
  ) => ({
    width: Math.max(w, hit, Math.ceil(bounds.width + 12)),
    height: Math.max(h, hit, Math.ceil(bounds.height + 12)),
  });

  const buttonSize = (label: string) => {
    const ink = lettering(view.layer, label, { size, minSize: size });
    try {
      return buttonDimensions(ink.bounds);
    } finally {
      ink.dispose();
    }
  };

  const button = (
    name: string,
    label: string,
    x: number,
    y: number,
    w: number,
    onPress: () => void,
    {
      pressed,
      pigment = 'ink',
      height: h = hit,
      outline = true,
      meaning,
      objectId = name,
    }: NotebookButtonOptions = {},
  ) => {
    const g = group(name, pigment);
    const ink = lettering(g.content, label, { size, minSize: size });
    const measured = ink.bounds;
    const dimensions = buttonDimensions(measured, w, h);
    x = Math.max(0, Math.min(width - dimensions.width, x - (dimensions.width - w) / 2));
    w = dimensions.width;
    h = dimensions.height;
    ink.at(
      x + w / 2 - (measured.x + measured.width / 2),
      y + h / 2 - (measured.y + measured.height / 2),
    );
    if (outline) {
      const mark = view.pen.rect(g.content, `${name}-button`, x, y, w, h, {
        fill: pressed ? 'marker' : 'none',
      });
      animate((amount) => mark.reveal(amount));
    }
    g.content.append(ink.element);
    ink.element.setAttribute('aria-hidden', 'true');
    disposers.push(() => ink.dispose());
    animate((amount) => ink.write(amount));
    const b = svgButton(g.content, { x, y, width: w, height: h, label, pressed, onPress });
    b.element.dataset.action = name;
    if (meaning) {
      b.element.dataset.object = objectId;
      disposers.push(describeObject(b.element, { label, ...meaning, interactive: false }));
    }
    obstacles.push({ x, y, width: w, height: h });
    disposers.push(() => b.dispose());
    return Object.assign(g, { bounds: { x, y, width: w, height: h } });
  };

  const annotation = (
    name: string,
    value: string,
    x: number,
    y: number,
    pigment: Pigment = 'muted',
    priority = 1,
  ) => {
    const label = text(value, 0, 0, { pigment });
    fixedText.delete(label.element);
    const bounds = label.bounds;
    labels.push({
      label,
      name,
      value,
      x,
      y,
      width: bounds.width,
      height: bounds.height,
      priority,
      inkX: bounds.x,
      inkY: bounds.y,
    });
  };

  const explain = (
    element: Element,
    id: string,
    meaning: Omit<ObjectMeaning, 'interactive'> & { interactive?: boolean },
  ) => {
    element.setAttribute('data-object', id);
    disposers.push(describeObject(element, { interactive: false, ...meaning }));
  };

  const vector = (
    values: readonly number[],
    x: number,
    y: number,
    w: number,
    {
      label,
      id: vectorId = `vector:${label ?? 'values'}`,
      pigment = 'ink',
      numbers = true,
      height: cellHeight,
      format = (v: number) => Number(v.toFixed(1)).toLocaleString('ru-RU'),
      meaning,
    }: NotebookVectorOptions = {},
  ) => {
    if (label) text(label, x, y - 18, { pigment, size });
    const gap = 5,
      cell = (w - gap * (values.length - 1)) / values.length;
    values.forEach((v, i) => {
      const g = box(
        `vector-${label ?? 'v'}-${x}-${y}-${i}`,
        x + i * (cell + gap),
        y,
        cell,
        Math.max(cellHeight ?? cell, compact ? 85 : 55),
        pigment,
        'marker',
      );
      g.element.style.setProperty(
        '--ve-wash-strength',
        `${15 + 55 * Math.min(1, Math.abs(v) / 4)}%`,
      );
      explain(
        g.element,
        `${vectorId}:cell:${i}`,
        meaning
          ? meaning(v, i)
          : {
              label: `${label ?? 'Вектор'}: координата ${i + 1}`,
              value: () => v,
            },
      );
      if (numbers && !compact)
        text(format(v), x + i * (cell + gap) + cell / 2, y + 33, {
          anchor: 'middle',
          size: Math.max(20, size),
          pigment,
        });
    });
  };

  /** Vertical band cursor that allocates non-overlapping horizontal strips top-to-bottom. */
  const bands = (startY = 48, defaultGap = 24) => {
    let cursor = startY;
    return {
      get y() {
        return cursor;
      },
      take(bandHeight: number, gap = defaultGap) {
        const top = cursor;
        cursor += bandHeight + gap;
        return {
          y: top,
          height: bandHeight,
          center: top + bandHeight / 2,
          bottom: top + bandHeight,
        };
      },
    };
  };

  const settle = () => {
    if (!labels.length) {
      overflow.update([]);
      return;
    }
    const reserved = SvgLayout.box(overflow.reserve());
    const placed = placeLabels(
      labels,
      { x: 12, y: 8, width: width - 24, height: height - 16 },
      {
        obstacles: [
          ...obstacles,
          ...[...fixedText].map((node) => SvgLayout.box(node, view.layer)),
          reserved,
        ],
        segments,
        gap: 10,
      },
    );
    placed.forEach((p, i) => {
      const l = labels[i]!;
      l.label.element.dataset.layoutLabel = l.name;
      l.label.element.dataset.layoutStatus = p.status;
      l.label.at(p.x - l.inkX, p.y - l.inkY);
      if (p.status === 'overflow') l.label.element.setAttribute('visibility', 'hidden');
    });
    overflow.update(
      labels
        .filter((_, i) => placed[i]!.status === 'overflow')
        .map((l) => ({ id: l.name, label: l.value })),
    );
  };

  return {
    width,
    height,
    compact,
    size,
    hit,
    detailActionY,
    text,
    note,
    line,
    box,
    probability,
    group,
    button,
    buttonSize,
    annotation,
    explain,
    vector,
    bands,
    settle,
    sequence(name: string, build: () => void) {
      const previous = sequence;
      sequence = { name, draw: [] };
      sequences.push(sequence);
      try {
        build();
      } finally {
        sequence = previous;
      }
    },
    render(steps?: Record<string, number>, mode?: string) {
      for (const { name, draw } of sequences) {
        const progress = mode === 'explore' || !steps ? 1 : (steps[name] ?? 0);
        draw.forEach((reveal) => reveal(progress));
      }
    },
    dispose() {
      disposers.forEach((dispose) => dispose());
      view.layer.replaceChildren();
    },
  };
}
export type NotebookDrawing = ReturnType<typeof notebookDrawing>;
