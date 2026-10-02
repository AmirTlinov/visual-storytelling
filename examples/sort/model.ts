export interface Item {
  id: string;
  value: number;
}
export interface Comparison {
  order: Item[];
  index: number;
  exchange: boolean;
  settled: number;
  pass: number;
  comparisons: number;
  swapsBefore: number;
}
export function comparisons(values: readonly number[]) {
  const order = values.map((value, i) => ({ id: `item-${i}`, value }));
  const result: Comparison[] = [];
  let swaps = 0;
  for (let last = order.length - 1; last > 0; last--) {
    let changed = false;
    for (let index = 0; index < last; index++) {
      const exchange = order[index]!.value > order[index + 1]!.value;
      result.push({
        order: [...order],
        index,
        exchange,
        settled: order.length - 1 - last,
        pass: order.length - last,
        comparisons: result.length + 1,
        swapsBefore: swaps,
      });
      if (exchange) {
        [order[index], order[index + 1]] = [order[index + 1]!, order[index]!];
        changed = true;
        swaps++;
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
      ? Number(time % 3 >= 2.3)
      : Math.max(0, Math.min(1, ((time % 3) - 1.1) / 1.2));
  return {
    ...step,
    index: step.index,
    step: index,
    progress,
    done,
    order: done ? sequence.result : step.order,
    swaps: step.swapsBefore + Number(step.exchange && progress === 1),
    returning: !done && time % 3 >= 2.4 && sequence.steps[index + 1]?.pass !== step.pass,
  };
}
