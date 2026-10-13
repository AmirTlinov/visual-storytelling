import { object } from '../ink/object.js';
import { paragraph } from '../ink/paragraph.js';
import { svg } from '../ink/dom.js';
import { pen } from '../ink/pen.js';
import { node } from './node.js';
import { vector } from './vector.js';
import { tracePath } from './trace-path.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import type { DependencyGraph, DependencyTrace } from './dependency-route-model.js';

export interface DependencyRouteDiagramOptions {
  width: number;
  height: number;
  scale: number;
  progress: number;
  networkId: string;
  statusId?: string;
  text?: string;
  /** Layout coordinates are fractions of the drawing, independent of route computation. */
  positions: Readonly<Record<string, Point>>;
}

/** Nodes and arrows provide context; the existing computed trace alone moves the persistent order. */
export function dependencyRouteDiagram(view: Surface, modelId: string) {
  let current: ReturnType<typeof prepare> | undefined;
  let key = '';
  let disposed = false;
  function prepare(
    graph: DependencyGraph,
    trace: DependencyTrace,
    options: DependencyRouteDiagramOptions,
  ) {
    if (disposed) throw new Error('Dependency drawing has been disposed.');
    const { width, height, scale, positions } = options;
    if (![width, height, scale].every(Number.isFinite) || width <= 0 || height <= 0 || scale <= 0)
      throw new Error('Dependency drawing needs a positive viewport.');
    const canvas = svg('svg', {
      width: width,
      height: height,
      viewBox: `0 0 ${width} ${height}`,
      visibility: 'hidden',
    });
    view.layer.append(canvas);
    const layer = object(canvas, options.networkId);
    const candidateView = { ...view, element: canvas, layer: layer.content, pen: pen(canvas) };
    const cleanups: Array<() => void> = [() => canvas.remove(), layer.dispose];
    try {
      const point = (id: string): Point => {
        const p = positions[id];
        if (!p || !p.every(Number.isFinite) || p.some((v) => v <= 0 || v >= 1))
          throw new Error(`Dependency drawing needs a bounded position for ${id}.`);
        return [p[0] * width, p[1] * height];
      };
      const displayed = width * scale;
      const font = Math.max(16, Math.min(22, displayed / 30)) / scale;
      const radius = 12 / scale;
      const shortText = (
        parent: SVGElement,
        text: string,
        available: number,
        x: number,
        y: number,
      ) => {
        const label = paragraph(parent, { size: font, lineHeight: 1.25 });
        cleanups.push(label.dispose);
        const used = label.render(text, available, x, y);
        if (used > font * 2.5 + 0.01 || label.bounds.width > available + 0.5)
          throw new Error(`Dependency label needs at most two readable lines: ${text}`);
        return label;
      };
      const nodes = graph.nodes.map((item) => {
        const [x, y] = point(item.id);
        const port = object(layer.content, `${modelId}:node:${item.id}`);
        const border = candidateView.pen.ellipse(
          port.content,
          `${modelId}:node:${item.id}:port`,
          0,
          0,
          radius,
          radius,
          { width: 1.6 / scale },
        );
        port.at(x, y);
        port.describe({ label: item.label, interactive: false });
        shortText(
          port.content,
          displayed < 640 ? (item.shortLabel ?? item.label) : item.label,
          width * 0.22,
          0,
          radius + font * 1.3,
        );
        cleanups.push(border.dispose, port.dispose);
        return { item, port, border };
      });
      // Inactive alternatives stay visible as context, while the selected route retains one pigment.
      const edges = graph.edges.map((edge) => {
        const arrow = vector(candidateView, `${modelId}:edge:${edge.id}`, 'muted', 1.5 / scale);
        layer.content.prepend(arrow.element);
        const from = point(edge.from),
          to = point(edge.to);
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const dx = (to[0] - from[0]) / length,
          dy = (to[1] - from[1]) / length;
        arrow.set(
          [from[0] + dx * radius, from[1] + dy * radius],
          [to[0] - dx * radius, to[1] - dy * radius],
        );
        arrow.describe({
          label: `${graph.nodes.find((n) => n.id === edge.from)!.label} → ${graph.nodes.find((n) => n.id === edge.to)!.label}`,
          interactive: false,
        });
        cleanups.push(arrow.dispose);
        return { edge, arrow };
      });
      const packet = node(candidateView, `${modelId}:order:${trace.orderId}`, trace.orderId, {
        parent: layer.content,
        shape: 'rect',
        width: Math.max(44 / scale, font * trace.orderId.length * 0.75),
        height: 32 / scale,
        padding: 4 / scale,
        size: font,
        minSize: font,
        pigment: 'blue',
      });
      packet.describe({ label: `Заказ ${trace.orderId}`, interactive: false });
      cleanups.push(packet.dispose);
      if (packet.width > width * 0.22)
        throw new Error('The order ID needs a shorter readable inscription.');
      const status = object(layer.content, options.statusId ?? `${modelId}:status`);
      const message =
        options.text ??
        (trace.status === 'delivered'
          ? `Заказ ${trace.orderId} доставлен.`
          : trace.status === 'blocked'
            ? `${graph.nodes.find((n) => n.id === trace.blocked)!.label} не пропускает заказ.`
            : 'Маршрут до цели не найден.');
      shortText(status.content, message, width * 0.9, width / 2, height * 0.9);
      cleanups.push(status.dispose);
      return {
        canvas,
        layer,
        nodes,
        edges,
        packet,
        status,
        point,
        dispose() {
          cleanups.reverse().forEach((fn) => fn());
        },
      };
    } catch (error) {
      cleanups.reverse().forEach((fn) => fn());
      throw error;
    }
  }
  function render(
    graph: DependencyGraph,
    trace: DependencyTrace,
    options: DependencyRouteDiagramOptions,
  ) {
    if (!Number.isFinite(options.progress) || options.progress < 0 || options.progress > 1)
      throw new Error('Dependency drawing progress must lie in [0, 1].');
    const nextKey = JSON.stringify([
      graph,
      trace.orderId,
      trace.status,
      trace.blocked,
      options.width,
      options.height,
      options.scale,
      options.positions,
      options.text,
      options.networkId,
      options.statusId,
    ]);
    const next = nextKey === key && current ? current : prepare(graph, trace, options);
    const journey = tracePath(
      (trace.route.length ? trace.route : [graph.origin]).map(next.point),
      options.progress,
    );
    next.packet.at(...journey.point);
    next.packet.pigment(options.progress === 1 && trace.status === 'blocked' ? 'red' : 'blue');
    next.packet.element.dataset.orderId = trace.orderId;
    next.packet.element.dataset.status = options.progress === 1 ? trace.status : 'travelling';
    for (const { item, port, border } of next.nodes) {
      port.pigment(trace.failedNodes.includes(item.id) ? 'red' : 'ink');
      const location = next.point(item.id);
      border.element.style.visibility =
        Math.hypot(location[0] - journey.point[0], location[1] - journey.point[1]) <
        18 / options.scale
          ? 'hidden'
          : '';
    }
    for (const { edge, arrow } of next.edges) {
      const index = trace.edges.indexOf(edge.id);
      arrow.pigment(index >= 0 ? 'blue' : 'muted');
      arrow.element.style.opacity =
        index >= 0 ? '1' : trace.activeEdges.includes(edge.id) ? '.65' : '.2';
      arrow.element.dataset.route = String(index >= 0);
    }
    next.status.show(options.statusId !== undefined && options.progress === 1);
    if (next !== current) {
      current?.dispose();
      current = next;
      key = nextKey;
      next.canvas.removeAttribute('visibility');
    }
  }
  return {
    render,
    validate(
      graph: DependencyGraph,
      trace: DependencyTrace,
      options: DependencyRouteDiagramOptions,
    ) {
      const candidate = prepare(graph, trace, options);
      candidate.dispose();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      current?.dispose();
      current = undefined;
    },
  };
}
