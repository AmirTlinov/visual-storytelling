import * as T from './engine.js';
import type { Viewport3DHandle } from './three.js';
import { InkStroke3D } from './ink-line.js';
import { objectWithin } from './visibility.js';
import type { TensorData } from '../math/tensor.js';
import type { Pigment } from '../ink/palette.js';
import { mathNumber } from '../morph/numbers.js';

type TensorLabel = ReturnType<Viewport3DHandle['label']>;
type DataPreparation = (next: TensorData) => (() => void) | void;
export interface TensorCell {
  readonly id: string;
  readonly index: number;
  readonly address: readonly number[];
  readonly box: T.Mesh<T.BoxGeometry, T.MeshBasicMaterial>;
  /** Resting position in the tensor object's local coordinates. */
  readonly base: T.Vector3;
  readonly text: TensorLabel;
}
export interface TensorOptions {
  /** Representation identity. Use the root data ID for its original tensor. */
  id: string;
  title?: string;
  pigment?: Pigment;
  cellSize?: number;
  /** Minimum horizontal pitch; longer inscriptions reserve their measured width. */
  cellWidth?: number;
  /** Wrap a vector. Matrix and tensor axes retain their logical rows. */
  columns?: number;
  depthGap?: number;
  format?: (value: number) => string;
  /** Computed receivers link to the existing calculation; source addresses remain automatic. */
  inputs?: (index: number, data: TensorData) => readonly string[];
}

const clamp = (p: number) => Math.max(0, Math.min(1, p));

/** Addressed cells present one immutable snapshot; mathematical transformations belong to TensorData. */
function mount(view: Viewport3DHandle, initial: TensorData, options: TensorOptions) {
  const cellSize = options.cellSize ?? 1,
    cellDepth = cellSize * 0.28,
    depthGap = options.depthGap ?? cellSize * 0.65,
    format = options.format ?? mathNumber;
  if (!options.id.trim()) throw new Error('A tensor representation needs a stable ID');
  if (
    ![cellSize, depthGap, options.cellWidth ?? cellSize].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    depthGap < cellDepth
  )
    throw new Error('Tensor dimensions must be positive, with enough depth between layers');
  if (
    options.columns !== undefined &&
    (!Number.isSafeInteger(options.columns) || options.columns < 1)
  )
    throw new Error('Tensor columns must be a positive integer');
  const validate = (data: TensorData) => {
    if (data.shape.length > 3)
      throw new Error('Select a slice of at most three axes before displaying a tensor');
  };
  validate(initial);
  const object = new T.Group(),
    restBounds = new T.Box3(),
    cells: TensorCell[] = [];
  object.name = options.id;
  let data = initial,
    cellWidth = cellSize,
    revealAmount = 1,
    disposed = false;
  const entries = new Map<
    string,
    {
      cell: TensorCell;
      borders: ReturnType<typeof InkStroke3D.create>[];
      forget(): void;
      resize(): void;
    }
  >();
  const stage = view.renderer.domElement.parentElement!;
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = `112px ${getComputedStyle(stage).fontFamily}`;
  const widthFor = (snapshot: TensorData) => {
    let width = Math.max(cellSize, options.cellWidth ?? 0);
    for (const value of snapshot.values) {
      const aspect = (measure.measureText(format(value)).width + 16) / 160;
      // Match the face inscription owner's 62% height and 92% width padding.
      width = Math.max(width, (aspect * cellSize * 0.86 * 0.62) / (0.9 * 0.92));
    }
    return width;
  };
  cellWidth = widthFor(data);
  let geometry = new T.BoxGeometry(cellWidth * 0.9, cellSize * 0.86, cellDepth);
  const material = view.ink(
    new T.MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    options.pigment === 'ink' ? 'surface' : `${options.pigment ?? 'blue'}-wash`,
  );
  let rootMeaning = () => {};
  let titleLabel: TensorLabel | undefined;
  const dataPreparations = new Set<DataPreparation>(),
    disposeListeners = new Set<() => void>();

  function outline() {
    const x = cellWidth * 0.45,
      y = cellSize * 0.43,
      z = cellDepth / 2;
    const corners = [
      [-x, -y],
      [x, -y],
      [x, y],
      [-x, y],
    ];
    // Four trails cover the twelve box edges exactly once.
    return corners.map((point, i) => {
      const next = corners[(i + 1) % 4]!;
      return [
        [point[0]!, point[1]!, z],
        [next[0]!, next[1]!, z],
        [next[0]!, next[1]!, -z],
        [point[0]!, point[1]!, -z],
      ] as const;
    });
  }
  function clearCells() {
    for (const { cell, borders, forget } of entries.values()) {
      forget();
      cell.text.remove();
      cell.box.removeFromParent();
      for (const border of borders) {
        border.root.geometry.dispose();
        border.root.material.dispose();
      }
    }
    entries.clear();
    cells.length = 0;
  }
  function populate() {
    const paths = outline();
    for (let index = 0; index < data.size; index++) {
      const address = data.indices(index),
        id = `${options.id}:${address.join(',') || 'scalar'}`,
        box = new T.Mesh(geometry, material),
        base = new T.Vector3();
      box.name = id;
      object.add(box);
      const borders = paths.map((points) => {
        const border = InkStroke3D.create(view, points, { width: 1.5, opacity: 0.7 });
        box.add(border.root);
        return border;
      });
      const labelOptions = { face: 'front' as const };
      let text = view.label(format(data.values[index]!), box, labelOptions);
      const cell: TensorCell = {
        id,
        index,
        address,
        box,
        base,
        get text() {
          return text;
        },
      };
      // A new face geometry needs a fresh label attachment; the receiving mesh keeps its identity.
      const resize = () => {
        text.remove();
        text = view.label(format(data.values[index]!), box, labelOptions);
        outline().forEach((points, i) => borders[i]!.points(points));
      };
      const entry = { cell, borders, forget: () => {}, resize };
      entries.set(id, entry);
      cells.push(cell);
      entry.forget = view.describe(box, id, {
        label: `${options.title ?? options.id} [${address.join(', ')}]`,
        value: () => data.values[index],
        inputs: () => [
          ...new Set([
            ...(data.originId(index) === id ? [] : [data.originId(index)]),
            ...(options.inputs?.(index, data) ?? []),
          ]),
        ],
        provenance: () => ({ id: data.originId(index), ...data.origin(index) }),
        implementation: { file: 'src/viewport/tensor.ts' },
      });
    }
  }
  function layout() {
    const columns = data.shape.at(-1) ?? 1,
      rows = data.shape.at(-2) ?? 1,
      displayColumns =
        data.shape.length <= 1 ? Math.min(columns, options.columns ?? columns) : columns,
      displayRows = data.shape.length <= 1 ? Math.ceil(columns / displayColumns) : rows;
    restBounds.makeEmpty();
    for (const cell of cells) {
      const column = data.shape.length <= 1 ? cell.index % displayColumns : cell.index % columns,
        row =
          data.shape.length <= 1
            ? Math.floor(cell.index / displayColumns)
            : Math.floor(cell.index / columns) % rows,
        layer = data.shape.length === 3 ? Math.floor(cell.index / (columns * rows)) : 0,
        displacement = cell.box.position.clone().sub(cell.base);
      cell.base.set(
        (column - (displayColumns - 1) / 2) * cellWidth,
        ((displayRows - 1) / 2 - row) * cellSize,
        -layer * depthGap,
      );
      cell.box.position.copy(cell.base).add(displacement);
      restBounds.expandByPoint(cell.base);
    }
    restBounds.expandByVector(new T.Vector3(cellWidth * 0.45, cellSize * 0.43, cellDepth / 2));
  }
  function reveal(progress: number) {
    if (disposed) throw new Error('Tensor presentation has been disposed');
    if (!Number.isFinite(progress)) throw new Error('Tensor reveal progress must be finite');
    revealAmount = clamp(progress);
    for (const cell of cells) {
      const amount = clamp(revealAmount * cells.length - cell.index);
      cell.box.visible = amount > 0;
      cell.box.scale.setScalar(Math.max(0.001, amount * amount * (3 - 2 * amount)));
      cell.text.show(amount >= 0.96);
    }
    titleLabel?.show(revealAmount > 0);
    view.invalidate();
  }
  /** Prepare dependent selections before this snapshot or any receiving geometry changes. */
  function prepareData(next: TensorData): (afterLayout?: () => void) => void {
    if (disposed) throw new Error('Tensor presentation has been disposed');
    validate(next);
    if (next === data)
      return (afterLayout) => {
        afterLayout?.();
      };
    const previousData = data,
      reshaped =
        next.shape.length !== data.shape.length ||
        next.shape.some((size, i) => size !== data.shape[i]),
      nextWidth = widthFor(next),
      resized = nextWidth !== cellWidth,
      commitSelections = [...dataPreparations].map((prepare) => prepare(next));
    let committed = false;
    return (afterLayout) => {
      if (disposed) throw new Error('Tensor presentation has been disposed');
      if (committed || data !== previousData)
        throw new Error(
          'A prepared tensor update must be committed once against its current snapshot',
        );
      committed = true;
      if (reshaped) clearCells();
      data = next;
      if (resized) {
        cellWidth = nextWidth;
        const previous = geometry;
        geometry = new T.BoxGeometry(cellWidth * 0.9, cellSize * 0.86, cellDepth);
        for (const entry of entries.values()) {
          entry.cell.box.geometry = geometry;
          entry.resize();
        }
        previous.dispose();
      }
      if (reshaped) {
        populate();
        reveal(revealAmount);
      } else for (const cell of cells) cell.text.set(format(data.values[cell.index]!));
      if (reshaped || resized) layout();
      afterLayout?.();
      for (const commit of commitSelections) commit?.();
      view.invalidate();
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const cleanup of [...disposeListeners]) cleanup();
    disposeListeners.clear();
    dataPreparations.clear();
    clearCells();
    titleLabel?.remove();
    rootMeaning();
    geometry.dispose();
    material.dispose();
    object.removeFromParent();
    offDispose();
    offRemove();
    view.invalidate();
  }
  const offDispose = view.onDispose(dispose);
  const offRemove = view.beforeRemove((root) => {
    if (objectWithin(object, root)) dispose();
  });
  try {
    rootMeaning = view.describe(object, options.id, {
      label: options.title ?? options.id,
      value: () => ({ shape: data.shape, axes: data.axes, values: data.values }),
      inputs: () => [
        ...new Set([
          ...(options.id === data.id ? [] : [data.id]),
          ...cells.flatMap((cell) => options.inputs?.(cell.index, data) ?? []),
        ]),
      ],
      provenance: () => ({ tensor: data.id, shape: data.shape, axes: data.axes }),
      implementation: { file: 'src/viewport/tensor.ts' },
    });
    if (options.title) {
      const offset: [number, number] = [0, 0];
      titleLabel = view.label(
        options.title,
        {
          object,
          position: () => {
            // The label owner measures wrapping before evaluating its anchor.
            offset[1] = -(titleLabel!.element.offsetHeight / 2 + 12);
            return new T.Vector3(0, restBounds.max.y, restBounds.max.z);
          },
        },
        { size: 20, tone: options.pigment ?? 'blue', avoidOverlap: true, offset },
      );
    }
    populate();
    layout();
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    id: options.id,
    object,
    get data() {
      return data;
    },
    get cells(): readonly TensorCell[] {
      return cells;
    },
    cell(...address: number[]) {
      return cells[data.offset(address)]!;
    },
    cellSize,
    cellDepth,
    get cellWidth() {
      return cellWidth;
    },
    titleLabel,
    /** Full resting world bounds retain framing during reveal and cell delivery. */
    get bounds() {
      object.updateWorldMatrix(true, false);
      return restBounds.clone().applyMatrix4(object.matrixWorld);
    },
    /** Prepare a synchronous snapshot replacement, including every dependent selection. */
    prepareData,
    setData(next: TensorData) {
      prepareData(next)();
    },
    /** Validate dependent selections now; return their mutation for the parent's commit. */
    beforeDataChange(prepare: DataPreparation) {
      if (disposed) throw new Error('Tensor presentation has been disposed');
      dataPreparations.add(prepare);
      return () => {
        dataPreparations.delete(prepare);
      };
    },
    onDispose(cleanup: () => void) {
      if (disposed) throw new Error('Tensor presentation has been disposed');
      disposeListeners.add(cleanup);
      return () => {
        disposeListeners.delete(cleanup);
      };
    },
    reveal,
    dispose,
  };
}

export const Tensor3D = { mount };
export type TensorHandle = ReturnType<typeof mount>;
