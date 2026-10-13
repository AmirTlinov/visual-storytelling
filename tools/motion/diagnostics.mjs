import { observationTitle, observationDetail } from './focus.mjs';
import {
  onionLayers,
  composeOnion,
  composeChange,
  temporalChangeStrength,
  installOnionPlayer,
} from './onion.mjs';
import { temporalChart, timeAtChartPoint, transitionTime } from './temporal-chart.mjs';
import { installTemporalNavigation } from './temporal-navigation.mjs';

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
  const min =
    options.min ??
    values.reduce((min, v) => Math.min(min, v), options.zero === false ? Infinity : 0);
  const max = Math.max(
    min + 0.0001,
    options.max ?? values.reduce((max, v) => Math.max(max, v), -Infinity),
  );
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
  const signals = [
    ...(runtime?.insights ?? []),
    ...(report.presentation ?? []),
    ...(timeline?.signals ?? []),
  ];
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
          track.points.reduce((max, p) => Math.max(max, Math.abs(p.dx)), 0) >=
          track.points.reduce((max, p) => Math.max(max, Math.abs(p.dy)), 0)
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
  return `<div class="motion-detail-body">${comparison.episodes?.length ? `<table><caption>Наблюдаемые интервалы</caption><thead><tr><th>Действие</th><th>Раньше, с</th><th>Сейчас, с</th></tr></thead><tbody>${comparison.episodes.map((e) => `<tr><td>${escapeText(e.id ?? e.episode)}</td><td>${e.before?.duration?.toFixed(3) ?? '—'}</td><td>${e.after?.duration?.toFixed(3) ?? '—'}</td></tr>`).join('')}</tbody></table><p>Длительность между входами или метками не определяет время завершения анимации. «Доля интервала» совмещает нормированное время; «этап операции» доступен при сохранённых состояниях операции.</p>` : ''}${comparison.notes?.map((note) => `<p>${escapeText(note)}</p>`).join('') ?? ''}${
    comparison.warning
      ? `<p>${escapeText(comparison.warning)}</p>`
      : comparison.pairs
          .map(
            (pair) =>
              `<p>${pair.episode ? escapeText(pair.episode) + ' · ' + (pair.mode === 'stage' ? 'этап операции' : pair.mode === 'phase' ? 'доля интервала' : 'по времени') + ' · ' + escapeText(pair.phase) : 'От начала'} ${pair.relativeTime.toFixed(3)} с · изменилось ${pair.changedPercent.toFixed(2)}% · расстояние меток захвата ${number(pair.timestampDistanceMs)} мс</p><div class="motion-pair">${[
                ['Раньше', pair.baselineImage],
                ['Сейчас', pair.currentImage],
                ['Разность', pair.difference],
              ]
                .map(
                  ([label, src]) =>
                    `<figure><img loading="lazy" src="${escapeText(src)}" alt="${label}"><figcaption>${label}</figcaption></figure>`,
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

export function playbackMarkup(
  frames,
  {
    id = 'motion-playback',
    unsynchronized = false,
    audio,
    open = false,
    onion = {},
    changes = [],
  } = {},
) {
  if (!frames?.length) return '';
  const data = JSON.stringify(frames).replace(/</g, '\\u003c');
  const geometry = {
    width: onion.width,
    height: onion.height,
    crop: onion.crop,
    scale: onion.scale,
    prepared: onion.prepared,
    radius: onion.radius ?? onionLayers(frames).radius,
  };
  return `<details class="motion-play" id="${escapeText(id)}" ${open ? 'open' : ''}><summary>Сохранённая запись · кадров: ${frames.length} · ${frames[0].time.toFixed(3)}–${frames.at(-1).time.toFixed(3)} с</summary>
  ${audio ? `<audio src="${escapeText(audio)}" preload="metadata"></audio>` : ''}<img class="motion-playback" alt="Запись"><canvas class="motion-playback" data-onion-canvas hidden aria-label="Текущий кадр с временным слоем"></canvas>
  <div class="motion-temporal-chart" data-temporal-chart tabindex="0" role="slider" aria-label="Время записи" aria-valuemin="${frames[0].time}" aria-valuemax="${frames.at(-1).time}"></div>
  <p class="motion-chart-hint">Выбери момент на графике · зелёным выделены резкие изменения</p>
  <div class="motion-play-controls"><button type="button" data-play>Воспроизвести</button><button type="button" data-previous aria-label="Предыдущий кадр">← кадр</button><button type="button" data-next aria-label="Следующий кадр">кадр →</button><label>Время, с <input type="number" step="any" aria-label="Перейти ко времени, секунды" min="${frames[0].time}" max="${frames.at(-1).time}"></label></div>
  <div class="motion-play-controls motion-view-controls" aria-label="Вид кадра"><button type="button" data-view="frame" aria-pressed="true">Чёткий кадр</button><button type="button" data-view="onion" data-onion aria-pressed="false">Следы</button><button type="button" data-view="change" aria-pressed="false">Изменения</button><label data-onion-window hidden>До и после, с <input type="number" step="any" min="0" aria-label="Радиус наложения, секунды"></label></div>
  <div class="motion-onion-legend" data-onion-legend hidden><span class="motion-past">Раньше</span><span>Сейчас · чёткий</span><span class="motion-future">Позже</span></div>
  <p class="motion-change-legend" data-change-legend hidden>Зелёный — изменившиеся области. Ярче при резком переходе.</p>
  <p data-onion-status hidden role="status"></p>
  <p class="motion-frame-position"></p><p class="motion-seek-note" role="status"></p>
  </details><script>(()=>{
  const root=document.getElementById(${JSON.stringify(id)}),frames=${data},image=root.querySelector('img'),time=root.querySelector('input[type=number]'),button=root.querySelector('[data-play]'),previous=root.querySelector('[data-previous]'),next=root.querySelector('[data-next]'),position=root.querySelector('.motion-frame-position'),note=root.querySelector('.motion-seek-note');
  const audio=root.querySelector('audio'),selectLayers=${onionLayers.toString()},changes=${JSON.stringify(changes).replace(/</g, '\\u003c')};let rangeEnd=frames.at(-1).time,rangeStart=frames[0].time;
  let playing=false,started=0,base=0,pending,index=-1,currentTime=frames[0].time;
  const clamp=t=>Math.max(frames[0].time,Math.min(frames.at(-1).time,t));
  function show(t){t=clamp(t);const selected=Math.max(0,frames.findLastIndex(f=>f.time<=t+1e-9));if(selected!==index){index=selected;image.src=frames[index].image;root.dataset.time=frames[index].time;root.dispatchEvent(new CustomEvent('motionframe',{bubbles:true,detail:{time:frames[index].time,index}}))}currentTime=t;time.value=Number(t.toFixed(6));position.textContent='Кадр '+(index+1)+' / '+frames.length+' · '+frames[index].time.toFixed(3)+' с';previous.disabled=index===0;next.disabled=index===frames.length-1}
  function manual(){stop();rangeStart=frames[0].time;rangeEnd=frames.at(-1).time;note.textContent=''}
  function stop(){playing=false;audio?.pause();cancelAnimationFrame(pending);button.textContent='Воспроизвести'}
  // A queued RAF timestamp may precede the click's performance.now(); playback cannot start backwards.
  function tick(now){if(!playing)return;const t=clamp(audio&&!audio.paused?audio.currentTime:base+Math.max(0,now-started)/1000);show(t);if(t>=rangeEnd){show(rangeEnd);if(audio)audio.currentTime=rangeEnd;stop()}else pending=requestAnimationFrame(tick)}
  button.onclick=()=>{if(playing){stop();return}stop();note.textContent='';playing=true;button.textContent='Пауза';base=currentTime;if(base>=rangeEnd||base<rangeStart)base=rangeStart;started=performance.now();if(audio){audio.currentTime=base;void audio.play().catch(()=>{note.textContent='Звук недоступен; кадры продолжают воспроизводиться.'})}show(base);pending=requestAnimationFrame(tick)};
  time.onchange=()=>{manual();show(Number.isFinite(time.valueAsNumber)?selectLayers(frames,{at:time.valueAsNumber}).time:frames[index].time)};
  for(const [control,delta] of [[previous,-1],[next,1]])control.onclick=()=>{manual();show(frames[Math.max(0,Math.min(frames.length-1,index+delta))].time)};
  root.addEventListener('motionseek',e=>{const requested=Number(e.detail.time);if(!Number.isFinite(requested))return;manual();const nearest=frames.reduce((best,f)=>Math.abs(f.time-requested)<Math.abs(best.time-requested)?f:best);show(nearest.time);if(e.detail.focus!==false)note.textContent='Запрошено '+requested.toFixed(6)+' с; ближайшая метка записи '+nearest.time.toFixed(6)+' с.'+(e.detail.clock==='browser'&&${Boolean(unsynchronized)}?' Синхронизация DOM и пикселей не подтверждена.':'');if(e.detail.focus!==false)time.focus({preventScroll:true})});
  root.addEventListener('motionrange',e=>{stop();rangeStart=clamp(e.detail.from);rangeEnd=clamp(e.detail.to);show(rangeStart);button.click()});
  (${installOnionPlayer.toString()})(root,frames,selectLayers,${composeOnion.toString()},${JSON.stringify(geometry)},stop,${composeChange.toString()},${temporalChangeStrength.toString()},changes);
  (${installTemporalNavigation.toString()})(root,frames,changes,${temporalChart.toString()},${timeAtChartPoint.toString()},${transitionTime.toString()});
  function fitFrame(){if(!root.open)return;const frame=root.querySelector('.motion-playback:not([hidden])');if(!frame)return;const chrome=root.getBoundingClientRect().height-frame.getBoundingClientRect().height;root.style.setProperty('--motion-frame-height',Math.max(80,innerHeight-chrome-32)+'px')}
  new ResizeObserver(fitFrame).observe(root);addEventListener('resize',fitFrame);
  root.ontoggle=()=>{if(!root.open)stop()};show(selectLayers(frames,{at:${JSON.stringify(onion.time ?? frames[0].time)}}).time);
  })();</script>`;
}
