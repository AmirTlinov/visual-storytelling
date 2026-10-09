import type { Lettering } from '../ink/lettering.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import {
  placeLabels,
  type LabelBox,
  type LabelLimits,
  type LabelSegment,
  type LabelPlacement,
} from '../layout/labels.js';
import { SvgLayout } from '../layout/svg.js';
import { svg, seed } from '../ink/dom.js';
import { labelOverflow, type OverflowLabel } from '../layout/label-overflow.js';

type Placement = {
  anchor: Point;
  preferred: LabelBox;
  limits?: LabelLimits;
  priority?: number;
};
type Entry = {
  id: string;
  label: Lettering;
  placement: (ink: LabelBox) => Placement;
  visible: () => boolean;
  leader?: SVGPathElement;
};
type PlotFrame = {
  registry: Registry;
  parent: SVGGElement;
  area: LabelBox;
  boundary?: readonly { x: number; y: number }[];
  active: (Placement & { entry: Entry; ink: LabelBox })[];
  obstacles: LabelBox[];
  segments: LabelSegment[];
  arranged: LabelPlacement[];
  button?: LabelBox;
  occupied: LabelBox[];
};
type Registry = {
  prepare(): PlotFrame | undefined;
  geometry(frame: PlotFrame): void;
  button(frame: PlotFrame): LabelBox;
  publish(frame: PlotFrame): void;
  dispose(): void;
};
type Reservation = { frame: PlotFrame; box: LabelBox };

function transform(from: PlotFrame, to: PlotFrame) {
  return to.parent.getCTM()!.inverse().multiply(from.parent.getCTM()!);
}
function transformedBox(box: LabelBox, matrix: DOMMatrix): LabelBox {
  const points = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ].map(([x, y]) => new DOMPoint(x!, y!).matrixTransform(matrix));
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    ...box,
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
function transformedSegment(segment: LabelSegment, matrix: DOMMatrix): LabelSegment {
  const point = ([x, y]: Point): Point => {
    const p = new DOMPoint(x, y).matrixTransform(matrix);
    return [p.x, p.y];
  };
  const sum = matrix.a ** 2 + matrix.b ** 2 + matrix.c ** 2 + matrix.d ** 2,
    determinant = matrix.a * matrix.d - matrix.b * matrix.c,
    scale = Math.sqrt(
      (sum + Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant))) / 2,
    );
  return { from: point(segment.from), to: point(segment.to), width: (segment.width ?? 0) * scale };
}
function boxesIn(frame: PlotFrame, reservations: readonly Reservation[]) {
  return reservations.map((entry) =>
    entry.frame === frame ? entry.box : transformedBox(entry.box, transform(entry.frame, frame)),
  );
}

/** Registration order and authored priorities belong to the Surface, never to update order. */
const surfaces = new WeakMap<Surface, ReturnType<typeof coordination>>();
function coordination(view: Surface) {
  const registries = new Set<Registry>();
  const unregister = view.onDispose(() => {
    for (const registry of [...registries]) registry.dispose();
  });
  function solve(frames: PlotFrame[], controls: Reservation[]) {
    const reserved = [...controls];
    if (frames.length === 1) {
      const frame = frames[0]!;
      frame.arranged = placeLabels(
        frame.active.map((item) => ({ ...item.preferred, priority: item.priority })),
        frame.area,
        {
          limits: frame.active.map((item) => item.limits ?? {}),
          obstacles: [...frame.obstacles, ...boxesIn(frame, controls)],
          segments: frame.segments,
          boundary: frame.boundary,
          gap: 6,
        },
      );
      return;
    }
    frames.forEach((frame) => {
      frame.arranged = new Array(frame.active.length);
    });
    const priorities = [
      ...new Set(frames.flatMap((frame) => frame.active.map((item) => item.priority ?? 0))),
    ].sort((a, b) => b - a);
    for (const priority of priorities)
      for (const frame of frames) {
        const items = frame.active.flatMap((item, index) =>
          (item.priority ?? 0) === priority ? [{ item, index }] : [],
        );
        if (!items.length) continue;
        const placed = placeLabels(
          items.map(({ item }) => ({ ...item.preferred, priority })),
          frame.area,
          {
            limits: items.map(({ item }) => item.limits ?? {}),
            obstacles: [...frame.obstacles, ...boxesIn(frame, reserved)],
            segments: frame.segments,
            boundary: frame.boundary,
            gap: 6,
          },
        );
        items.forEach(({ index }, i) => {
          frame.arranged[index] = placed[i]!;
          if (placed[i]!.status === 'placed') reserved.push({ frame, box: placed[i]! });
        });
      }
  }
  return {
    registries,
    render() {
      const frames = [...registries].flatMap((registry) => registry.prepare() ?? []);
      // All preferred labels are measured before any geometry or placement is published.
      frames.forEach((frame) => frame.registry.geometry(frame));
      if (frames.length > 1) {
        const geometry = frames.map((frame) => {
          const obstacles = [...frame.obstacles],
            segments = [...frame.segments];
          for (const other of frames)
            if (other !== frame) {
              const matrix = transform(other, frame);
              obstacles.push(...other.obstacles.map((box) => transformedBox(box, matrix)));
              segments.push(
                ...other.segments.map((segment) => transformedSegment(segment, matrix)),
              );
            }
          return { obstacles, segments };
        });
        frames.forEach((frame, index) => Object.assign(frame, geometry[index]));
      }
      const controls: Reservation[] = [];
      solve(frames, controls);
      // A newly required control can displace another chart's labels. Reserve each
      // control once, then solve from the same preferences; this is bounded by chart count.
      for (;;) {
        const crowded = frames.filter(
          (frame) => !frame.button && frame.arranged.some((label) => label.status === 'overflow'),
        );
        if (!crowded.length) break;
        for (const frame of crowded) {
          frame.button = placeLabels([frame.registry.button(frame)], frame.area, {
            obstacles: [...frame.obstacles, ...boxesIn(frame, controls)],
            segments: frame.segments,
            boundary: frame.boundary,
            gap: 6,
          })[0]!;
          controls.push({ frame, box: frame.button });
        }
        solve(frames, controls);
      }
      const placed = [
        ...controls,
        ...frames.flatMap((frame) =>
          frame.arranged.filter((box) => box.status === 'placed').map((box) => ({ frame, box })),
        ),
      ];
      for (const frame of frames) {
        frame.occupied = boxesIn(frame, placed);
        frame.registry.publish(frame);
      }
    },
    remove(registry: Registry) {
      registries.delete(registry);
      if (!registries.size) {
        unregister();
        surfaces.delete(view);
      }
    },
  };
}
export const besidePoint = (ink: LabelBox, at: Point, side = 'right', gap = 14): LabelBox => ({
  ...ink,
  x: at[0] + (side === 'left' ? -ink.width - gap : side === 'right' ? gap : -ink.width / 2),
  y: at[1] + (side === 'top' ? -ink.height - gap : side === 'bottom' ? gap : -ink.height / 2),
});

/** Plot axes, measurements and data labels are resolved together in data-paper coordinates. */
export function plotLabels(view: Surface, parent: SVGGElement) {
  let serial = 0,
    disposed = false;
  const owner = surfaces.get(view) ?? coordination(view);
  surfaces.set(view, owner);
  const entries = new Set<Entry>();
  const protectedInk = new Set<SVGGraphicsElement>();
  const geometry = new Set<() => { boxes?: LabelBox[]; segments?: LabelSegment[] }>();
  const leaders = svg('g', {
    'aria-hidden': 'true',
    'pointer-events': 'none',
    'data-plot-leaders': '',
  });
  const defs = svg('defs');
  const mask = svg('mask', {
    id: `${view.element.id}-${seed(parent.parentElement?.getAttribute('data-object') ?? 'plot')}-leaders`,
    maskUnits: 'userSpaceOnUse',
  });
  defs.append(mask);
  parent.append(defs);
  leaders.setAttribute('mask', `url(#${mask.id})`);
  parent.prepend(leaders);
  const summary = svg('desc');
  parent.append(summary);
  let extra:
    | {
        frame: SVGForeignObjectElement;
        host: HTMLDivElement;
        control: ReturnType<typeof labelOverflow>;
      }
    | undefined;
  const shown = (element: Element) => {
    if (!view.element.contains(element)) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
        return false;
      if (node === view.element) break;
    }
    return true;
  };
  function prepare(): PlotFrame | undefined {
    if (!shown(parent)) return;
    const { area, boundary } = SvgLayout.viewport(parent, 4);
    const active = [...entries].flatMap((entry) => {
      delete entry.label.element.dataset.layoutStatus;
      entry.label.element.style.visibility = '';
      if (
        !entry.visible() ||
        !shown(entry.label.element) ||
        !entry.label.element.getAttribute('aria-label')
      ) {
        entry.label.element.style.visibility = 'hidden';
        if (entry.leader) entry.leader.style.display = 'none';
        return [];
      }
      entry.label.at(0, 0);
      const ink = entry.label.bounds;
      return [{ entry, ink, ...entry.placement(ink) }];
    });
    return {
      registry,
      parent,
      area,
      boundary,
      active,
      obstacles: [],
      segments: [],
      arranged: [],
      occupied: [],
    };
  }
  function readGeometry(frame: PlotFrame) {
    frame.obstacles = [...protectedInk]
      .filter(shown)
      .map((element) => SvgLayout.box(element, parent));
    for (const source of geometry) {
      const ink = source();
      frame.obstacles.push(...(ink.boxes ?? []));
      frame.segments.push(...(ink.segments ?? []));
    }
  }
  function button({ area }: PlotFrame) {
    if (!extra) {
      const frame = svg('foreignObject', { 'data-plot-overflow': '', 'pointer-events': 'none' });
      const host = document.createElement('div');
      host.style.cssText = 'position:relative;width:100%;height:100%';
      frame.append(host);
      parent.append(frame);
      extra = { frame, host, control: labelOverflow(host) };
      extra.control.element.style.pointerEvents = 'auto';
    }
    for (const key of ['x', 'y', 'width', 'height'] as const)
      extra.frame.setAttribute(key, String(area[key]));
    const local = extra.control.preferred({ ...area, x: 0, y: 0 });
    return { ...local, x: local.x + area.x, y: local.y + area.y };
  }
  function publish({ area, active, arranged, obstacles, occupied, button }: PlotFrame) {
    const overflow: OverflowLabel[] = [];
    active.forEach(({ entry, ink, anchor, preferred }, index) => {
      const placed = arranged[index]!;
      entry.label.element.dataset.layoutStatus = placed.status;
      entry.label.element.style.visibility = placed.status === 'placed' ? '' : 'hidden';
      if (placed.status === 'overflow')
        overflow.push({ id: entry.id, label: entry.label.element.getAttribute('aria-label')! });
      entry.label.at(placed.x - ink.x, placed.y - ink.y);
      if (!entry.leader) return;
      entry.leader.style.color =
        entry.label.element.closest('[color]')?.getAttribute('color') ?? 'inherit';
      const x = Math.max(placed.x, Math.min(placed.x + placed.width, anchor[0]));
      const y = Math.max(placed.y, Math.min(placed.y + placed.height, anchor[1]));
      const moved = Math.hypot(placed.x - preferred.x, placed.y - preferred.y);
      entry.leader.style.display = placed.status === 'placed' && moved > 8 ? '' : 'none';
      entry.leader.setAttribute('d', `M${anchor[0]} ${anchor[1]}L${x} ${y}`);
    });
    parent.dataset.labelOverflow = String(overflow.length);
    mask.replaceChildren(
      svg('rect', { x: area.x, y: area.y, width: area.width, height: area.height, fill: 'white' }),
      ...[...obstacles, ...occupied].map((box) =>
        svg('rect', {
          x: box.x - 3,
          y: box.y - 3,
          width: box.width + 6,
          height: box.height + 6,
          fill: 'black',
        }),
      ),
    );
    summary.textContent = overflow.length
      ? `Неуместившиеся подписи: ${overflow.map((item) => item.label).join('; ')}.`
      : '';
    if (extra) {
      extra.frame.style.display = overflow.length ? '' : 'none';
      const position = button ?? area;
      extra.control.update(overflow, {
        ...position,
        x: position.x - area.x,
        y: position.y - area.y,
      });
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    owner.remove(registry);
    entries.clear();
    protectedInk.clear();
    geometry.clear();
    leaders.remove();
    defs.remove();
    summary.remove();
    extra?.control.dispose();
    extra?.frame.remove();
  }
  const registry: Registry = { prepare, geometry: readGeometry, button, publish, dispose };
  owner.registries.add(registry);
  return {
    render: owner.render,
    add(
      label: Lettering,
      placement: Entry['placement'],
      visible: Entry['visible'] = () => true,
      leader = false,
    ) {
      const line = leader
        ? svg('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1, opacity: 0.55 })
        : undefined;
      if (line) {
        leaders.append(line);
      }
      const entry: Entry = { id: String(++serial), label, placement, visible, leader: line };
      entries.add(entry);
      return () => {
        entries.delete(entry);
        line?.remove();
      };
    },
    avoid(element: SVGGraphicsElement) {
      protectedInk.add(element);
      return () => {
        protectedInk.delete(element);
      };
    },
    geometry(source: () => { boxes?: LabelBox[]; segments?: LabelSegment[] }) {
      geometry.add(source);
      return () => {
        geometry.delete(source);
      };
    },
    dispose,
  };
}
export type PlotLabels = ReturnType<typeof plotLabels>;
