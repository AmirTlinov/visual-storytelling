import * as T from './engine.js';
import { Tensor3D, type TensorHandle, type TensorOptions } from './tensor.js';
import { TensorData } from '../math/tensor.js';
import type { Viewport3DHandle } from './three.js';

export interface TensorSliceOptions {
  id: string;
  title?: string;
  pigment?: TensorOptions['pigment'];
  /** Select from the current source snapshot; original addresses identify the travelling cells. */
  select(data: TensorData): TensorData;
}

/** One selection follows its source snapshot; Story supplies the progress of its extraction. */
function mount(view: Viewport3DHandle, source: TensorHandle, options: TensorSliceOptions) {
  let select = options.select;
  function prepare(snapshot: TensorData, selection: TensorSliceOptions['select']) {
    const data = selection(snapshot);
    if (!(data instanceof TensorData)) throw new Error('A tensor selection must return TensorData');
    if (data.shape.length > 3)
      throw new Error('Select a slice of at most three axes before displaying a tensor');
    const addresses = new Map(
      Array.from({ length: snapshot.size }, (_, i) => [snapshot.originId(i), i]),
    );
    const origins = Array.from({ length: data.size }, (_, i) => {
      const index = addresses.get(data.originId(i));
      if (index === undefined || snapshot.values[index] !== data.values[i])
        throw new Error('A tensor selection must refer to cells in the current source snapshot');
      return index;
    });
    return { data, origins };
  }
  const initial = prepare(source.data, select);
  const result = Tensor3D.mount(view, initial.data, {
    id: options.id,
    title: options.title,
    pigment: options.pigment ?? 'orange',
    cellSize: source.cellSize,
    cellWidth: source.cellWidth,
  });
  let origins = initial.origins;
  let disposed = false;
  let progress = 0;
  let reduced = false;
  const cleanups: (() => void)[] = [];
  const smooth = (value: number) => value * value * (3 - 2 * value);

  function active() {
    if (disposed) throw new Error('Tensor slice has been disposed');
  }
  function extractionPaths() {
    source.object.updateWorldMatrix(true, true);
    result.object.updateWorldMatrix(true, true);
    const placement = source.object.matrixWorld
      .clone()
      .invert()
      .multiply(result.object.matrixWorld);
    const orientation = placement.clone().setPosition(0, 0, 0);
    const geometry = result.cells[0]!.box.geometry;
    geometry.computeBoundingBox();
    const half = geometry
      .boundingBox!.clone()
      .applyMatrix4(orientation)
      .getSize(new T.Vector3())
      .multiplyScalar(0.5);
    const obstacles = source.cells.map(({ box }) => {
      box.geometry.computeBoundingBox();
      return box.geometry.boundingBox!.clone().applyMatrix4(box.matrix);
    });
    const sourceBounds = obstacles.reduce((bounds, box) => bounds.union(box), new T.Box3());
    const starts = origins.map((index) => source.cells[index]!.box.position.clone());
    const margin = source.cellDepth * 0.1;
    const sideShift =
      sourceBounds.max.x - Math.min(...starts.map((point) => point.x)) + half.x + margin;
    const front = sourceBounds.max.z + half.z + margin;
    const paths = result.cells.map((cell, i) => {
      const start = starts[i]!;
      const end = cell.base.clone().applyMatrix4(placement);
      const ahead = obstacles.filter(
        (box, index) =>
          index !== origins[i] &&
          box.min.z > start.z &&
          box.min.x < start.x + half.x &&
          box.max.x > start.x - half.x &&
          box.min.y < start.y + half.y &&
          box.max.y > start.y - half.y,
      );
      const approach = new T.Vector3(end.x, end.y, front);
      if (!ahead.length)
        return { points: [start, new T.Vector3(start.x, start.y, front), approach, end], scale: 1 };
      const back = obstacles[origins[i]!]!.max.z;
      const next = Math.min(...ahead.map((box) => box.min.z));
      // The copy first enters the gap beside its layer, then leaves the stack sideways.
      const release = new T.Vector3(start.x, start.y, (back + next) / 2);
      const side = new T.Vector3(start.x + sideShift, start.y, release.z);
      return {
        points: [start, release, side, new T.Vector3(side.x, side.y, front), approach, end],
        scale: Math.min(1, Math.max(0.001, ((next - back) / 2 - margin) / half.z)),
      };
    });
    return { paths, half, sourceBounds };
  }
  function applyPose() {
    const { paths } = extractionPaths();
    result.cells.forEach((cell, i) => {
      const { points, scale } = paths[i]!;
      const compact = scale < 1;
      const travel = compact ? Math.max(0, Math.min(1, (progress - 0.1) / 0.8)) : progress;
      const step = Math.min(points.length - 2, Math.floor(travel * (points.length - 1)));
      const point = reduced
        ? points.at(-1)!.clone()
        : points[step]!.clone().lerp(
            points[step + 1]!,
            smooth(travel * (points.length - 1) - step),
          );
      const amount =
        !compact || reduced
          ? 1
          : progress < 0.1
            ? 1 + (scale - 1) * smooth(progress / 0.1)
            : progress > 0.9
              ? scale + (1 - scale) * smooth((progress - 0.9) / 0.1)
              : scale;
      cell.box.scale.setScalar(amount);
      cell.text.show(cell.box.visible && amount >= 0.96);
      source.object.localToWorld(point);
      cell.box.position.copy(result.object.worldToLocal(point));
    });
  }
  function present() {
    result.reveal(reduced ? Number(progress === 1) : Number(progress > 0));
    applyPose();
  }
  function render(amount: number, noMotion = false) {
    active();
    if (!Number.isFinite(amount)) throw new Error('A tensor slice needs finite progress');
    progress = Math.max(0, Math.min(1, amount));
    reduced = noMotion;
    present();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cleanups.splice(0).forEach((cleanup) => cleanup());
    result.dispose();
  }
  try {
    cleanups.push(source.onDispose(dispose), result.onDispose(dispose));
    cleanups.push(
      source.beforeDataChange((snapshot) => {
        const next = prepare(snapshot, select);
        const commit = result.prepareData(next.data);
        return () => {
          commit(() => {
            origins = next.origins;
            present();
          });
        };
      }),
    );
    present();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    object: result.object,
    result,
    render,
    /** Validate the new selection and its dependants before changing any presentation. */
    setSelection(next: TensorSliceOptions['select']) {
      active();
      const prepared = prepare(source.data, next);
      const commit = result.prepareData(prepared.data);
      commit(() => {
        select = next;
        origins = prepared.origins;
        present();
      });
    },
    /** Fixed envelope of the source, destination and extraction path, independent of progress. */
    get bounds() {
      active();
      const { paths, half, sourceBounds } = extractionPaths();
      for (const { points } of paths)
        for (const point of points)
          sourceBounds.union(new T.Box3(point.clone().sub(half), point.clone().add(half)));
      return sourceBounds.applyMatrix4(source.object.matrixWorld);
    },
    dispose,
  };
}

export const TensorSlice3D = { mount };
