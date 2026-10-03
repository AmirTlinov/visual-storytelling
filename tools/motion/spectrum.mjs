/** Hann-window STFT of a uniformly sampled brightness signal, in percentage points. */
export function brightnessSpectrum(points, { sparse = false, sizeChanged = false } = {}) {
  const skip = (reason) => ({ status: 'skipped', reason });
  if (sparse)
    return skip(
      'Редкий захват по изменениям изображения: для частот нужен равномерно записанный ролик.',
    );
  if (sizeChanged) return skip('Размер области меняется между кадрами.');
  if (points.length < 64) return skip('Нужно хотя бы 64 кадра и несколько повторений изменения.');
  if (
    points.some(
      (point, i) => !Number.isFinite(point.time) || (i && point.time <= points[i - 1].time),
    )
  )
    return skip('Нужны конечные строго возрастающие временные метки кадров.');
  const duration = points.at(-1).time - points[0].time;
  if (duration < 1) return skip('Запись короче секунды: увеличьте наблюдаемый интервал.');
  const dt = duration / (points.length - 1);
  const jitter =
    Math.max(...points.slice(1).map((p, i) => Math.abs(p.time - points[i].time - dt))) / dt;
  if (jitter > 0.02)
    return skip(
      'Интервалы кадров различаются более чем на 2%; STFT без подмены времён недоступна.',
    );
  const size = 2 ** Math.floor(Math.log2(Math.min(128, points.length / 2)));
  const hop = size / 4,
    bins = size / 2,
    rate = 1 / dt;
  const window = Array.from(
    { length: size },
    (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1)),
  );
  const normalization = window.reduce((a, b) => a + b, 0);
  const cos = [],
    sin = [];
  for (let k = 1; k <= bins; k++) {
    cos.push(window.map((w, n) => w * Math.cos((2 * Math.PI * k * n) / size)));
    sin.push(window.map((w, n) => w * Math.sin((2 * Math.PI * k * n) / size)));
  }
  const channels = [
    { name: 'Вся область', values: points.map((p) => p.luminance) },
    ...(points[0].regions ?? []).map((_, r) => ({
      name: `Область ${r + 1}`,
      values: points.map((p) => p.regions?.[r]),
    })),
  ];
  let best;
  for (const channel of channels) {
    if (!channel.values.every(Number.isFinite)) continue;
    const range = Math.max(...channel.values) - Math.min(...channel.values);
    if (range < 1) continue;
    const columns = [],
      times = [],
      average = new Float64Array(bins);
    for (let start = 0; start + size <= points.length; start += hop) {
      const values = channel.values.slice(start, start + size);
      const center = (size - 1) / 2;
      const mean = values.reduce((a, b) => a + b, 0) / size;
      let numerator = 0,
        denominator = 0;
      values.forEach((value, n) => {
        numerator += (n - center) * (value - mean);
        denominator += (n - center) ** 2;
      });
      const slope = numerator / denominator;
      const detrended = values.map((value, n) => value - mean - slope * (n - center));
      const power = Array.from({ length: bins }, (_, k) => {
        let re = 0,
          im = 0;
        for (let n = 0; n < size; n++) {
          re += detrended[n] * cos[k][n];
          im += detrended[n] * sin[k][n];
        }
        const amplitude = ((k === bins - 1 ? 1 : 2) * Math.hypot(re, im)) / normalization;
        average[k] += amplitude ** 2;
        return amplitude ** 2;
      });
      columns.push(power);
      times.push((points[start].time + points[start + size - 1].time) / 2);
    }
    let peak = 0;
    for (let k = 1; k < bins; k++) if (average[k] > average[peak]) peak = k;
    // A first-bin peak is unresolved; its leakage into bin two is not a new frequency.
    if (peak === 0) continue;
    const total = average.reduce((a, b) => a + b, 0);
    const concentration =
      (average[peak - 1] + average[peak] + (average[peak + 1] ?? 0)) / (total || 1);
    const frequency = ((peak + 1) * rate) / size;
    const persistent =
      columns.filter((column) => {
        const localPeak = column.indexOf(Math.max(...column));
        return Math.abs(localPeak - peak) <= 1 && column[peak] > 0.25;
      }).length / columns.length;
    if (concentration < 0.6 || persistent < 0.6 || frequency * duration < 4) continue;
    const score = (average[peak] / columns.length) * concentration;
    if (!best || score > best.score)
      best = {
        score,
        region: channel.name,
        frequencyHz: frequency,
        concentration,
        persistent,
        times,
        power: columns,
      };
  }
  if (!best)
    return skip('Устойчивого периодического изменения яркости не найдено; графики доступны выше.');
  const { score, ...result } = best;
  return {
    status: 'available',
    ...result,
    sampleRateHz: rate,
    nyquistHz: rate / 2,
    binSpacingHz: rate / size,
    windowSeconds: size * dt,
    windowSamples: size,
    hopSamples: hop,
    frequencies: Array.from({ length: bins }, (_, k) => ((k + 1) * rate) / size),
    note: 'Периодичность яркости фиксированной области может возникать из-за движения. Hann, линейный тренд удалён; частоты относятся к записи.',
  };
}
