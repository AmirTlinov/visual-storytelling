import { escapeText, graph } from './diagnostics.mjs';

const fixed = (value, digits = 1) => Number(value).toFixed(digits);
const ticks = (from, to, y = 190) =>
  [0, 0.25, 0.5, 0.75, 1]
    .map(
      (t) =>
        `<text x="${50 + t * 530}" y="${y}" text-anchor="${t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}" font-size="11">${fixed(from + t * (to - from), 2)} с</text>`,
    )
    .join('');

function kymographMarkup(photo) {
  const k = photo.kymograph;
  return `<figure><h3>Кимограмма · время →, координата ${k.axis.toUpperCase()} ↓</h3>
  <svg viewBox="0 0 600 202" role="img" aria-label="Кимограмма движения">
  <image href="${k.image}" x="50" y="10" width="530" height="158" preserveAspectRatio="none"/>
  <text x="45" y="20" text-anchor="end" font-size="11">${fixed(k.from, 0)}</text>
  <text x="45" y="168" text-anchor="end" font-size="11">${fixed(k.to, 0)} px</text>${ticks(photo.from, photo.to)}
  </svg><figcaption>Центр полосы ${k.axis === 'x' ? 'y' : 'x'}=${fixed(k.position)} px, толщина ${fixed(k.thickness)} px${k.automatic ? ' · выбрана по изменениям яркости' : ''}.${k.gapColumns ? ' Фиолетовая штриховка — участки без кадров.' : ''}</figcaption></figure>`;
}

function regionMarkup(photo, frame) {
  const { roi, regions, kymograph: k } = photo;
  const cells = [];
  for (let r = 0; r < 12; r++) {
    const x = ((r % 4) * roi.width) / 4,
      y = (Math.floor(r / 4) * roi.height) / 3;
    cells.push(
      `<rect x="${x}" y="${y}" width="${roi.width / 4}" height="${roi.height / 3}" fill="none" stroke="#285e9c" stroke-width="${roi.width / 280}"/><text x="${x + roi.width / 8}" y="${y + roi.height / 6}" text-anchor="middle" dominant-baseline="middle" style="fill:white" stroke="#173751" stroke-width="${roi.width / 500}" paint-order="stroke" font-size="${roi.width / 20}">${r + 1}</text>`,
    );
  }
  const line =
    k.axis === 'x'
      ? `<line x1="0" x2="${roi.width}" y1="${k.position - roi.y}" y2="${k.position - roi.y}"/>`
      : `<line y1="0" y2="${roi.height}" x1="${k.position - roi.x}" x2="${k.position - roi.x}"/>`;
  return `<figure class="photo-regions"><h3>Область × время · изменение яркости к первому кадру</h3>
  <div class="photo-region-layout"><svg viewBox="0 0 ${roi.width} ${roi.height}" role="img" aria-label="Номера областей и полоса кимограммы"><image href="${frame.image}" width="${roi.width}" height="${roi.height}"/>${cells.join('')}<g stroke="#ef8c26" stroke-width="${roi.width / 160}">${line}</g></svg>
  <svg viewBox="0 0 600 202" role="img" aria-label="Яркость двенадцати областей во времени">
  <image href="${regions.image}" x="50" y="10" width="530" height="158" preserveAspectRatio="none" style="image-rendering:pixelated"/>
  ${Array.from({ length: 12 }, (_, r) => `<text x="43" y="${20 + (r * 158) / 12}" font-size="10" text-anchor="end">${r + 1}</text>`).join('')}${ticks(photo.from, photo.to)}
  </svg></div><figcaption>Синий — темнее, красный — светлее; шкала ±${fixed(regions.deltaRange, 2)} п. п. Y.${k.gapColumns || regions.empty.length ? ' Фиолетовая штриховка — нет данных.' : ''} Оранжевая линия — полоса кимограммы. Мелкую деталь выделяй через <code>--crop</code>.</figcaption></figure>`;
}

function spectrumMarkup(spectrum) {
  if (spectrum.status !== 'available')
    return `<p class="photo-note">Спектрограмма: ${escapeText(spectrum.reason)}</p>`;
  const maximum = Math.max(...spectrum.power.flat());
  const width = 530 / spectrum.times.length,
    height = 150 / spectrum.frequencies.length;
  const halfHop = spectrum.hopSamples / spectrum.sampleRateHz / 2;
  const from = spectrum.times[0] - halfHop,
    to = spectrum.times.at(-1) + halfHop;
  const frequencyY = (frequency) =>
    10 + ((spectrum.nyquistHz + spectrum.binSpacingHz / 2 - frequency) / spectrum.nyquistHz) * 150;
  const frequencyTicks = [
    ...new Set([
      spectrum.nyquistHz,
      spectrum.nyquistHz / 2,
      spectrum.frequencyHz,
      spectrum.binSpacingHz,
    ]),
  ]
    .sort((a, b) => b - a)
    .filter((f, i, values) => i === 0 || Math.abs(frequencyY(f) - frequencyY(values[i - 1])) > 11)
    .map(
      (f) =>
        `<text x="45" y="${frequencyY(f) + 4}" text-anchor="end" font-size="11">${fixed(f)} Гц</text>`,
    )
    .join('');
  const rects = spectrum.power
    .flatMap((column, x) =>
      column.map((power, y) => {
        const db = Math.max(-50, 10 * Math.log10(Math.max(1e-12, power / maximum)));
        const p = (db + 50) / 50;
        const color = `rgb(${Math.round(20 + 225 * p)},${Math.round(36 + 146 * p)},${Math.round(65 + 40 * p)})`;
        return `<rect x="${50 + x * width}" y="${10 + (column.length - y - 1) * height}" width="${width + 0.1}" height="${height + 0.1}" fill="${color}"><title>${fixed(spectrum.times[x], 2)} с, ${fixed(spectrum.frequencies[y], 2)} Гц: ${fixed(db)} dB</title></rect>`;
      }),
    )
    .join('');
  return `<figure class="photo-spectrum"><h3>Спектрограмма яркости · ${escapeText(spectrum.region)}</h3><svg viewBox="0 0 600 202" role="img" aria-label="Спектрограмма яркости">${rects}${frequencyTicks}${ticks(from, to)}</svg><figcaption>Кандидат ${fixed(spectrum.frequencyHz, 2)} Гц · шаг частот ${fixed(spectrum.binSpacingHz, 2)} Гц · окно Hann ${fixed(spectrum.windowSeconds, 2)} с. Цвет: −50…0 dB относительно максимума.</figcaption><p class="photo-note">${escapeText(spectrum.note)}</p></figure>`;
}

export function photometryMarkup(report) {
  const photo = report.photometry;
  if (!photo) return '';
  if (photo.status !== 'available')
    return `<p>Яркость и кимограмма: ${escapeText(photo.reason)}</p>`;
  const intervals = photo.points
    .slice(1)
    .map((p, i) => p.time - photo.points[i].time)
    .sort((a, b) => a - b);
  const options = { maxGap: intervals[Math.floor((intervals.length - 1) / 2)] * 1.5 };
  const neutral = photo.points.every(
    (p) => Math.abs(p.red - p.green) < 1e-6 && Math.abs(p.red - p.blue) < 1e-6,
  );
  const rgb = neutral
    ? [{ key: 'red', label: 'R=G=B', color: '#6b7377' }]
    : [
        { key: 'red', label: 'R', color: '#b84b39' },
        { key: 'green', label: 'G', color: '#35816b' },
        { key: 'blue', label: 'B', color: '#346fa7' },
      ];
  const saturation = [
    { key: 'saturation', label: 'S', color: '#9364a1' },
    { key: 'alpha', label: 'α', color: '#6f7c87' },
  ];
  const range = (key) => photo.ranges[key].map((v) => fixed(v, 2)).join('–');
  const colorCaption = neutral
    ? `R=G=B: ${range('red')}`
    : `R: ${range('red')} · G: ${range('green')} · B: ${range('blue')}`;
  return `<section class="motion-photometry"><style>.motion-photometry{border-top:1px solid #ccd5d4;margin:18px 0;padding:16px;background:#fbfaf6}.motion-photometry figcaption,.photo-note{font-size:12px;line-height:1.45;color:#50646d}.photo-region-layout{display:grid;grid-template-columns:minmax(90px,1fr) minmax(0,3fr);gap:12px;align-items:center}.photo-region-layout svg{width:100%;max-height:180px}.photo-regions{margin:10px 0}.photo-spectrum{max-width:900px}</style>
  <h3>Яркость и цвет во времени · кадров: ${photo.points.length}</h3>
  <p class="photo-note">Фиксированная область (${photo.roi.x}, ${photo.roi.y}, ${photo.roi.width}×${photo.roi.height} px), анализ ${photo.raster.width}×${photo.raster.height}. Y — относительная яркость linear sRGB; прозрачность наложена на ${photo.background === 'white' ? 'белый' : 'чёрный'} фон. Изменения области могут быть вызваны движением объекта и сменой фона.</p>
  <div class="motion-panels">${graph(photo.points, 'luminance', 'Яркость Y, % · масштаб по данным', [], { ...options, zero: false })}${graph(photo.points, rgb, 'Средний цвет sRGB, 0–255', [], { ...options, min: 0, max: 255, caption: colorCaption })}${graph(photo.points, saturation, 'Насыщенность среднего цвета S и альфа α, %', [], { ...options, min: 0, max: 100, caption: `S: ${range('saturation')}% · α: ${range('alpha')}%` })}${kymographMarkup(photo)}</div>
  ${regionMarkup(photo, photo.reference)}${spectrumMarkup(photo.spectrum)}</section>`;
}
