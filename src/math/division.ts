/** Integer division keeps its numerical result independent of a drawing's capacity. */
export interface DivisionState {
  readonly id: string;
  readonly count: number;
  readonly divisor: number;
  readonly quotient: number;
  readonly remainder: number;
}

export function divisionState(
  count: number,
  divisor: number,
  { id = 'division' }: { id?: string } = {},
): DivisionState {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error('Division count must be a non-negative safe integer');
  if (!Number.isSafeInteger(divisor) || divisor < 1)
    throw new Error('Division divisor must be a positive safe integer');
  if (typeof id !== 'string' || !id.trim()) throw new Error('Division needs a non-empty stable ID');
  const n = BigInt(count),
    d = BigInt(divisor);
  return Object.freeze({
    id,
    count,
    divisor,
    quotient: Number(n / d),
    remainder: Number(n % d),
  });
}

export function divisionItemId(state: DivisionState, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.count)
    throw new Error('Division item index is outside its collection');
  return `${state.id}:item:${index}`;
}

export function divisionGroupId(state: DivisionState, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.quotient)
    throw new Error('Division group index is outside its collection');
  return `${state.id}:group:${state.divisor}:${index}`;
}

/** Moving items remain ungrouped until the last item reaches its complete group. */
export function divisionProgress(state: DivisionState, progress: number) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1)
    throw new Error('Division progress must be between zero and one');
  const completedGroups = progress === 1 ? state.quotient : Math.floor(progress * state.quotient);
  return {
    completedGroups,
    ungrouped: state.count - completedGroups * state.divisor,
    complete: progress === 1,
    groupProgress: progress === 1 ? 1 : progress * state.quotient - completedGroups,
  };
}
