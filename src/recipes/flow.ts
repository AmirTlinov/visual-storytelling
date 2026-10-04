import type { Surface } from '../ink/surface.js';
import type { Pigment } from '../ink/palette.js';
import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { node } from './node.js';
import type { InkDrawing } from '../story/ink-chapter.js';
import type { ChapterFrame } from '../story/composition.js';

export interface FlowOptions {
  nodes: readonly { id: string; label: string; pigment?: Pigment }[];
  edges: readonly { from: string; to: string }[];
  values?(frame: ChapterFrame): Readonly<Record<string, string | number>>;
  /** Operation index; explore displays the complete mechanism. */
  step?(frame: ChapterFrame): number;
}
/** A dependency graph retains its objects, values and links across layout and interaction. */
export function flowDiagram(view: Surface, options: FlowOptions): InkDrawing {
  const ids = options.nodes.map((n) => n.id);
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('A flow needs unique node IDs');
  const ranks = new Map<string, number>(),
    pending = new Set(ids);
  for (const e of options.edges)
    if (!pending.has(e.from) || !pending.has(e.to)) throw new Error('Unknown flow endpoint');
  while (pending.size) {
    let changed = false;
    for (const id of pending) {
      const incoming = options.edges.filter((e) => e.to === id).map((e) => e.from);
      if (incoming.every((i) => ranks.has(i))) {
        ranks.set(id, Math.max(-1, ...incoming.map((i) => ranks.get(i)!)) + 1);
        pending.delete(id);
        changed = true;
      }
    }
    if (!changed)
      throw new Error('A flow needs an acyclic dependency graph; show feedback as a separate step');
  }
  const links = object(view.layer, 'flow-links', 'ink');
  const signal = object(view.layer, 'flow-signal', 'orange');
  view.pen.ellipse(signal.content, 'signal', 0, 0, 5, 5, { fill: 'marker' });
  let marks: { box: ReturnType<typeof node>; value: ReturnType<typeof lettering> }[] = [];
  let edges: {
    arrow: ReturnType<Surface['pen']['arrow']>;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }[] = [];
  let signature = '',
    snapshot: unknown;
  const clear = () => {
    for (const e of edges) e.arrow.dispose();
    edges = [];
    for (const m of marks) {
      m.value.dispose();
      m.box.dispose();
    }
    marks = [];
  };
  return {
    render(frame, { width, height }) {
      const compact = width < 540,
        layers = Math.max(...ranks.values()) + 1;
      const key = `${width}:${height}`;
      if (key !== signature) {
        signature = key;
        clear();
        view.grid(false);
        if (compact && height / options.nodes.length < 48)
          throw new Error('Flow needs at least 48px per operation in its narrow layout');
        const coords = new Map<string, { x: number; y: number; width: number; height: number }>();
        const ordered = [...ids].sort((a, b) => ranks.get(a)! - ranks.get(b)!);
        for (const [i, n] of options.nodes.entries()) {
          const rank = ranks.get(n.id)!,
            peers = options.nodes.filter((v) => ranks.get(v.id) === rank);
          const p = compact
            ? {
                x: Math.max(88, width * 0.28),
                y: (height * (ordered.indexOf(n.id) + 0.5)) / ids.length,
              }
            : {
                x: (width * (rank + 0.5)) / layers,
                y: (height * (peers.indexOf(n) + 1)) / (peers.length + 1) - 22,
              };
          const box = node(view, n.id, n.label, {
            shape: 'rect',
            width: compact ? 140 : Math.min(164, width / layers - 44),
            height: compact ? 34 : 58,
            size: compact ? 22 : 32,
            minSize: 20,
            pigment: n.pigment ?? (i === ids.length - 1 ? 'green' : 'blue'),
          });
          box.at(p.x, p.y);
          box.element.dataset.reviewId = n.id;
          box.label.element.style.color = 'var(--ve-ink)';
          const value = lettering(box.content, '', {
            x: compact ? width * 0.44 : 0,
            y: compact ? 7 : 62,
            size: compact ? 23 : 30,
            tabular: true,
          });
          value.element.style.color = 'var(--ve-ink)';
          marks.push({ box, value });
          coords.set(n.id, { ...p, width: box.width, height: box.height });
        }
        for (const e of options.edges) {
          const a = coords.get(e.from)!,
            b = coords.get(e.to)!;
          const from = compact
            ? { x: a.x, y: a.y + a.height / 2 + 5 }
            : { x: a.x + a.width / 2 + 8, y: a.y };
          const to = compact
            ? { x: b.x, y: b.y - b.height / 2 - 5 }
            : { x: b.x - b.width / 2 - 8, y: b.y };
          const arrow = view.pen.arrow(
            links.content,
            `${e.from}-${e.to}`,
            [from.x, from.y],
            [to.x, to.y],
            { width: 1.8 },
          );
          edges.push({ arrow, from, to });
        }
      }
      const progress = frame.mode === 'explore' ? 1 : Math.min(1, Math.max(0, frame.progress));
      const phase =
        frame.mode === 'explore'
          ? ids.length
          : (options.step?.(frame) ?? progress * Math.max(1, ids.length - 1));
      const values = options.values?.(frame) ?? {};
      for (const [i, n] of options.nodes.entries()) {
        const active = phase >= i - 0.001;
        marks[i]!.box.element.style.opacity = active ? '1' : '.55';
        marks[i]!.value.text(active && values[n.id] !== undefined ? String(values[n.id]) : '');
      }
      const activeEdge = Math.min(edges.length - 1, Math.floor(progress * edges.length)),
        edge = edges[activeEdge];
      signal.show(Boolean(edge) && frame.mode !== 'explore' && progress < 1 && !frame.reduced);
      if (edge) {
        const t = (progress * edges.length) % 1;
        signal.at(
          edge.from.x + (edge.to.x - edge.from.x) * t,
          edge.from.y + (edge.to.y - edge.from.y) * t,
        );
      }
      snapshot = { step: phase, values, nodes: ids, links: options.edges };
      view.element.querySelector('desc')!.textContent = options.nodes
        .map((n) => `${n.label}${values[n.id] === undefined ? '' : `: ${values[n.id]}`}`)
        .join('. ');
    },
    snapshot: () => snapshot,
    dispose() {
      clear();
      signal.dispose();
      links.dispose();
    },
  };
}
