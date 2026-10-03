import * as T from '../viewport/engine.js';
import { projectBox } from '../viewport/projection.js';
import type { Viewport } from '../viewport/three.js';
import { TensorData, formatNumber } from './tensor-data.js';
export interface TensorOptions {
  id: string;
  title?: string;
  tone?: string;
  cell?: number;
  width?: number;
  columns?: number;
  depthGap?: number;
  numbers?: boolean;
  format?: (value: number) => string;
}
export interface TensorCell {
  index: number;
  address: readonly number[];
  value: number;
  mesh: T.Mesh;
  label?: ReturnType<Viewport['label']>;
  shown: boolean;
  lettering: boolean;
  active: boolean;
  pending: boolean;
}
export function measureCells(
  stage: HTMLElement,
  values: readonly number[],
  cell = 1,
  format: (n: number) => string = formatNumber,
) {
  const probe = document.createElement('span');
  probe.className = 've-label ve-face-label';
  probe.style.cssText = 'visibility:hidden;font-size:20px';
  stage.append(probe);
  let textWidth = 0;
  for (const value of values) {
    probe.textContent = format(value);
    textWidth = Math.max(textWidth, probe.offsetWidth);
  }
  probe.remove();
  const minimum = textWidth * 0.8 + 12;
  // Reserve the full 16px value and padding at the overview's 48px/world-unit scale.
  return { width: cell * Math.max(1, minimum / (0.9 * 48)), minimum };
}
/** Data, solids and projected lettering have one identity and one visibility owner. */
export class TensorView {
  readonly group = new T.Group();
  readonly cells: TensorCell[] = [];
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly cellDepth: number;
  private cleanups: (() => void)[] = [];
  private title?: ReturnType<Viewport['label']>;
  private repaint = new Map<number, () => void>();
  private frame = new T.Mesh(
    new T.BoxGeometry(1, 1, 1),
    new T.MeshBasicMaterial({ visible: false, transparent: true, opacity: 0 }),
  );
  private revealAmount = 1;
  private data: TensorData;
  constructor(
    readonly view: Viewport,
    data: TensorData,
    readonly options: TensorOptions,
  ) {
    if (data.shape.length > 3)
      throw new Error('Select a slice of at most three axes before displaying a tensor');
    this.data = data;
    this.group.name = options.id;
    this.frame.userData.labelOccluder = false;
    this.group.add(this.frame);
    const cell = options.cell ?? 1,
      format = options.format ?? formatNumber;
    this.cellWidth = options.width ?? measureCells(view.stage, data.values, cell, format).width;
    this.cellHeight = cell;
    this.cellDepth = cell * 0.28;
    const geometry = new T.BoxGeometry(this.cellWidth * 0.9, cell * 0.86, this.cellDepth);
    const shades = new T.Float32BufferAttribute(new Float32Array(24 * 3), 3);
    geometry.setAttribute('color', shades);
    let lightPaper: boolean | undefined;
    const shadeFaces = (palette: Viewport['palette']) => {
      const surface = palette.surface!,
        light = surface.r + surface.g + surface.b > 1.5;
      if (light === lightPaper) return;
      lightPaper = light;
      [
        light ? 0.86 : 1.2,
        light ? 0.86 : 1.2,
        1.03,
        light ? 0.86 : 1.2,
        1,
        light ? 0.86 : 1.2,
      ].forEach((value, face) => {
        for (let vertex = 0; vertex < 4; vertex++)
          shades.setXYZ(face * 4 + vertex, value, value, value);
      });
      shades.needsUpdate = true;
    };
    const outline = new T.EdgesGeometry(geometry);
    const border = view.ink(new T.LineBasicMaterial({ transparent: true, opacity: 0.6 }), 'ink');
    const activeBorder = view.ink(new T.LineBasicMaterial(), options.tone ?? 'blue');
    data.values.forEach((value, index) => {
      let item: TensorCell;
      const material = new T.MeshBasicMaterial({
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const color = (palette: Viewport['palette']) => {
        shadeFaces(palette);
        return palette[item?.pending ? 'surface' : `${options.tone ?? 'blue'}-wash`]!;
      };
      view.ink(material, color);
      const mesh = new T.Mesh(geometry, material);
      const edge = new T.LineSegments(outline, border),
        activeEdge = new T.LineSegments(outline, activeBorder);
      activeEdge.visible = false;
      mesh.add(edge, activeEdge);
      this.group.add(mesh);
      mesh.userData.tensor = { id: options.id, address: data.indices(index) };
      item = {
        index,
        address: data.indices(index),
        value,
        mesh,
        shown: true,
        lettering: true,
        active: false,
        pending: false,
      };
      this.repaint.set(index, () => view.ink(material, color));
      const halfW = this.cellWidth * 0.45,
        halfH = cell * 0.43,
        z = this.cellDepth / 2 + 0.005;
      if (options.numbers !== false)
        item.label = view.label(format(value), () => mesh.localToWorld(new T.Vector3(0, 0, z)), {
          id: `${options.id}:${data.indices(index).join(',')}`,
          size: 20,
          minSize: 16,
          occlude: true,
          priority: () => (item.active ? 100 : 20),
          face: {
            object: mesh,
            corners: () =>
              [
                [-halfW, -halfH],
                [halfW, -halfH],
                [halfW, halfH],
                [-halfW, halfH],
              ].map(([x, y]) => new T.Vector3(x!, y!, z)),
          },
          visible: () =>
            item.shown &&
            !item.pending &&
            item.lettering &&
            this.revealAmount > (index + 0.96) / data.values.length,
        });
      this.cleanups.push(view.avoid(mesh));
      this.cells.push(item);
      item.mesh.userData.setActive = (active: boolean) => {
        edge.visible = !active;
        activeEdge.visible = active;
      };
    });
    if (options.title)
      this.title = view.label(
        options.title,
        () => {
          const box = new T.Box3().setFromObject(this.frame);
          return new T.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.5, box.max.z);
        },
        {
          id: `${options.id}:title`,
          tone: options.tone,
          size: 20,
          wrap: () =>
            projectBox(this.frame, view.camera, view.stage.clientWidth, view.stage.clientHeight)
              .width,
          priority: () => 60,
          visible: () => this.group.visible && this.revealAmount > 0,
        },
      );
    this.layout(options.columns);
  }
  layout(columns?: number) {
    const shape = this.data.shape,
      cols = shape.at(-1) ?? 1,
      rows = shape.at(-2) ?? 1;
    const displayCols = shape.length <= 1 ? Math.min(cols, Math.max(1, columns ?? cols)) : cols;
    const displayRows = shape.length <= 1 ? Math.ceil(cols / displayCols) : rows;
    this.cells.forEach((item, i) => {
      const c = shape.length <= 1 ? i % displayCols : i % cols;
      const r = shape.length <= 1 ? Math.floor(i / displayCols) : Math.floor(i / cols) % rows;
      const depth = shape.length === 3 ? Math.floor(i / (cols * rows)) : 0;
      item.mesh.position.set(
        (c - (displayCols - 1) / 2) * this.cellWidth,
        ((displayRows - 1) / 2 - r) * this.cellHeight,
        -depth * (this.options.depthGap ?? 0.65),
      );
    });
    const box = new T.Box3();
    for (const item of this.cells) box.expandByPoint(item.mesh.position.clone());
    box.min.add(new T.Vector3(-this.cellWidth / 2, -this.cellHeight / 2, -this.cellDepth / 2));
    box.max.add(new T.Vector3(this.cellWidth / 2, this.cellHeight / 2, this.cellDepth / 2));
    this.frame.position.copy(box.getCenter(new T.Vector3()));
    this.frame.scale.copy(box.getSize(new T.Vector3()));
    this.view.invalidate();
  }
  setValues(values: readonly number[]) {
    if (values.length !== this.cells.length || values.some((v) => !Number.isFinite(v)))
      throw new Error('Update must preserve tensor shape and finite values');
    if (values.every((value, index) => value === this.cells[index]!.value)) return;
    this.data = new TensorData(this.data.shape, values, this.data.axes);
    const format = this.options.format ?? formatNumber;
    this.cells.forEach((cell, i) => {
      cell.value = values[i]!;
      if (cell.label) cell.label.element.textContent = format(cell.value);
    });
    this.view.invalidate();
  }
  show(visible: boolean) {
    this.group.visible = visible;
    this.view.invalidate();
  }
  showCell(index: number, visible: boolean) {
    const c = this.cells[index]!;
    c.shown = visible;
    c.mesh.visible = visible;
    this.view.invalidate();
  }
  pendingCell(index: number, pending: boolean) {
    const cell = this.cells[index]!;
    if (cell.pending === pending) return;
    cell.pending = pending;
    this.repaint.get(index)!();
    this.view.invalidate();
  }
  get model() {
    return this.data;
  }
  get framing() {
    return this.frame;
  }
  highlight(index: number) {
    this.cells.forEach((c, i) => {
      c.active = i === index;
      c.mesh.userData.setActive(c.active);
    });
    this.view.invalidate();
  }
  reveal(amount: number) {
    this.revealAmount = Math.max(0, Math.min(1, amount));
    this.cells.forEach((c, i) => {
      const p = Math.max(0, Math.min(1, amount * this.cells.length - i));
      c.mesh.scale.setScalar(Math.max(0.001, p * p * (3 - 2 * p)));
    });
    this.view.invalidate();
  }
  get values() {
    return this.cells.map((c) => c.value);
  }
  get bounds() {
    this.group.updateWorldMatrix(true, true);
    return new T.Box3().setFromObject(this.group);
  }
  dispose() {
    this.title?.remove();
    for (const cell of this.cells) cell.label?.remove();
    this.cleanups.forEach((fn) => fn());
    this.repaint.clear();
    this.view.release(this.group);
    this.group.removeFromParent();
  }
}
