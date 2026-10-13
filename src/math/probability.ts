export interface ProbabilityTrace {
  /** null denotes an explicit mask; masked distinguishes it from finite underflow. */
  readonly scores: readonly (number | null)[];
  readonly masked: readonly boolean[];
  /** null denotes a negative infinite scaled difference. */
  readonly shifted: readonly (number | null)[];
  readonly weights: readonly number[];
  readonly probabilities: readonly number[];
  readonly maximum: number;
  readonly totalWeight: number;
  readonly temperature: number;
  readonly totalProbability: number;
}
/** Float64 accumulation; small weights do not vanish merely because a large weight came first. */
function sum(values: readonly number[]) {
  let total = 0,
    correction = 0;
  for (const value of values) {
    const adjusted = value - correction,
      next = total + adjusted;
    correction = next - total - adjusted;
    total = next;
  }
  return total;
}
/** Shift before exponentiation. -Infinity is an explicit masked score, never a missing observation. */
export function normalizeLogits(scores: readonly number[], temperature = 1): ProbabilityTrace {
  if (!Array.isArray(scores) || !scores.length || scores.length > 1_000_000)
    throw new Error('Normalization needs a nonempty score vector.');
  if (!Number.isFinite(temperature) || temperature <= 0)
    throw new Error('Temperature must be finite and positive.');
  let maximum = -Infinity;
  for (const score of scores) {
    if (typeof score !== 'number' || (!Number.isFinite(score) && score !== -Infinity))
      throw new Error('Normalization needs finite scores or explicit -Infinity masks.');
    if (score > maximum) maximum = score;
  }
  if (maximum === -Infinity) throw new Error('Normalization needs an unmasked score.');
  const shifted = scores.map((score) => {
    if (score === -Infinity) return -Infinity;
    const difference = score - maximum;
    // Opposite finite extremes can overflow their subtraction even when scaling is representable.
    return Number.isFinite(difference)
      ? difference / temperature
      : score / temperature - maximum / temperature;
  });
  const weights = shifted.map((value) => Math.exp(value)),
    totalWeight = sum(weights);
  const probabilities = weights.map((value) => value / totalWeight);
  return Object.freeze({
    scores: Object.freeze(scores.map((score) => (score === -Infinity ? null : score))),
    masked: Object.freeze(scores.map((score) => score === -Infinity)),
    shifted: Object.freeze(shifted.map((value) => (Number.isFinite(value) ? value : null))),
    weights: Object.freeze(weights),
    probabilities: Object.freeze(probabilities),
    maximum,
    totalWeight,
    temperature,
    totalProbability: sum(probabilities),
  });
}
/** One-argument signature also supports matrix.map(softmax). */
export function softmax(scores: readonly number[]): number[] {
  return [...normalizeLogits(scores).probabilities];
}
export interface ProbabilityRow {
  readonly indices: readonly number[];
  readonly label: string;
  readonly probability: number;
}
/** Stable descending order; equal probabilities retain the original token order. */
export function rankProbabilities(probabilities: readonly number[]): readonly number[] {
  if (
    !Array.isArray(probabilities) ||
    !probabilities.length ||
    Array.from(probabilities).some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  )
    throw new Error('Rank a nonempty probability vector in [0,1].');
  return Object.freeze(
    probabilities
      .map((_, index) => index)
      .sort((a, b) => probabilities[b]! - probabilities[a]! || a - b),
  );
}
/** Ranking and aggregated tail belong to the numeric owner; drawings only measure these rows. */
export function probabilityRows(
  trace: ProbabilityTrace,
  labels: readonly string[],
  limit = 6,
): readonly ProbabilityRow[] {
  if (
    !Array.isArray(labels) ||
    labels.length !== trace.probabilities.length ||
    Array.from(labels).some((label) => typeof label !== 'string' || !label.trim())
  )
    throw new Error('Every probability needs a label.');
  if (!Number.isInteger(limit) || limit < 2)
    throw new Error('Display at least two distribution rows.');
  const ranking = rankProbabilities(trace.probabilities);
  const selected = ranking.slice(0, labels.length <= limit ? limit : limit - 1);
  const rows: ProbabilityRow[] = selected.map((index) => ({
    indices: [index],
    label: labels[index]!,
    probability: trace.probabilities[index]!,
  }));
  const tail = ranking.slice(selected.length);
  if (tail.length)
    rows.push({
      indices: tail,
      label: 'Остальные',
      probability: sum(tail.map((index) => trace.probabilities[index]!)),
    });
  return Object.freeze(
    rows.map((row) => Object.freeze({ ...row, indices: Object.freeze(row.indices) })),
  );
}
