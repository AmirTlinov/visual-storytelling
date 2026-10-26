/** Two-sided 95% Wilson score interval, without continuity correction. */
export function wilsonInterval(successes: number, count: number) {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isSafeInteger(successes) ||
    successes < 0 ||
    successes > count
  )
    throw new Error('A binomial interval needs integer successes in [0, count], count > 0.');
  const z = 1.959963984540054,
    squared = z * z,
    estimate = successes / count;
  const denominator = 1 + squared / count,
    center = (estimate + squared / (2 * count)) / denominator;
  const radius =
    (z * Math.sqrt((estimate * (1 - estimate)) / count + squared / (4 * count * count))) /
    denominator;
  return Object.freeze({
    low: successes === 0 ? 0 : Math.max(0, center - radius),
    high: successes === count ? 1 : Math.min(1, center + radius),
    confidence: 0.95,
    method: 'wilson' as const,
  });
}
/** Synthetic Bernoulli draws. The disclosed uint32 LCG is deterministic, including seed 0. */
export function sampleBernoulli(probability: number, count: number, seed: number) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1)
    throw new Error('Bernoulli probability must be in [0, 1].');
  if (!Number.isSafeInteger(count) || count < 1 || count > 1_000_000)
    throw new Error('Sample count must be an integer in [1, 1000000].');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('Seed must be a uint32 integer.');
  let state = seed,
    successes = 0;
  const draws = Array.from({ length: count }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = state / 0x100000000,
      success = value < probability;
    if (success) successes++;
    return Object.freeze({ index, value, success, successes, estimate: successes / (index + 1) });
  });
  return Object.freeze({
    probability,
    count,
    seed,
    generator: 'lcg32-1664525-1013904223' as const,
    draws: Object.freeze(draws),
    successes,
    estimate: successes / count,
    interval: wilsonInterval(successes, count),
  });
}

/** Missing observations have no estimate or interval; zero successes are a different state. */
export function binomialPrefix(sample: ReturnType<typeof sampleBernoulli>, count: number) {
  if (!Number.isInteger(count) || count < 0 || count > sample.count)
    throw new Error('Prefix count must be in the generated sample.');
  const last = sample.draws[count - 1],
    successes = last?.successes ?? 0;
  return Object.freeze({
    count,
    successes,
    estimate: count ? successes / count : null,
    interval: count ? wilsonInterval(successes, count) : null,
    draws: Object.freeze(sample.draws.slice(0, count)),
  });
}
