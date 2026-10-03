/** Ordering for the overview and CLI. The report retains every raw observation. */
export function orderedInsights(report) {
  const from = report.frames[0].time,
    to = report.frames.at(-1).time;
  const inside = (item) => Number.isFinite(item.time) && item.time >= from && item.time <= to;
  let signals = report.timeline?.signals ?? [];
  const returns = signals.filter((item) => item.kind === 'brief-reversal');
  if (returns.length > 3)
    signals = [
      ...signals.filter((item) => item.kind !== 'brief-reversal'),
      {
        ...(returns.find(inside) ?? returns[0]),
        kind: 'repeated-appearance-return',
        count: returns.length,
        detail: `Appearance changes and returns ${returns.length} times across the recording. This can be an intended pulse; inspect the brightness graph and frames. Individual times remain in motion.json.`,
      },
    ];
  return [...(report.runtime?.insights ?? []), ...signals].sort(
    (a, b) =>
      Number(b.kind === 'action-error') - Number(a.kind === 'action-error') ||
      Number(inside(b)) - Number(inside(a)),
  );
}

const labels = {
  'action-error': ['Сценарий прервался', 'runtime', 100],
  'page-error': ['Ошибка страницы', 'runtime', 95],
  'target-not-observed': ['Элемент не наблюдался', 'runtime', 90],
  'brief-disappearance': ['Элемент исчезает и возвращается', 'runtime', 85],
  'long-animation-frame': ['Долгий кадр основного потока', 'runtime', 80],
  'content-clipped': ['Содержимое обрезается', 'runtime', 65],
  'outside-viewport': ['Элемент выходит за окно', 'runtime', 65],
  'brief-reversal': ['Изображение меняется и возвращается', 'frames', 60],
  'repeated-appearance-return': ['Повторяющиеся изменения', 'photometry', 60],
};
export const observationTitle = (kind) => labels[kind]?.[0] ?? kind;

const durationLabels = {
  'long-animation-frame': 'основной поток браузера',
  'brief-disappearance': 'сопоставьте с кадрами записи',
};
const descriptions = {
  'target-not-observed':
    'Траектория элемента не получена. Проверьте селектор и то, достиг ли сценарий нужного состояния.',
  'long-animation-frame': 'Зафиксирован долгий кадр основного потока браузера.',
  'brief-disappearance':
    'Элемент становится невидимым по наблюдениям DOM и возвращается. Сопоставьте с кадрами записи.',
  'content-clipped': 'Содержимое выходит за границы контейнера с overflow: hidden или clip.',
  'outside-viewport': 'Элемент выходит за границы окна. Сопоставьте обрезку с замыслом интерфейса.',
  'brief-reversal':
    'Изображение изменилось и вернулось за два интервала захвата. Сопоставьте кадры: возможна вспышка или задуманная пульсация.',
  'repeated-appearance-return':
    'Изображение неоднократно меняется и возвращается. Сопоставьте отдельные моменты с кадрами: возможны вспышки и задуманные пульсации.',
};

export function observationDetail(item) {
  const durations =
    item.durationRange ??
    (Number.isFinite(item.durationMs) ? [item.durationMs, item.durationMs] : undefined);
  if (durationLabels[item.kind] && durations) {
    const [min, max] = durations.map((value) => value.toFixed(1));
    return `${min === max ? min : `${min}–${max}`} мс · ${durationLabels[item.kind]}`;
  }
  return descriptions[item.kind] ?? item.detail ?? '';
}

const compact = (text) => {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length > 200 ? `${value.slice(0, 199).trimEnd()}…` : value;
};

export function reviewFocus(report) {
  const items = [],
    groups = new Map();
  for (const signal of orderedInsights(report)) {
    const key = `${signal.kind}\n${signal.target ?? ''}`;
    const duration =
      durationLabels[signal.kind] && Number.isFinite(signal.durationMs)
        ? signal.durationMs
        : undefined;
    if (groups.has(key)) {
      const item = groups.get(key);
      item.count += signal.count ?? 1;
      if (duration !== undefined)
        item.durationRange = [
          Math.min(item.durationRange?.[0] ?? duration, duration),
          Math.max(item.durationRange?.[1] ?? duration, duration),
        ];
      continue;
    }
    const [title, view, rank] = labels[signal.kind] ?? [signal.kind, 'runtime', 50];
    const item = {
      kind: signal.kind,
      title,
      view: view === 'photometry' && report.photometry?.status !== 'available' ? 'frames' : view,
      rank,
      count: signal.count ?? 1,
      ...(Number.isFinite(signal.time) ? { time: signal.time } : {}),
      ...(signal.target ? { target: signal.target } : {}),
      evidence: signal.evidence ?? (view === 'runtime' ? 'Браузер' : 'Пиксели'),
      detail: compact(observationDetail(signal)),
      ...(duration !== undefined ? { durationRange: [duration, duration] } : {}),
    };
    groups.set(key, item);
    items.push(item);
  }
  for (const item of items) if (item.durationRange) item.detail = observationDetail(item);
  const photo = report.photometry;
  if (photo?.spectrum?.status === 'available') {
    // Regional periodicity does not explain away separate whole-frame flashes.
    const spectrum = photo.spectrum;
    items.push({
      kind: 'brightness-periodicity',
      title: `≈${Number(spectrum.frequencyHz.toFixed(2))} Гц · периодичность яркости`,
      detail: `${spectrum.region}; шаг спектра ${spectrum.binSpacingHz.toFixed(2)} Гц. Фиксированная область, возможен вклад движения.`,
      view: 'photometry',
      rank: 75,
      evidence: 'Пиксели',
    });
  }
  for (const [kind, warning] of [
    ['capture-warning', report.source.warning],
    ['runtime-warning', report.runtime?.warning],
  ])
    if (warning)
      items.push({
        kind,
        title: 'Ограничение наблюдения',
        detail: compact(warning),
        view: kind === 'capture-warning' ? 'method' : 'runtime',
        rank: 92,
        evidence: 'Источник',
      });
  if (report.comparison?.warning)
    items.push({
      kind: 'comparison-unavailable',
      title: 'Условия сравнения различаются',
      detail: compact(report.comparison.warning),
      view: 'comparison',
      rank: 88,
      evidence: 'Сравнение',
    });
  if (!report.motionBounds)
    items.push({
      kind: 'unchanged-window',
      title: 'В выбранном окне нет изменений выше порога',
      detail: 'Проверьте время действия и выбранную область.',
      view: 'frames',
      rank: 20,
      evidence: 'Пиксели',
    });
  items.sort((a, b) => b.rank - a.rank);
  return {
    items: items.slice(0, 3).map(({ rank, durationRange, ...item }) => item),
    additionalCount: Math.max(0, items.length - 3),
    detailWindow: {
      from: report.frames[0].time,
      to: report.frames.at(-1).time,
      frames: report.frames.length,
    },
    coverage:
      report.source.kind === 'scene-seek'
        ? 'Время модели: форма перехода. Ритм показа проверяется записью воспроизведения.'
        : report.source.sparse
          ? 'CDP: кадры поступают по изменениям. Синхронизация времени пикселей и DOM не подтверждена.'
          : 'Времена и ритм относятся к исходной записи.',
  };
}
