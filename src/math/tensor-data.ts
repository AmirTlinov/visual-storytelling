/** Logical coordinates survive changes of layout, slicing and projection. */
export class TensorData {
  readonly shape: readonly number[];
  readonly values: readonly number[];
  readonly axes: readonly string[];
  constructor(shape: readonly number[], values: readonly number[], axes: readonly string[] = []) {
    if (
      shape.some((n) => !Number.isInteger(n) || n < 1) ||
      shape.reduce((a, b) => a * b, 1) !== values.length
    )
      throw new Error('Tensor shape must match its values');
    if (values.some((n) => !Number.isFinite(n))) throw new Error('Tensor values must be finite');
    if (axes.length && axes.length !== shape.length) throw new Error('Name every tensor axis');
    this.shape = Object.freeze([...shape]);
    this.values = Object.freeze([...values]);
    this.axes = Object.freeze(axes.length ? [...axes] : shape.map((_, i) => `ось ${i + 1}`));
  }
  offset(indices: readonly number[]) {
    if (
      indices.length !== this.shape.length ||
      indices.some((n, i) => !Number.isInteger(n) || n < 0 || n >= this.shape[i]!)
    )
      throw new Error('Tensor coordinate outside its shape');
    return indices.reduce((offset, n, i) => offset * this.shape[i]! + n, 0);
  }
  indices(offset: number) {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.values.length)
      throw new Error('Tensor offset outside its shape');
    const result = this.shape.map(() => 0);
    for (let i = this.shape.length - 1; i >= 0; i--) {
      result[i] = offset % this.shape[i]!;
      offset = Math.floor(offset / this.shape[i]!);
    }
    return result;
  }
  at(...indices: number[]) {
    return this.values[this.offset(indices)]!;
  }
  slice(axis: number, index: number) {
    if (
      !Number.isInteger(axis) ||
      axis < 0 ||
      axis >= this.shape.length ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.shape[axis]!
    )
      throw new Error('Invalid tensor slice');
    return new TensorData(
      this.shape.filter((_, i) => i !== axis),
      this.values.filter((_, i) => this.indices(i)[axis] === index),
      this.axes.filter((_, i) => i !== axis),
    );
  }
  transpose(order: readonly number[]) {
    if (
      order.length !== this.shape.length ||
      new Set(order).size !== order.length ||
      order.some((i) => !Number.isInteger(i) || i < 0 || i >= order.length)
    )
      throw new Error('Transpose needs a permutation of the axes');
    const shape = order.map((i) => this.shape[i]!),
      template = new TensorData(
        shape,
        this.values,
        order.map((i) => this.axes[i]!),
      );
    return new TensorData(
      shape,
      template.values.map((_, i) => {
        const mapped = template.indices(i),
          original = this.shape.map(() => 0);
        order.forEach((axis, j) => (original[axis] = mapped[j]!));
        return this.at(...original);
      }),
      template.axes,
    );
  }
  reshape(shape: readonly number[], axes: readonly string[] = []) {
    return new TensorData(shape, this.values, axes);
  }
}
export function formatNumber(value: number) {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  const text =
    magnitude < 0.0001 || magnitude >= 1e6
      ? value.toExponential(5)
      : Number(value.toPrecision(6)).toString();
  const approximate = Math.abs(value - Number(text)) > magnitude * 1e-12;
  return `${approximate ? '≈ ' : ''}${text.replace('-', '−')}`;
}
