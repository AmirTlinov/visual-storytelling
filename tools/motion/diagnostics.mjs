export const escapeText = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const number = (v) => Number(v ?? 0).toFixed(1);
export function orderedInsights(report) {
  const from = report.frames[0].time,
    to = report.frames.at(-1).time;
  const inside = (item) => Number.isFinite(item.time) && item.time >= from && item.time <= to;
  return [...(report.runtime?.insights ?? []), ...(report.timeline?.signals ?? [])].sort(
    (a, b) => Number(inside(b)) - Number(inside(a)),
  );
}
function graph(points, key, title, markers = []) {
  if (points.length < 2) return '';
  const start = points[0].time,
    end = points.at(-1).time;
  const min = Math.min(0, ...points.map((p) => p[key] ?? 0));
  const max = Math.max(0.0001, ...points.map((p) => p[key] ?? 0));
  const x = (t) => 20 + (560 * (t - start)) / (end - start || 1);
  const y = (v) => 90 - (65 * (v - min)) / (max - min);
  const path = points
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(2)},${y(p[key] ?? 0).toFixed(2)}`)
    .join(' ');
  const timeTicks = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => {
      const t = start + (end - start) * fraction;
      return `<line x1="${x(t)}" x2="${x(t)}" y1="92" y2="98" stroke="#bbb"/><text x="${x(t)}" y="113" text-anchor="${fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}" font-size="11">${t.toFixed(2)} с</text>`;
    })
    .join('');
  const ticks = markers
    .map((time, i) =>
      time >= start && time <= end
        ? `<line x1="${x(time)}" x2="${x(time)}" y1="18" y2="92" stroke="#b85516" stroke-dasharray="3 3"/><text x="${x(time) + 3}" y="15" font-size="10">click ${i + 1}</text>`
        : '',
    )
    .join('');
  return `<figure><h3>${escapeText(title)}</h3><svg viewBox="0 0 600 146"><line x1="20" x2="580" y1="${y(0)}" y2="${y(0)}" stroke="#ccc"/>${ticks}<path d="${path}" fill="none" stroke="#367a74" stroke-width="2"/>${timeTicks}<text x="20" y="137" font-size="12">min ${number(min)}</text><text x="580" y="137" text-anchor="end" font-size="12">max ${number(max)}</text></svg></figure>`;
}
export function diagnosticsMarkup(report) {
  const { timeline, runtime, comparison } = report;
  const insights = orderedInsights(report);
  return `<style>.motion-observations{padding:12px 16px;background:#f0f4f0;border-left:3px solid #478879;margin:14px 0}.motion-observations ul{margin:8px 0;padding-left:20px}.motion-overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.motion-overview img{width:100%;height:95px;object-fit:contain;background:#e8e8e8}.motion-pair{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.motion-pair img{width:100%;height:130px;object-fit:contain}.motion-sheet details{margin:12px 0}.motion-sheet button{padding:6px 12px}.motion-playback{width:100%;max-height:600px;object-fit:contain;background:#e8e8e8}</style>
  ${timeline ? `<div class="motion-observations"><b>Запись в отчёте: ${timeline.from.toFixed(3)}–${timeline.to.toFixed(3)} с · ${timeline.frames} снимков</b><p>Ниже выбран подробный фрагмент. Обзор и временная шкала охватывают сохранённые кадры.</p>${report.source.sparse ? '<p>Метки CDP относятся к захвату. Синхронизация пикселей и DOM не подтверждена; погрешность времени показа неизвестна. Скорость DOM и интервалы захвата показаны отдельно.</p>' : ''}</div>` : ''}
  ${
    insights.length
      ? `<div class="motion-observations"><b>Моменты для просмотра · сначала выбранное окно</b><ul>${insights
          .slice(0, 5)
          .map(
            (item) =>
              `<li>${Number.isFinite(item.time) ? `${item.time.toFixed(3)} с · ` : ''}${Number.isFinite(item.time) && (item.time < report.frames[0].time || item.time > report.frames.at(-1).time) ? '[вне выбранного окна] ' : ''}${escapeText(item.kind)}${item.evidence ? ` (${escapeText(item.evidence)})` : ''}${item.target ? ` · ${escapeText(item.target)}` : ''}: ${escapeText(item.detail)}</li>`,
          )
          .join(
            '',
          )}</ul>${insights.length > 5 ? `<p>Всего ${insights.length}; остальные — в motion.json.</p>` : ''}</div>`
      : ''
  }
  ${runtime?.warning ? `<p>${escapeText(runtime.warning)}</p>` : ''}
  ${runtime ? `<p>Основной поток браузера: интервал rAF p95 ${number(runtime.mainThreadIntervalMs.p95)} мс, максимум ${number(runtime.mainThreadIntervalMs.max)} мс; длительных кадров ${runtime.longFrameCount}; ${runtime.maxInteractionMs === null ? 'нет взаимодействий, измеренных Event Timing' : `максимальная длительность измеренного взаимодействия ${number(runtime.maxInteractionMs)} мс`}. Это наблюдения браузера, отдельные от кадров записи.</p>` : ''}
  ${runtime?.clickIntervalsMs?.length ? `<p>Фактические интервалы click: ${runtime.clickIntervalsMs.map(number).join(', ')} мс. Пауза wait отсчитывается между шагами; ожидание готовности элемента добавляется отдельно.</p>` : ''}
  <div class="motion-panels">${timeline ? graph(timeline.intervals, 'changedPercent', 'Изменения на всей записи, % уменьшенного кадра') : ''}${
    runtime?.trajectories
      .slice(0, 2)
      .map((track) => {
        const axis =
          Math.max(...track.points.map((p) => Math.abs(p.dx))) >=
          Math.max(...track.points.map((p) => Math.abs(p.dy)))
            ? 'X'
            : 'Y';
        return graph(
          track.points,
          axis.toLowerCase(),
          `${track.selector} · позиция центра ${axis}, CSS px (DOM)`,
          runtime.clickTimes,
        );
      })
      .join('') ?? ''
  }</div>
  ${report.overview ? `<h3>Обзор всей записи · выбранные состояния</h3><div class="motion-overview">${report.overview.frames.map((frame) => `<figure><img src="${frame.image}" alt="Обзор ${frame.time.toFixed(3)} секунд"><figcaption>${frame.time.toFixed(3)} с</figcaption></figure>`).join('')}</div>` : ''}
  ${report.loop ? `<details open><summary>Стык: изменение ${report.loop.changedPercent.toFixed(2)}% пикселей</summary><p>Сопоставление последнего и первого состояний. Направление и скорость на стыке проверяются по соседним кадрам через границу цикла.</p><div class="motion-pair">${report.loop.images.map((src, i) => `<figure><img src="${src}" alt="${i ? 'Начало' : 'Конец'}"><figcaption>${i ? 'Начало' : 'Конец'}</figcaption></figure>`).join('')}</div></details>` : ''}
  ${
    comparison
      ? `<details open><summary>Сравнение с предыдущей проверкой</summary>${comparison.notes?.map((note) => `<p>${escapeText(note)}</p>`).join('') ?? ''}${
          comparison.warning
            ? `<p>${escapeText(comparison.warning)}</p>`
            : comparison.pairs
                .map(
                  (pair) =>
                    `<p>${pair.action ? `От click ${pair.action}` : 'От начала'} ${pair.relativeTime.toFixed(3)} с · изменилось ${pair.changedPercent.toFixed(2)}% · расстояние меток захвата ${number(pair.timestampDistanceMs)} мс</p><div class="motion-pair">${[
                      ['Раньше', pair.baselineImage],
                      ['Сейчас', pair.currentImage],
                      ['Разность', pair.difference],
                    ]
                      .map(
                        ([label, src]) =>
                          `<figure><img src="${src}" alt="${label}"><figcaption>${label}</figcaption></figure>`,
                      )
                      .join('')}</div>`,
                )
                .join('')
        }</details>`
      : ''
  }`;
}

export function playbackMarkup(frames) {
  if (!frames?.length) return '';
  const data = JSON.stringify(frames).replace(/</g, '\\u003c');
  return `<details class="motion-play"><summary>Воспроизвести сохранённые кадры</summary><img class="motion-playback" alt="Запись"><p><button type="button">Воспроизвести</button> <input aria-label="Время записи" type="range" min="${frames[0].time}" max="${frames.at(-1).time}" step="any" value="${frames[0].time}"> <output></output></p></details><script>(()=>{const root=document.querySelector('.motion-play'),frames=${data},image=root.querySelector('img'),slider=root.querySelector('input'),button=root.querySelector('button'),output=root.querySelector('output');let playing=false,started=0,base=0;function show(t){let i=frames.findLastIndex(f=>f.time<=t+1e-9);image.src=frames[Math.max(0,i)].image;slider.value=t;output.textContent=Number(t).toFixed(3)+' с';}function tick(now){if(!playing)return;const t=Math.min(Number(slider.max),base+(now-started)/1000);show(t);if(t>=Number(slider.max)){playing=false;button.textContent='Воспроизвести';}else requestAnimationFrame(tick);}button.onclick=()=>{playing=!playing;button.textContent=playing?'Пауза':'Воспроизвести';if(playing){base=Number(slider.value);if(base>=Number(slider.max))base=Number(slider.min);started=performance.now();requestAnimationFrame(tick);}};slider.oninput=()=>{playing=false;button.textContent='Воспроизвести';show(Number(slider.value));};root.ontoggle=()=>{if(!root.open){playing=false;button.textContent='Воспроизвести';}};show(frames[0].time);})();</script>`;
}
