import { observationTitle, observationDetail } from './focus.mjs';

export const escapeText = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const number = (v) => Number(v ?? 0).toFixed(1);
export function graph(points, key, title, markers = [], options = {}) {
  if (points.length < 2) return '';
  const series = Array.isArray(key) ? key : [{ key, color: '#367a74' }];
  const start = points[0].time,
    end = points.at(-1).time;
  const values = points.flatMap((p) => series.map((s) => p[s.key] ?? 0));
  const min = options.min ?? Math.min(...(options.zero === false ? values : [0, ...values]));
  const max = Math.max(min + 0.0001, options.max ?? Math.max(...values));
  const tickNumber = (v) => Number(v).toFixed(max - min < 1 ? 3 : 1);
  const x = (t) => 20 + (560 * (t - start)) / (end - start || 1);
  const y = (v) => 90 - (65 * (v - min)) / (max - min);
  const paths = series
    .map((s) => {
      const path = points
        .map(
          (p, i) =>
            `${i && (!options.maxGap || p.time - points[i - 1].time <= options.maxGap) ? 'L' : 'M'}${x(p.time).toFixed(2)},${y(p[s.key] ?? 0).toFixed(2)}`,
        )
        .join(' ');
      const isolated = options.maxGap
        ? points
            .map((p, i) =>
              (!i || p.time - points[i - 1].time > options.maxGap) &&
              (i === points.length - 1 || points[i + 1].time - p.time > options.maxGap)
                ? `<circle cx="${x(p.time)}" cy="${y(p[s.key] ?? 0)}" r="2" fill="${s.color}"/>`
                : '',
            )
            .join('')
        : '';
      return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2"/>${isolated}`;
    })
    .join('');
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
  const legend = series
    .map((s, i) =>
      s.label
        ? `<text x="${155 + i * 88}" y="137" style="fill:${s.color}" font-size="12">${escapeText(s.label)}</text>`
        : '',
    )
    .join('');
  return `<figure><h3>${escapeText(title)}</h3><svg viewBox="0 0 600 146" role="img" aria-label="${escapeText(title)}"><line x1="20" x2="580" y1="${y(min)}" y2="${y(min)}" stroke="#ccc"/>${ticks}${paths}${timeTicks}<text x="20" y="137" font-size="12">min ${tickNumber(min)}</text>${legend}<text x="580" y="137" text-anchor="end" font-size="12">max ${tickNumber(max)}</text></svg>${options.caption ? `<figcaption>${escapeText(options.caption)}</figcaption>` : ''}</figure>`;
}
export function observationsMarkup(report, { playerId } = {}) {
  const { runtime, timeline } = report;
  const signals = [...(runtime?.insights ?? []), ...(timeline?.signals ?? [])];
  const rows = runtime
    ? [
        [
          'Интервал rAF: p95 / максимум',
          `${number(runtime.mainThreadIntervalMs.p95)} / ${number(runtime.mainThreadIntervalMs.max)} мс`,
        ],
        ['Долгие кадры основного потока', runtime.longFrameCount],
        [
          'Длительность взаимодействия, максимум',
          runtime.maxInteractionMs === null
            ? 'Event Timing не зарегистрировал взаимодействий'
            : `${number(runtime.maxInteractionMs)} мс`,
        ],
        [
          'Интервалы между click',
          runtime.clickIntervalsMs?.length
            ? `${runtime.clickIntervalsMs.map(number).join(', ')} мс`
            : 'Нет повторных click',
        ],
      ]
    : [];
  return `<div class="motion-detail-body">
  ${runtime?.warning ? `<p>${escapeText(runtime.warning)}</p>` : ''}
  ${rows.length ? `<table class="motion-data-table"><tbody>${rows.map(([key, value]) => `<tr><th scope="row">${key}</th><td>${value}</td></tr>`).join('')}</tbody></table><p>Наблюдения браузера. Метки DOM и пикселей могут различаться; пауза wait и фактический интервал click показаны отдельно.</p>` : ''}
  <div class="motion-panels">${timeline ? graph(timeline.intervals, 'changedPercent', 'Вся запись · изменившиеся пиксели, %') : ''}${
    runtime?.trajectories
      .map((track) => {
        const axis =
          Math.max(...track.points.map((p) => Math.abs(p.dx))) >=
          Math.max(...track.points.map((p) => Math.abs(p.dy)))
            ? 'x'
            : 'y';
        return graph(
          track.points,
          axis,
          `${track.selector} · центр ${axis.toUpperCase()}, CSS px (DOM)`,
          runtime.clickTimes,
          { zero: false },
        );
      })
      .join('') ?? ''
  }</div>
  <h3 style="margin-top:24px">Все наблюдения · ${signals.length}</h3>
  ${signals.length ? `<ol class="motion-observation-list">${signals.map((item) => `<li><b>${Number.isFinite(item.time) ? `${timeControl(item.time, playerId, (runtime?.insights ?? []).includes(item) ? 'browser' : 'recording')} · ` : ''}${escapeText(observationTitle(item.kind))}</b>${item.target ? ` · <code>${escapeText(item.target)}</code>` : ''}<p>${escapeText(observationDetail(item))}</p><details><summary>Исходные поля</summary><pre>${escapeText(JSON.stringify(item, null, 2))}</pre></details></li>`).join('')}</ol>` : '<p>Автоматических наблюдений нет. Оцените кадры и наложение по замыслу движения.</p>'}
  </div>`;
}

export function comparisonMarkup(comparison) {
  return `<div class="motion-detail-body">${comparison.notes?.map((note) => `<p>${escapeText(note)}</p>`).join('') ?? ''}${
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
  }</div>`;
}

export function timeControl(time, playerId, clock = 'recording') {
  const label = `${time.toFixed(3)} с`;
  return playerId
    ? `<button class="motion-time" type="button" data-motion-time="${time}" data-motion-player="${escapeText(playerId)}" data-clock="${clock}" title="Перейти к ближайшей метке записи">${label}</button>`
    : label;
}

export function playbackMarkup(frames, { id = 'motion-playback', unsynchronized = false } = {}) {
  if (!frames?.length) return '';
  const data = JSON.stringify(frames).replace(/</g, '\\u003c');
  return `<details class="motion-play" id="${escapeText(id)}"><summary>Сохранённая запись · кадров: ${frames.length} · ${frames[0].time.toFixed(3)}–${frames.at(-1).time.toFixed(3)} с</summary>
  <img class="motion-playback" alt="Запись">
  <div class="motion-play-controls"><button type="button" data-play>Воспроизвести</button><button type="button" data-previous aria-label="Предыдущий кадр">← кадр</button><button type="button" data-next aria-label="Следующий кадр">кадр →</button><label>Время, с <input type="number" step="any" aria-label="Перейти ко времени, секунды" min="${frames[0].time}" max="${frames.at(-1).time}"></label></div>
  <p><input type="range" aria-label="Время записи" min="${frames[0].time}" max="${frames.at(-1).time}" step="any" value="${frames[0].time}"><output></output></p>
  <p class="motion-frame-position"></p><p class="motion-seek-note" role="status"></p>
  </details><script>(()=>{
  const root=document.getElementById(${JSON.stringify(id)}),frames=${data},image=root.querySelector('img'),slider=root.querySelector('input[type=range]'),time=root.querySelector('input[type=number]'),button=root.querySelector('[data-play]'),previous=root.querySelector('[data-previous]'),next=root.querySelector('[data-next]'),output=root.querySelector('output'),position=root.querySelector('.motion-frame-position'),note=root.querySelector('.motion-seek-note');
  let playing=false,started=0,base=0,pending,index=-1;
  const clamp=t=>Math.max(frames[0].time,Math.min(frames.at(-1).time,t));
  function show(t){t=clamp(t);const selected=Math.max(0,frames.findLastIndex(f=>f.time<=t+1e-9));if(selected!==index){index=selected;image.src=frames[index].image}slider.value=t;time.value=Number(t.toFixed(6));output.textContent=t.toFixed(3)+' с';position.textContent='Кадр '+(index+1)+' / '+frames.length+' · метка '+frames[index].time.toFixed(6)+' с';previous.disabled=index===0;next.disabled=index===frames.length-1}
  function stop(){playing=false;cancelAnimationFrame(pending);button.textContent='Воспроизвести'}
  function tick(now){if(!playing)return;const t=clamp(base+(now-started)/1000);show(t);if(t>=frames.at(-1).time)stop();else pending=requestAnimationFrame(tick)}
  button.onclick=()=>{if(playing){stop();return}stop();note.textContent='';playing=true;button.textContent='Пауза';base=Number(slider.value);if(base>=frames.at(-1).time)base=frames[0].time;started=performance.now();show(base);pending=requestAnimationFrame(tick)};
  slider.oninput=()=>{stop();note.textContent='';show(Number(slider.value))};
  time.onchange=()=>{stop();note.textContent='';if(Number.isFinite(time.valueAsNumber))show(time.valueAsNumber)};
  for(const [control,delta] of [[previous,-1],[next,1]])control.onclick=()=>{stop();note.textContent='';show(frames[Math.max(0,Math.min(frames.length-1,index+delta))].time)};
  root.addEventListener('motionseek',e=>{const requested=Number(e.detail.time);if(!Number.isFinite(requested))return;stop();const nearest=frames.reduce((best,f)=>Math.abs(f.time-requested)<Math.abs(best.time-requested)?f:best);show(nearest.time);note.textContent='Запрошено '+requested.toFixed(6)+' с; ближайшая метка записи '+nearest.time.toFixed(6)+' с.'+(e.detail.clock==='browser'&&${Boolean(unsynchronized)}?' Синхронизация DOM и пикселей не подтверждена.':'');time.focus({preventScroll:true})});
  root.ontoggle=()=>{if(!root.open)stop()};show(frames[0].time);
  })();</script>`;
}
