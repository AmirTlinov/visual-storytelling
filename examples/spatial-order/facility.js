import { ThreeKit as T, InkConnection3D } from '@visual-storytelling/core/three';
import {
  tracePath,
  instructionalDependencyGraph,
  dependencyObservation,
} from '@visual-storytelling/core/recipes';
import { city, metre, metreX, localBounds, insideRegion } from './geography.js';

export const facilityBounds = localBounds(
  100 * metreX,
  18 * metre,
  60 * metre,
  city.clone().add(new T.Vector3(0, 6 * metre, 0)),
);
export const orderBounds = localBounds(
  20 * metreX,
  16 * metre,
  16 * metre,
  city.clone().add(new T.Vector3(-32 * metreX, 5 * metre, 0)),
);
const positions = {
  shop: [-32, 0],
  gateway: [-13, -12],
  backup: [-13, 12],
  provider: [13, -12],
  independent: [13, 12],
  bank: [32, 0],
};

/** An 80×40×8 metre illustrative envelope at a real settlement anchor; no real data-centre address is claimed. */
export function facility(view, parent, { modelId, orderId, position = city }) {
  const root = new T.Group();
  root.position.copy(position);
  parent.add(root);
  let state;
  const material = (tone, amount = 1, opacity = 1) =>
    view.ink(new T.MeshBasicMaterial({ transparent: opacity < 1, opacity }), (p) =>
      p.surface.clone().lerp(p[tone], amount),
    );
  const roofPaint = material('blue', 0.25, 0.9),
    wallsPaint = material('blue', 0.16, 0.6);
  const box = (x, y, z, w, h, d, paint) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w * metreX, h * metre, d * metre), paint);
    mesh.position.set(x * metreX, y * metre, z * metre);
    root.add(mesh);
    return mesh;
  };
  const floor = box(0, -0.05, 0, 80, 0.1, 40, material('blue', 0.12));
  for (const [x, z, w, d] of [
    [0, -20, 80, 1],
    [0, 20, 80, 1],
    [-40, 0, 1, 40],
    [40, 0, 1, 40],
  ])
    box(x, 4, z, w, 8, d, wallsPaint);
  box(0, 8, 0, 80, 0.2, 40, roofPaint);
  for (const x of [-40, 40])
    for (const z of [-20, 20])
      if (!insideRegion(city.clone().add(new T.Vector3(x * metreX, 0, z * metre))))
        throw Error('Facility footprint leaves its source region.');
  view.describe(floor, 'facility', {
    label: 'Учебный макет устройства',
    interactive: false,
    value: () => ({
      coordinates: city.toArray(),
      dimensionsMetres: [80, 40, 8],
      illustrative: true,
    }),
  });
  const nodes = {},
    labels = [],
    options = [];
  const label = (text, object, extra = {}) => {
    const settings = {
      size: 22,
      tone: 'ink',
      offset: [0, -12],
      priority: 4,
      ...extra,
    };
    options.push(settings);
    labels.push(view.label(text, { object, position: new T.Vector3(0, 4 * metre, 0) }, settings));
  };
  for (const { id, label: nodeLabel } of instructionalDependencyGraph.nodes) {
    const [x, z] = positions[id];
    const paint = view.ink(new T.MeshBasicMaterial(), (p) =>
      p.surface.clone().lerp(state?.trace.failedNodes.includes(id) ? p.red : p.blue, 0.3),
    );
    const object = box(x, 1.8, z, 7, 3.6, 5, paint);
    nodes[id] = object;
    view.describe(object, `${modelId}:node:${id}`, {
      label: nodeLabel,
      value: () => ({
        id,
        failed: state?.trace.failedNodes.includes(id),
        orderId: state?.trace.orderId,
      }),
      provenance: () => ({ resources: ['teaching-network'], operation: 'dependency-route' }),
    });
    label(
      {
        shop: 'Магазин',
        gateway: 'Оплата',
        backup: 'Резерв',
        provider: 'А',
        independent: 'Б',
        bank: 'Банк',
      }[id],
      object,
    );
  }
  const space = new T.Group();
  space.rotation.x = -Math.PI / 2;
  root.add(space);
  const edges = instructionalDependencyGraph.edges.map(({ id, from, to }) => {
    const connection = InkConnection3D.create(view, nodes[from], nodes[to], {
      space,
      avoid: Object.values(nodes),
      color: 'blue',
      width: 2.2,
      gap: metre,
      clearance: 2 * metre,
      depth: 0.2 * metre,
      headSize: 3 * metre,
      fromSide: 'right',
      toSide: 'left',
    });
    connection.root.traverse((object) => {
      if (object.material)
        view.ink(object.material, (p) => (state?.trace.edges.includes(id) ? p.blue : p.muted));
    });
    return { id, connection };
  });
  const packet = new T.Mesh(new T.SphereGeometry(1.2 * metre, 16, 10), material('orange'));
  packet.position.copy(nodes.shop.position).add(new T.Vector3(0, 4 * metre, 0));
  root.add(packet);
  view.describe(packet, `${modelId}:order:${orderId}`, {
    label: `Заказ ${orderId}`,
    value: () =>
      state && dependencyObservation(state.trace, state.progress, state.present !== false),
    provenance: () => ({
      resources: ['teaching-network'],
      operation: 'trace',
      model: modelId,
      route: state?.trace.route,
      plannedEvents: state?.trace.events,
    }),
  });
  label(() => state?.trace.orderId ?? orderId, packet, {
    frame: { padding: [5, 3] },
    tone: 'orange',
    priority: 10,
    offset: [0, -16],
  });
  return {
    root,
    packet,
    render(model, { open = 1, labelScale = 1, network = true, networkOpacity = 1 } = {}) {
      state = model;
      for (const edge of edges) edge.connection.update();
      const route = state.trace.route.length
        ? state.trace.route
        : [instructionalDependencyGraph.origin];
      const points = [[nodes[route[0]].position.x, nodes[route[0]].position.z]];
      for (let i = 0; i < state.trace.edges.length; i++) {
        const edge = edges.find((e) => e.id === state.trace.edges[i]);
        for (const p of edge.connection.route) {
          const point = root.worldToLocal(space.localToWorld(new T.Vector3(...p)));
          points.push([point.x, point.z]);
        }
        const node = nodes[route[i + 1]];
        points.push([node.position.x, node.position.z]);
      }
      const path = tracePath(points, state.progress);
      packet.position.set(path.point[0], 5.8 * metre, path.point[1]);
      packet.visible = state.present !== false;
      roofPaint.opacity = 0.9 - 0.8 * open;
      wallsPaint.opacity = 0.6 - 0.45 * open;
      for (const edge of edges)
        edge.connection.root.traverse((object) => {
          if (object.material) {
            object.material.opacity = state.trace.activeEdges.includes(edge.id) ? 1 : 0.12;
            object.material.linewidth = 2.2 / labelScale;
          }
        });
      for (let i = 0; i < options.length; i++) {
        options[i].size = 20 / labelScale;
        options[i].visible = () => i === options.length - 1 || network;
        options[i].maxWidth = 160 / labelScale;
        labels[i].opacity(i === options.length - 1 ? 1 : networkOpacity);
      }
      view.invalidate();
    },
    snapshot() {
      return {
        orderId: state?.trace.orderId,
        plannedTrace: state?.trace,
        observation:
          state && dependencyObservation(state.trace, state.progress, state.present !== false),
        position: packet.getWorldPosition(new T.Vector3()).toArray(),
      };
    },
  };
}
