import type { MathValue } from './value.js';

export interface TensorDataOptions {
  id: string;
  shape: readonly number[];
  values: readonly number[];
  axes?: readonly string[];
}

export interface TensorOrigin {
  readonly tensor: string;
  readonly address: readonly number[];
  readonly index: number;
  readonly value: number;
}

interface TensorRoot {
  readonly shape: readonly number[];
  readonly values: readonly number[];
}

const maximumArrayLength = 2 ** 32 - 1;
const materializedValues = new WeakMap<TensorData, readonly number[]>();

function shapeSize(shape: readonly number[]) {
  let size = 1;
  for (const dimension of shape) {
    if (!Number.isSafeInteger(dimension) || dimension < 1)
      throw new Error('Tensor dimensions must be positive safe integers');
    size *= dimension;
    if (!Number.isSafeInteger(size) || size > maximumArrayLength)
      throw new Error('Tensor shape exceeds the JavaScript array capacity');
  }
  return size;
}

function axisNames(shape: readonly number[], axes?: readonly string[]) {
  if (axes === undefined) return Object.freeze(shape.map((_, i) => `ось ${i + 1}`));
  if (
    axes.length !== shape.length ||
    [...axes].some((axis) => typeof axis !== 'string' || !axis.trim()) ||
    new Set(axes).size !== axes.length
  )
    throw new Error('Name every tensor axis with a distinct nonempty string');
  return Object.freeze([...axes]);
}

function coordinates(shape: readonly number[], index: number) {
  const address = new Array<number>(shape.length);
  for (let axis = shape.length - 1; axis >= 0; axis--) {
    address[axis] = index % shape[axis]!;
    index = Math.floor(index / shape[axis]!);
  }
  return Object.freeze(address);
}

/** Identity belongs to the original coordinate, independent of the current arrangement. */
export function tensorOriginId(origin: Pick<TensorOrigin, 'tensor' | 'address'>) {
  return `${origin.tensor}:${origin.address.join(',') || 'scalar'}`;
}

/** An immutable snapshot; selections retain indices into the same original values. */
export class TensorData {
  readonly id: string;
  readonly shape: readonly number[];
  readonly axes: readonly string[];
  readonly size: number;
  private readonly root: TensorRoot;
  private readonly order?: readonly number[];

  constructor({ id, shape, values, axes }: TensorDataOptions) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('A tensor needs a nonempty id');
    this.size = shapeSize(shape);
    if (values.length !== this.size) throw new Error('Tensor shape must match its values');
    for (const value of values)
      if (!Number.isFinite(value)) throw new Error('Tensor values must be finite numbers');
    this.id = id;
    this.shape = Object.freeze([...shape]);
    this.axes = axisNames(this.shape, axes);
    this.root = Object.freeze({ shape: this.shape, values: Object.freeze([...values]) });
    Object.freeze(this);
  }

  /** Materialized values are a frozen cache; the original snapshot remains their owner. */
  get values(): readonly number[] {
    if (!this.order) return this.root.values;
    let values = materializedValues.get(this);
    if (!values) {
      values = Object.freeze(this.order.map((index) => this.root.values[index]!));
      materializedValues.set(this, values);
    }
    return values;
  }

  private rootIndex(index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.size)
      throw new Error('Tensor index outside its shape');
    return this.order ? this.order[index]! : index;
  }

  private selection(
    shape: readonly number[],
    axes: readonly string[],
    order: readonly number[] | undefined,
  ): TensorData {
    // A derived descriptor shares the root instead of invoking the snapshot constructor.
    const selection: TensorData = Object.assign(Object.create(TensorData.prototype), {
      id: this.id,
      shape: Object.freeze([...shape]),
      axes: Object.freeze([...axes]),
      size: shapeSize(shape),
      root: this.root,
      order: order && Object.freeze(order),
    });
    Object.freeze(selection);
    return selection;
  }

  offset(address: readonly number[]) {
    if (address.length !== this.shape.length)
      throw new Error('Tensor coordinate must name every axis');
    let index = 0;
    for (let axis = 0; axis < this.shape.length; axis++) {
      const coordinate = address[axis]!;
      if (!Number.isSafeInteger(coordinate) || coordinate < 0 || coordinate >= this.shape[axis]!)
        throw new Error('Tensor coordinate outside its shape');
      index = index * this.shape[axis]! + coordinate;
    }
    return index;
  }

  indices(index: number): readonly number[] {
    this.rootIndex(index);
    return coordinates(this.shape, index);
  }

  at(...address: number[]) {
    return this.root.values[this.rootIndex(this.offset(address))]!;
  }

  origin(index: number): TensorOrigin {
    const original = this.rootIndex(index);
    return Object.freeze({
      tensor: this.id,
      address: coordinates(this.root.shape, original),
      index: original,
      value: this.root.values[original]!,
    });
  }

  originId(index: number) {
    return tensorOriginId(this.origin(index));
  }

  slice(axis: number, index: number): TensorData {
    if (!Number.isSafeInteger(axis) || axis < 0 || axis >= this.shape.length)
      throw new Error('Tensor slice axis outside its shape');
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.shape[axis]!)
      throw new Error('Tensor slice index outside its axis');
    const block = this.shape.slice(axis + 1).reduce((size, dimension) => size * dimension, 1);
    const stride = block * this.shape[axis]!;
    return this.selection(
      this.shape.filter((_, i) => i !== axis),
      this.axes.filter((_, i) => i !== axis),
      Array.from({ length: this.size / this.shape[axis]! }, (_, i) =>
        this.rootIndex(Math.floor(i / block) * stride + index * block + (i % block)),
      ),
    );
  }

  transpose(order: readonly number[]): TensorData {
    if (
      order.length !== this.shape.length ||
      new Set(order).size !== order.length ||
      [...order].some((axis) => !Number.isSafeInteger(axis) || axis < 0 || axis >= order.length)
    )
      throw new Error('Tensor transpose needs a permutation of all axes');
    if (order.every((axis, i) => axis === i)) return this;
    const shape = order.map((axis) => this.shape[axis]!);
    let stride = 1;
    const strides = new Array<number>(this.shape.length);
    for (let axis = this.shape.length - 1; axis >= 0; axis--) {
      strides[axis] = stride;
      stride *= this.shape[axis]!;
    }
    return this.selection(
      shape,
      order.map((axis) => this.axes[axis]!),
      Array.from({ length: this.size }, (_, i) => {
        let original = 0;
        for (let axis = shape.length - 1; axis >= 0; axis--) {
          original += (i % shape[axis]!) * strides[order[axis]!]!;
          i = Math.floor(i / shape[axis]!);
        }
        return this.rootIndex(original);
      }),
    );
  }

  /** Reshape preserves the current value order; supply names for the new axes. */
  reshape(shape: readonly number[], axes?: readonly string[]): TensorData {
    if (shapeSize(shape) !== this.size) throw new Error('Tensor reshape must preserve its size');
    return this.selection(shape, axisNames(shape, axes), this.order);
  }

  toValue(): MathValue {
    if (!this.shape.length) return this.values[0]!;
    let layer: readonly MathValue[] = this.values;
    // Build from the innermost axis without recursion, even for many singleton axes.
    for (let axis = this.shape.length - 1; axis > 0; axis--) {
      const width = this.shape[axis]!;
      layer = Array.from({ length: layer.length / width }, (_, i) =>
        Object.freeze(layer.slice(i * width, (i + 1) * width)),
      );
    }
    return Object.freeze(layer);
  }
}
