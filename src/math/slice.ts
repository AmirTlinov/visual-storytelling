import * as T from '../viewport/engine.js';
import type { Viewport } from '../viewport/three.js';
import { TensorView } from './tensor.js';
const smooth = (p: number) => {
  p = Math.max(0, Math.min(1, p));
  return p * p * (3 - 2 * p);
};
/** Extract the first logical axis; source addresses and values remain traceable. */
export function tensorSlice(
  view: Viewport,
  source: TensorView,
  {
    id,
    index = 0,
    title = 'срез',
    tone = 'orange',
  }: { id: string; index?: number; title?: string; tone?: string },
) {
  const data = source.model.slice(0, index),
    group = new T.Group();
  const result = new TensorView(view, data, {
    id,
    title,
    tone,
    cell: source.cellHeight,
    width: source.cellWidth,
  });
  group.add(result.group);
  const reserve = new T.Mesh(
    new T.BoxGeometry(1, 1, 0.01),
    new T.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 }),
  );
  reserve.userData.labelOccluder = false;
  group.add(reserve);
  const indices = source.cells.filter((cell) => cell.address[0] === index).map((c) => c.index);
  const homes = result.cells.map((c) => c.mesh.position.clone());
  let progress = 0,
    reduced = false;
  function layout() {
    const box = source.bounds,
      height =
        Math.max(...homes.map((p) => p.y)) - Math.min(...homes.map((p) => p.y)) + result.cellHeight;
    const destination = new T.Vector3(
      (box.min.x + box.max.x) / 2,
      box.min.y - height / 2 - 1.5,
      box.max.z,
    );
    group.position.copy(group.parent ? group.parent.worldToLocal(destination) : destination);
    group.updateWorldMatrix(true, true);
    reserve.position.set(0, 0, 0);
    reserve.scale.set(
      Math.max(...homes.map((p) => Math.abs(p.x))) * 2 + result.cellWidth,
      height,
      1,
    );
    if (index > 0) {
      const distance = box.max.x - box.min.x + source.cellWidth;
      const top = group.worldToLocal(new T.Vector3(box.max.x + distance, box.max.y, box.max.z));
      const left = -reserve.scale.x / 2,
        bottom = -height / 2;
      reserve.position.set((left + top.x) / 2, (bottom + top.y) / 2, 0);
      reserve.scale.set(top.x - left, top.y - bottom, 1);
    }
    render(progress, reduced);
  }
  function render(amount: number, noMotion = false) {
    progress = amount;
    reduced = noMotion;
    const p = Math.max(0, Math.min(1, amount));
    result.show(noMotion ? p >= 1 : p > 0);
    source.group.updateWorldMatrix(true, true);
    group.updateWorldMatrix(true, true);
    const box = source.bounds;
    result.cells.forEach((cell, i) => {
      const original = source.cells[indices[i]!]!;
      original.lettering = noMotion || p === 0 || p > 0.6;
      const start = original.mesh.getWorldPosition(new T.Vector3()),
        end = group.localToWorld(homes[i]!.clone());
      let point: T.Vector3;
      if (noMotion) point = p >= 1 ? end : start;
      else if (index === 0) {
        const lifted = start.clone();
        lifted.z = box.max.z + source.cellDepth * 1.5;
        point =
          p < 0.2
            ? start.clone().lerp(lifted, smooth(p / 0.2))
            : lifted.lerp(end, smooth((p - 0.2) / 0.8));
      } else {
        const distance = box.max.x - box.min.x + source.cellWidth;
        const outside = start.clone().add(new T.Vector3(distance, 0, 0));
        const front = outside.clone();
        front.z = box.max.z + source.cellDepth;
        const below = front.clone();
        below.y = end.y;
        const points = [start, outside, front, below, end],
          step = Math.min(3, Math.floor(p * 4));
        point = points[step]!.clone().lerp(points[step + 1]!, smooth(p * 4 - step));
      }
      cell.mesh.position.copy(group.worldToLocal(point));
    });
    view.invalidate();
  }
  layout();
  const stopResize = view.onResize(layout);
  return {
    group,
    result,
    framing: [source.framing, reserve],
    render,
    snapshot: () => ({
      sourceAddresses: indices.map((i) => source.cells[i]!.address),
      values: result.values,
      progress,
    }),
    dispose() {
      stopResize();
      indices.forEach((i) => (source.cells[i]!.lettering = true));
      result.dispose();
      view.release(reserve);
      group.removeFromParent();
    },
  };
}
