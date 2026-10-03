import { readFileSync } from 'node:fs';
import { frameColor } from './frames.mjs';
import {
  escapeText as escape,
  observationsMarkup,
  comparisonMarkup,
  timeControl,
} from './diagnostics.mjs';
import { reviewFocus } from './focus.mjs';
import { photometryMarkup, kymographMarkup } from './photometry-markup.mjs';

const styles = readFileSync(new URL('./report.css', import.meta.url), 'utf8');
const color = (i, count) => `rgb(${frameColor(i, count).join(',')})`;
const seconds = (v) => v.toFixed(3);
const navigation = `<script>(()=>{
if(window.__visualStoryMotionNavigation)return;window.__visualStoryMotionNavigation=true;
function reveal(hash){let id;try{id=decodeURIComponent(hash.slice(1))}catch{return}const target=document.getElementById(id);if(!target?.closest('.motion-sheet'))return;let item=target;while(item){if(item.tagName==='DETAILS')item.open=true;item=item.parentElement}requestAnimationFrame(()=>target.scrollIntoView({block:'start'}))}
document.addEventListener('click',e=>{const link=e.target.closest('a[data-motion-section]');if(link)reveal(link.hash);const seek=e.target.closest('[data-motion-time]');if(seek){const target=document.getElementById(seek.dataset.motionPlayer);if(target){reveal('#'+target.id);target.dispatchEvent(new CustomEvent('motionseek',{detail:{time:Number(seek.dataset.motionTime),clock:seek.dataset.clock}}))}}});
addEventListener('hashchange',()=>reveal(location.hash));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>reveal(location.hash),{once:true});else reveal(location.hash);
})();</script>`;

function bars(intervals, key, label, unit) {
  const max = Math.max(Number.EPSILON, ...intervals.map((v) => v[key]));
  const step = 560 / intervals.length;
  return `<svg viewBox="0 0 600 132" role="img" aria-label="${label}"><line x1="20" y1="100" x2="580" y2="100" stroke="#dbe2e5"/>${intervals
    .map((v, i) => {
      const x = 20 + step * i,
        h = (62 * v[key]) / max;
      const value = v[key].toFixed(key === 'dtMs' ? 1 : 2);
      return `<g><title>${i + 1} → ${i + 2}: ${value}${unit}</title><rect x="${x + 3}" y="${100 - Math.max(2, h)}" width="${Math.max(2, step - 6)}" height="${Math.max(2, h)}" fill="${v.duplicate ? '#8050b5' : '#2367b0'}"/>${intervals.length <= 16 ? `<text x="${x + step / 2}" y="${90 - h}" text-anchor="middle" font-size="11">${value}</text>` : ''}<text x="${x + step / 2}" y="119" text-anchor="middle" font-size="10">${i + 1}→${i + 2}</text></g>`;
    })
    .join('')}</svg>`;
}

function contextMarkup(report) {
  const photo = report.photometry,
    w = report.width,
    h = report.height;
  let markers = '',
    legend = '';
  if (photo?.status === 'available') {
    const k = photo.kymograph,
      roi = photo.roi;
    const position =
      k.axis === 'x'
        ? ((k.position - roi.y) / roi.height) * h
        : ((k.position - roi.x) / roi.width) * w;
    markers =
      k.axis === 'x'
        ? `<line x1="0" x2="${w}" y1="${position}" y2="${position}"/>`
        : `<line y1="0" y2="${h}" x1="${position}" x2="${position}"/>`;
    markers = `<g stroke="#b85516" stroke-width="${w / 140}">${markers}</g>`;
    legend = 'Охра — полоса кимограммы';
    const region =
      photo.spectrum?.status === 'available'
        ? photo.spectrum.region.match(/^Область (\d+)$/)
        : null;
    if (region) {
      const n = Number(region[1]) - 1;
      markers += `<rect x="${((n % 4) * w) / 4}" y="${(Math.floor(n / 4) * h) / 3}" width="${w / 4}" height="${h / 3}" stroke="#2367b0" stroke-width="${w / 100}" fill="#2367b0" fill-opacity=".12"/>`;
      legend += ` · синий — область ${n + 1}`;
    }
  }
  return `<figure class="motion-context"><div class="motion-context-visual"><img src="${report.frames[0].image}" alt="Контекст выбранного окна">${markers ? `<svg class="motion-context-overlay" viewBox="0 0 ${w} ${h}" aria-label="Область и полоса анализа">${markers}</svg>` : ''}</div><figcaption>Контекст · ${seconds(report.frames[0].time)} с${report.crop ? ' · выбранная область' : ''}${legend ? `<br>${legend}` : ''}</figcaption></figure>`;
}

export function motionMarkup(
  report,
  { includeFrames = true, idPrefix = 'motion', artifactBase = '.', playback = false } = {},
) {
  const { frames, intervals, photometry: photo } = report;
  const focus = reviewFocus(report);
  const prefix = idPrefix.replace(/[^a-zA-Z0-9_-]/g, '-');
  const id = (name) => `${prefix}-${name}`;
  const playerId = playback ? id('playback') : undefined;
  const link = (name, label) => `<a data-motion-section href="#${id(name)}">${label}</a>`;
  const detail = (name, title, hint, body) =>
    `<details class="motion-detail" id="${id(name)}"><summary>${title}${hint ? `<small>${hint}</small>` : ''}</summary>${body}</details>`;
  const bounds = report.motionBounds ?? { x: 0, y: 0, width: report.width, height: report.height };
  const map = (image, label, className = 'motion-map') =>
    `<svg class="${className}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img" aria-label="${label}"><image href="${image}" width="${report.width}" height="${report.height}"/></svg>`;
  const overlay = `<figure><h3>Выбранное окно · наложение контуров</h3>${map(report.overlay, 'Наложение изменяющихся контуров')}<div class="motion-legend"><span style="color:${color(0, frames.length)}">${seconds(frames[0].time)} с · раньше</span><span>цвет → порядок</span><span style="color:${color(frames.length - 1, frames.length)}">${seconds(frames.at(-1).time)} с · позже</span></div></figure>`;
  const sourceLabels = {
    'scene-seek': 'Сцена · время модели',
    'browser-capture': 'Браузер · выполнение',
    'window-capture': 'Окно приложения',
    video: 'Видео · PTS',
    'frame-manifest': 'PNG · исходные времена',
  };
  const total =
    report.timeline ??
    (photo?.status === 'available'
      ? { frames: photo.points.length, from: photo.from, to: photo.to }
      : { frames: frames.length, from: frames[0].time, to: frames.at(-1).time });
  const windowLabel = `${seconds(frames[0].time)}–${seconds(frames.at(-1).time)} с · кадров: ${frames.length}`;
  const observationLabel = report.runtime ? 'Наблюдения и метрики браузера' : 'Все наблюдения';
  const sections = [
    ['frames', 'Кадры и дельты'],
    ...(photo ? [['photometry', 'Яркость и цвет']] : []),
    ...(report.runtime || report.timeline ? [['runtime', observationLabel]] : []),
    ...(report.comparison ? [['comparison', 'Сравнение версий']] : []),
    ['method', 'Условия и данные'],
    ...(playback ? [['playback', 'Запись и перемотка']] : []),
  ];
  const sectionNames = Object.fromEntries(sections);
  const targetFor = (item) => (sectionNames[item.view] ? item.view : 'frames');
  const focusList = focus.items.length
    ? `<ol class="motion-focus">${focus.items
        .map((item) => {
          const outside =
            Number.isFinite(item.time) &&
            (item.time < frames[0].time || item.time > frames.at(-1).time);
          return `<li data-kind="${escape(item.kind)}">${link(targetFor(item), escape(item.title))}<p>${escape(item.detail)}</p><small>${escape(item.evidence)}${Number.isFinite(item.time) ? ` · ${timeControl(item.time, playerId, item.evidence === 'Пиксели' ? 'recording' : 'browser')}${outside ? ' · вне выбранного окна' : ''}` : ''}${item.target ? ` · ${escape(item.target)}` : ''}${item.count > 1 ? ` · случаев: ${item.count}` : ''} · ${escape(sectionNames[targetFor(item)])} →</small></li>`;
        })
        .join('')}</ol>`
    : '<div class="motion-focus-empty"><h3>Автосигналов для выделения нет</h3><p>Сопоставьте наложение и кадры с замыслом движения.</p></div>';
  const overview = `<section class="motion-summary"><div class="motion-eyebrow">Проверка движения</div><header class="motion-header"><div><h2>${escape(report.title ?? 'Соседние кадры')}</h2><small>${escape(sourceLabels[report.source.kind] ?? report.source.kind)} · интервал ${seconds(total.from)}–${seconds(total.to)} с · кадров: ${total.frames}</small><small>Выбранное окно ${windowLabel}</small></div></header>
    <p class="motion-scope">${escape(focus.coverage)}</p>
    <div class="motion-focus-layout"><div>${focusList}${focus.additionalCount ? `<p class="motion-focus-more">Других групп наблюдений: ${focus.additionalCount}. Полный список и исходные поля — ниже.</p>` : ''}</div>${contextMarkup(report)}</div>
    <div class="motion-panels">${overlay}${photo?.status === 'available' ? kymographMarkup(photo) : `<figure><h3>Выбранное окно · разность соседних кадров</h3>${map(report.difference, 'Карта межкадровых изменений')}<figcaption>Максимальная разность · порог ${report.threshold}/255</figcaption></figure>`}</div>
    <nav class="motion-nav" aria-label="Разделы проверки">${sections.map(([key, label]) => link(key, label)).join('')}</nav></section>`;
  const frameEvidence = `<div class="motion-detail-body motion-frame-evidence"><h3>Кадры и дельты · ${windowLabel}</h3><div class="motion-panels">${overlay}<figure><h3>Максимальная разность соседних кадров</h3>${map(report.difference, 'Карта межкадровых изменений')}<figcaption>${report.motionBounds ? 'Общая область изменений приближена' : 'Вся область'} · порог ${report.threshold}/255</figcaption></figure><figure><h3>Изменившиеся пиксели, % области</h3>${bars(intervals, 'changedPercent', 'Доля изменившихся пикселей', '%')}</figure><figure><h3>${report.source.sparse ? 'Интервал меток захвата' : 'Интервал между кадрами'}, мс</h3>${bars(intervals, 'dtMs', 'Интервал временных меток', ' ms')}</figure></div>
    <p>Повторов соседнего кадра: ${intervals.filter((v) => v.duplicate).length}. Фиолетовые столбцы отмечают повторы. Разность зависит от движения, формы и цвета.</p>
    ${includeFrames ? `<div class="motion-strip">${frames.map((frame, i) => `<figure style="--frame-color:${color(i, frames.length)}">${map(frame.image, `Кадр ${i + 1}`, 'motion-frame')}<figcaption>${i + 1} · ${seconds(frame.time)} с</figcaption></figure>`).join('')}</div>` : ''}
    ${report.overview ? `<h3 style="margin-top:24px">Вся запись · обзорные состояния</h3><div class="motion-overview">${report.overview.frames.map((frame) => `<figure><img src="${frame.image}" alt="Обзор ${seconds(frame.time)} секунд"><figcaption>${seconds(frame.time)} с</figcaption></figure>`).join('')}</div>` : ''}
    ${report.loop ? `<h3 style="margin-top:24px">Стык цикла · изменилось ${report.loop.changedPercent.toFixed(2)}%</h3><p>Последнее и первое состояния. Скорость на стыке проверяется по соседним кадрам через границу цикла.</p><div class="motion-pair">${report.loop.images.map((src, i) => `<figure><img src="${src}" alt="${i ? 'Начало' : 'Конец'}"><figcaption>${i ? 'Начало' : 'Конец'}</figcaption></figure>`).join('')}</div>` : ''}</div>`;
  const conditions = `<div class="motion-detail-body"><table class="motion-data-table"><tbody>${[
    [
      'Анализ',
      `${report.width} × ${report.height} px · ${(report.scale * 100).toFixed(1)}% исходного масштаба · порог ${report.threshold}/255`,
    ],
    ['Область источника', report.crop ? Object.values(report.crop).join(', ') : 'Весь кадр'],
    ['Времена', focus.coverage],
    [
      'Прозрачность',
      report.hasTransparency ? 'Цвет с учётом прозрачности и альфа-канал' : 'Кадры непрозрачны',
    ],
    ...(report.source.cue
      ? [
          [
            'Метка сцены',
            `${report.source.cue.id} · ${seconds(report.source.cue.start)}–${seconds(report.source.cue.end)} с`,
          ],
        ]
      : []),
  ]
    .map(([key, value]) => `<tr><th scope="row">${key}</th><td>${escape(value)}</td></tr>`)
    .join('')}</tbody></table>
  ${report.sizeChanged ? '<p>Размеры кадров различаются: общий масштаб, привязка к левому верхнему углу и прозрачное дополнение.</p>' : ''}
  ${report.scale < 1 ? `<p>Тонкие линии и малые сдвиги: <code>--max-size 0${report.suggestedCrop ? ` --crop ${Object.values(report.suggestedCrop).join(',')}` : ''}</code>.</p>` : ''}
  ${[report.source.warning, report.source.timingNote]
    .filter(Boolean)
    .map((text) => `<p>${escape(text)}</p>`)
    .join('')}
  ${frames.every((frame) => frame.file) ? `<p><a href="${escape(artifactBase)}/motion.json">Все измерения и временные метки</a> · <a href="${escape(artifactBase)}/frames.png">Кадры и дельты</a>${report.captureManifest ? ` · <a href="${escape(artifactBase)}/capture/frames.json">Манифест исходных кадров</a>` : ''}</p>` : ''}<details><summary>Параметры источника</summary><pre>${escape(JSON.stringify(report.source, null, 2))}</pre></details></div>`;
  return `<section class="motion-sheet"><style>${styles}</style>${overview}${detail('frames', 'Кадры и дельты', windowLabel, frameEvidence)}${photo ? detail('photometry', 'Яркость и цвет', 'Вся запись · области · спектр · RGB', photometryMarkup(report)) : ''}${report.runtime || report.timeline ? detail('runtime', observationLabel, 'Полный список · временные графики', observationsMarkup(report, { playerId })) : ''}${report.comparison ? detail('comparison', 'Сравнение версий', 'Раньше · сейчас · разность', comparisonMarkup(report.comparison)) : ''}${detail('method', 'Условия и данные', 'Масштаб · источник · ограничения измерения', conditions)}</section>${navigation}`;
}
