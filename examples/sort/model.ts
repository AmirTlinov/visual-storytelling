export interface Item {
  id: string;
  value: number;
}
export interface Comparison {
  order: Item[];
  index: number;
  exchange: boolean;
  settled: number;
}
export function comparisons(values: readonly number[]) {
  const order = values.map((value, i) => ({ id: `item-${i}`, value }));
  const result: Comparison[] = [];
  for (let last = order.length - 1; last > 0; last--) {
    let changed = false;
    for (let index = 0; index < last; index++) {
      const exchange = order[index]!.value > order[index + 1]!.value;
      result.push({ order: [...order], index, exchange, settled: order.length - 1 - last });
      if (exchange) {
        [order[index], order[index + 1]] = [order[index + 1]!, order[index]!];
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { steps: result, result: order };
}
export function sortingAt(sequence: ReturnType<typeof comparisons>, time: number, reduced = false) {
  const index = Math.min(sequence.steps.length - 1, Math.max(0, Math.floor(time / 3)));
  const step = sequence.steps[index]!;
  const done = time >= sequence.steps.length * 3;
  const progress = done
    ? 1
    : reduced
      ? Number(time % 3 >= 1.1)
      : Math.max(0, Math.min(1, ((time % 3) - 1.1) / 1.2));
  return {
    ...step,
    index: step.index,
    step: index,
    progress,
    done,
    order: done ? sequence.result : step.order,
  };
}
