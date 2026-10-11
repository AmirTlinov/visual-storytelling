/** One view-only SVG and source-time geometry shared by report HTML and rendered images. */
export function temporalChart(
  changes,
  { from, to, width = 960, height = 128, at, frames = [] } = {},
) {
  const number = (value) => Number(value.toFixed(3));
  const finite = (value) => Number.isFinite(value);
  if (!finite(width) || !finite(height) || width < 80 || height < 64)
    throw new Error('Temporal chart needs finite dimensions of at least 80 × 64');
  const data = changes
    .map((change) => ({
      ...change,
      startTime: change.startTime ?? change.time - change.dtMs / 1000,
      endTime: change.endTime ?? change.time,
    }))
    .filter((change) => [change.startTime, change.endTime, change.meanDelta].every(finite));
  const times = [
    ...data.flatMap((change) => [change.startTime, change.endTime]),
    ...frames.map((frame) => frame.time).filter(finite),
  ];
  from = finite(from) ? from : times.reduce((min, time) => Math.min(min, time), Infinity);
  to = finite(to) ? to : times.reduce((max, time) => Math.max(max, time), -Infinity);
  if (!finite(from)) from = 0;
  if (!finite(to)) to = from;
  if (to < from) throw new Error('Temporal chart end must not precede its start');
  const plot = { x: 42, y: 14, width: width - 54, height: height - 42 };
  const span = to - from;
  const x = (time) => plot.x + (span ? (time - from) / span : 0) * plot.width;
  const visible = data.filter((change) => change.endTime >= from && change.startTime <= to);
  const percent = (change) => Math.max(0, Math.min(100, (change.meanDelta / 255) * 100));
  const peak = visible.reduce((max, change) => Math.max(max, percent(change)), 0.1);
  const power = 10 ** Math.floor(Math.log10(peak));
  const ceiling = [1, 2, 5, 10].find((value) => value * power >= peak) * power;
  const y = (value) => plot.y + plot.height * (1 - value / ceiling);
  const bounded = (time) => Math.max(from, Math.min(to, time));
  const tickCount = width >= 600 ? 5 : 3;
  const ticks = Array.from({ length: tickCount }, (_, i) => from + (span * i) / (tickCount - 1));
  // A measurement belongs to its actual captured interval, ending at the next frame.
  const points = visible.flatMap((change, i) => [
    ...(i ? [] : [`${number(x(bounded(change.startTime)))},${number(y(percent(change)))}`]),
    `${number(x(bounded(change.endTime)))},${number(y(percent(change)))}`,
  ]);
  const candidates = visible
    .filter((change) => change.candidate)
    .map((change) => {
      const left = x(bounded(change.startTime));
      const right = x(bounded(change.endTime));
      return `<rect x="${number(left)}" y="${plot.y}" width="${number(Math.max(0, right - left))}" height="${plot.height}" fill="#21875a" opacity="0.09"/><circle cx="${number(right)}" cy="${number(y(percent(change)))}" r="3" fill="#21875a"/>`;
    })
    .join('');
  const rug = frames
    .filter((frame) => finite(frame.time) && frame.time >= from && frame.time <= to)
    .map(
      (frame) =>
        `<path d="M${number(x(frame.time))} ${plot.y + plot.height}v-3" stroke="#89969d" opacity="0.35"/>`,
    )
    .join('');
  const labels = ticks
    .map((time, i) => {
      const tx = number(x(time));
      const anchor = i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle';
      return `<path d="M${tx} ${plot.y + plot.height}v4" stroke="#89969d"/><text x="${tx}" y="${height - 9}" text-anchor="${anchor}">${number(time)}</text>`;
    })
    .join('');
  const cursor = finite(at)
    ? `<path data-time-cursor="" d="M${number(x(bounded(at)))} ${plot.y}v${plot.height}" stroke="#263a45" stroke-dasharray="3 3"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Image difference over captured time"><rect width="${width}" height="${height}" fill="#fff"/><g font-family="system-ui,sans-serif" font-size="12" fill="#52646d"><text x="4" y="11">delta %</text><text x="36" y="${plot.y + 4}" text-anchor="end">${number(ceiling)}</text><text x="36" y="${plot.y + plot.height + 3}" text-anchor="end">0</text><text x="${width - 2}" y="${height - 9}" text-anchor="end">s</text><path d="M${plot.x} ${plot.y}v${plot.height}h${plot.width}" fill="none" stroke="#dbe2e5"/>${candidates}<polyline points="${points.join(' ')}" fill="none" stroke="#89969d" stroke-width="1.5"/>${rug}${cursor}${labels}</g></svg>`;
  return { svg, plot, range: { from, to }, width, height };
}

export function timeAtChartPoint(view, [x, y]) {
  const finite = (value) => Number.isFinite(value);
  const { plot, range } = view ?? {};
  if (
    !plot ||
    !range ||
    ![plot.x, plot.y, plot.width, plot.height, range.from, range.to].every(finite) ||
    plot.width <= 0 ||
    plot.height <= 0 ||
    range.to < range.from
  )
    throw new Error('Temporal chart metadata needs a finite plot and source-time range');
  if (
    !finite(x) ||
    !finite(y) ||
    x < plot.x ||
    x > plot.x + plot.width ||
    y < plot.y ||
    y > plot.y + plot.height
  )
    throw new Error('Point is outside the temporal chart plot');
  return Math.max(
    range.from,
    Math.min(range.to, range.from + ((x - plot.x) / plot.width) * (range.to - range.from)),
  );
}

/** Each observed change belongs to (start, end]; select its actual after-frame. */
export function transitionTime(changes, time, tolerance = 0) {
  if (!Number.isFinite(time)) throw new Error('Transition time must be finite');
  // A drawn point spans pixels. Snap close clicks to the point itself before choosing a band.
  const ends = (changes ?? [])
    .map((change) => change.endTime ?? change.time)
    .filter(Number.isFinite);
  if (tolerance > 0 && ends.length) {
    const nearest = ends.reduce((best, value) =>
      Math.abs(value - time) < Math.abs(best - time) ? value : best,
    );
    if (Math.abs(nearest - time) <= tolerance) return nearest;
  }
  for (const change of changes ?? []) {
    const end = change.endTime ?? change.time;
    const start = change.startTime ?? end - change.dtMs / 1000;
    if (Number.isFinite(start) && Number.isFinite(end) && time > start && time <= end) return end;
  }
  return time;
}
