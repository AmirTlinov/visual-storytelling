export function oscillator(time: number, period: number) {
  if (!(period > 0)) throw new Error('Period must be positive');
  const phase = (2 * Math.PI * time) / period;
  const charge = Math.cos(phase),
    current = Math.sin(phase);
  return { time, period, charge, current, electric: charge * charge, magnetic: current * current };
}
