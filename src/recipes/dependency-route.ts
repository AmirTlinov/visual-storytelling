import { object } from '../ink/object.js';
import { paragraph } from '../ink/paragraph.js';
import { svg } from '../ink/dom.js';
import { pen } from '../ink/pen.js';
import { node } from './node.js';
import { vector } from './vector.js';
import { tracePath } from './trace-path.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import {
  dependencyObservation,
  type DependencyGraph,
  type DependencyTrace,
} from './dependency-route-model.js';
import { releaseResources } from '../lifecycle.js';
import { routeLabelPlacement } from './route-label-placement.js';

export interface DependencyRouteDiagramOptions {
  modelId: string;
  width: number;
  height: number;
  scale: number;
  progress: number;
  networkId: string;
  statusId?: string;
  present?: boolean;
  text?: string;
  /** Layout coordinates are fractions of the drawing, independent of route computation. */
  positions: Readonly<Record<string, Point>>;
}

/** Nodes and arrows provide context; the existing computed trace alone moves the persistent order. */
export function dependencyRouteDiagram(view: Surface) {
  let current: ReturnType<typeof prepare> | undefined;
  let key = '';
  let disposed = false;
  function prepare(
    graph: DependencyGraph,
    trace: DependencyTrace,
    options: DependencyRouteDiagramOptions,
  ) {
    if (disposed) throw new Error('Dependency drawing has been disposed.');
    const { width, height, scale, positions, modelId } = options;
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
      const radius = Math.min(12, displayed / 48) / scale;
      const packetSize: Point = [
        Math.max(32 / scale, font * trace.orderId.length * 0.75),
        Math.max(24 / scale, font + 8 / scale),
      ];
      const routes = graph.edges.map((edge) => [point(edge.from), point(edge.to)] as const);
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
        const label = shortText(
          port.content,
          displayed < 640 ? (item.shortLabel ?? item.label) : item.label,
          width * 0.22,
          0,
          0,
        );
        label.element.dataset.routeLabel = item.id;
        cleanups.push(border.dispose, port.dispose);
        return { item, port, border, label, x, y };
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
        width: packetSize[0],
        height: packetSize[1],
        padding: 4 / scale,
        size: font,
        minSize: font,
        pigment: 'blue',
      });
      const meaning = {
        id: trace.orderId,
        present: options.present !== false,
        outcome: 'travelling',
        trace,
      };
      packet.describe({
        label: `Заказ ${trace.orderId}`,
        interactive: false,
        value: () => ({ id: meaning.id, present: meaning.present, outcome: meaning.outcome }),
        provenance: () => ({
          kind: 'model',
          route: meaning.trace.route,
          plannedEvents: meaning.trace.events,
        }),
      });
      cleanups.push(packet.dispose);
      if (packet.width > width * 0.22)
        throw new Error('The order ID needs a shorter readable inscription.');
      const status = object(layer.content, options.statusId ?? `${modelId}:status`);
      const message =
        options.text ??
        (options.present === false
          ? `Заказ ${trace.orderId} удалён.`
          : trace.status === 'delivered'
            ? `Заказ ${trace.orderId} доставлен.`
            : trace.status === 'blocked'
              ? `${graph.nodes.find((n) => n.id === trace.blocked)!.label} не пропускает заказ.`
              : 'Маршрут до цели не найден.');
      status.describe({ label: message, interactive: false });
      const caption = shortText(status.content, message, width * 0.9, width / 2, height * 0.9);
      const captionY = Math.min(
        height * 0.9,
        height - 6 / scale - caption.bounds.y - caption.bounds.height,
      );
      caption.render(message, width * 0.9, width / 2, captionY);
      cleanups.push(status.dispose);
      for (const { item, label, x, y } of nodes) {
        let position: Point;
        try {
          position = routeLabelPlacement(
            label.bounds,
            [x, y],
            routes,
            [width, captionY + caption.bounds.y - 6 / scale],
            radius,
            [packet.width, packet.height],
            6 / scale,
          );
        } catch (cause) {
          throw new Error(`Route label ${item.label} needs room at ${Math.round(displayed)} px.`, {
            cause,
          });
        }
        label.render(
          displayed < 640 ? (item.shortLabel ?? item.label) : item.label,
          width * 0.22,
          ...position,
        );
      }

      return {
        canvas,
        layer,
        nodes,
        edges,
        packet,
        meaning,
        status,
        point,
        dispose() {
          releaseResources(cleanups.toReversed(), 'Dependency drawing release failed.');
        },
      };
    } catch (error) {
      releaseResources(
        [
          () => {
            throw error;
          },
          ...cleanups.toReversed(),
        ],
        'Dependency drawing preparation failed.',
      );
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
      options.modelId,
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
      options.present,
    ]);
    const next = nextKey === key && current ? current : prepare(graph, trace, options);
    const journey = tracePath(
      (trace.route.length ? trace.route : [graph.origin]).map(next.point),
      options.progress,
    );
    next.packet.at(...journey.point);
    const observed = dependencyObservation(trace, options.progress, options.present !== false);
    next.packet.pigment(observed.outcome === 'blocked' ? 'red' : 'blue');
    next.packet.element.dataset.orderId = trace.orderId;
    next.packet.element.dataset.status = observed.outcome;
    next.meaning.trace = trace;
    next.meaning.outcome = observed.outcome;
    next.packet.show(options.present !== false);
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
    next.status.show(
      Boolean(options.text) || (options.statusId !== undefined && options.progress === 1),
    );
    if (next !== current) {
      const previous = current;
      current = next;
      key = nextKey;
      next.canvas.removeAttribute('visibility');
      try {
        previous?.dispose();
      } catch (error) {
        console.warn('Previous dependency drawing cleanup failed.', error);
      }
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
