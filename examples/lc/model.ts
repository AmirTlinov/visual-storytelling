export function oscillator(time: number, period: number) {
  if (!(period > 0) || !Number.isFinite(period) || !Number.isFinite(time))
    throw new Error('Finite time and positive period required');
  const phase = (2 * Math.PI * time) / period;
  const charge = Math.cos(phase),
    current = Math.sin(phase);
  return { time, period, charge, current, electric: charge * charge, magnetic: current * current };
}
export type OscillatorState = ReturnType<typeof oscillator>;
