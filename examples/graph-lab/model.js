export const format = (value) => Number(value.toFixed(2)).toLocaleString('ru');

/** Change the experiment here; the drawing and controls use the same conditions. */
export const trial = { speed: 3, start: 4, seconds: 2, choices: [12, 18, 24] };

/** This uniform-motion model owns every value shown in the plot and explanation. */
export function motion(values) {
  const speed = Number(values.speed),
    time = Number(values.time);
  if (![speed, time].every(Number.isFinite) || speed <= 0 || time < 0)
    throw new Error('Движению нужны положительная скорость и неотрицательное время.');
  const start = Math.max(0, time - (values.practice ? trial.seconds : 3));
  return {
    speed,
    time,
    distance: speed * time,
    interval: { start, seconds: time - start, distance: speed * (time - start) },
    comparison: values.compare ? (speed * time) / 2 : null,
    detail: Boolean(values.detail),
    practice: Boolean(values.practice),
    guess: Number(values.guess),
    checked: Boolean(values.checked),
  };
}
