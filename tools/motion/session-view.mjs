import { relative } from 'node:path';
import { escapeText as escape } from './diagnostics.mjs';
import { queryEvidence } from './inspection.mjs';

const url = (out, path) => relative(out, path).split('/').map(encodeURIComponent).join('/');
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

export function sessionMarkup(report, out, player) {
  if (!report.session) return '';
  const { session, samples } = report;
  const frames = samples.map(({ png, epoch, ...f }) => ({ ...f, file: url(out, f.file) }));
  const byTime = new Map(frames.map((f) => [f.time, f]));
  const episodes = session.episodes;
  const time = (t) => Number(t).toFixed(3);
  const thumb = (f) =>
    `<button class="session-frame" data-evidence-time="${f.time}" type="button"><img loading="lazy" src="${escape(f.file)}" alt="Кадр ${time(f.time)} с"><span>${time(f.time)} с</span></button>`;
  const card = (e) =>
    `<details class="session-episode" id="episode-${escape(e.id)}"><summary><span>${escape(e.title)}</span><small>${time(e.start)}–${time(e.end)} с · ${e.observed.sampledFrames} кадров</small></summary>${e.text ? `<blockquote>${escape(e.text)}</blockquote>` : ''}<p>${escape(e.kind)} · <code>${escape(e.id)}</code></p><button type="button" data-evidence-range="${e.start},${e.end}">Посмотреть интервал</button><div class="session-frames">${e.frames
      .map((f) => byTime.get(f.time))
      .filter(Boolean)
      .map(thumb)
      .join(
        '',
      )}</div><details><summary>Наблюдения и привязки</summary><pre>${escape(JSON.stringify(e, null, 2))}</pre></details></details>`;
  const roots = episodes.filter((e) => !e.parent);
  const data = {
    frames,
    episodes,
    telemetry: report.telemetry,
    context: report.context,
    source: report.source,
  };
  return `<section class="motion-sheet session-review"><style>
  .session-summary{padding:22px;border:1px solid #d7dce0;border-radius:12px;background:#fff;color:#272e34}.session-summary h1{margin:0 0 8px;font-size:24px}.session-summary p{margin:8px 0}.session-overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.session-overview article{padding:10px;background:#f4f6f8;border-radius:8px}.session-overview img{width:100%;height:170px;object-fit:contain;background:white}.session-overview h3{font-size:14px;margin:6px 0}.session-overview small{color:#586570}.session-episode{margin:12px 0;border:1px solid #d7dce0;border-radius:8px;padding:12px;background:white}.session-episode>summary{display:flex;gap:12px;justify-content:space-between;cursor:pointer}.session-episode small{color:#586570;white-space:nowrap}.session-episode blockquote{margin:12px 0;border-left:3px solid #648eaf;padding-left:12px}.session-frames{display:flex;gap:8px;overflow:auto;padding:12px 0}.session-frame{flex:0 0 180px;border:1px solid #d7dce0;background:#fff;border-radius:6px;cursor:pointer}.session-frame img{width:100%;height:150px;object-fit:contain}.session-frame span{display:block;padding:5px}.session-child{margin-left:16px}.session-inspector{padding:16px;border:1px solid #d7dce0;border-radius:8px;background:#fff}.session-inspector pre{max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.session-inspector select{max-width:100%;padding:6px}.session-zoom{width:100%;height:180px;object-fit:contain;background:#f6f7f8}.session-lens{display:grid;grid-template-columns:1fr 1fr;gap:12px}.session-lens canvas{width:100%;height:180px;object-fit:contain}.session-review button{font:inherit;padding:7px;border:1px solid #bac5ce;border-radius:6px;background:#f7f9fa;color:#27343e;cursor:pointer}.session-review :focus-visible{outline:2px solid #2367b0;outline-offset:2px}.session-review code{overflow-wrap:anywhere}.session-filter{width:100%;box-sizing:border-box;padding:10px;margin:14px 0}.session-inspector [data-inspection-status]{min-height:1.5em}.session-map{margin-top:14px}@media(max-width:700px){.session-overview{grid-template-columns:1fr 1fr}.session-episode>summary{display:block}.session-lens{grid-template-columns:1fr}}
  </style><section class="session-summary"><h1>${escape(report.title)} · сеанс наблюдения</h1><p>${time(session.coverage.from)}–${time(session.coverage.to)} с · ${session.coverage.frames} кадров · ${episodes.length} эпизодов · ${escape(session.coverage.sampling)}</p><p>${escape(report.source.timingNote ?? 'Времена и исходные кадры сохранены. Выберите эпизод, затем деталь.')}</p>${session.coverage.complete ? '' : `<p>Запись частичная: ${escape(report.source.error ?? report.source.warning ?? 'см. условия')}</p>`}<div class="session-overview">${roots
    .slice(0, 6)
    .map((e) => {
      const f = byTime.get(e.frames[Math.floor(e.frames.length / 2)]?.time);
      return `<article><a href="#episode-${escape(e.id)}" data-episode-link>${f ? `<img src="${escape(f.file)}" alt="${escape(e.title)}">` : ''}<h3>${escape(e.title)}</h3></a><small>${time(e.start)}–${time(e.end)} с</small></article>`;
    })
    .join(
      '',
    )}</div><p><a href="#session-map">Все эпизоды</a> · <a href="#motion-playback">Запись и выбор объекта</a> · <a href="session.json">Индекс сеанса</a></p></section>${player}
  <section class="session-inspector" id="session-inspector"><p><b>Выберите объект на кадре записи</b> или в списке. Общее изображение сохраняет экранные координаты; увеличение сопровождает выбранную деталь.</p><select aria-label="Наблюдаемый объект" data-inspection-object><option value="">Все объекты</option></select><p data-inspection-status role="status"></p><p data-evidence-context></p><p data-evidence-owners></p><div class="session-lens"><canvas data-fixed-lens aria-label="Контекст выбранного объекта"></canvas><canvas data-object-lens aria-label="Увеличение выбранного объекта"></canvas></div><details><summary>Объект, состояние, речь и события</summary><pre data-inspection-data></pre></details><p><code data-inspection-command></code></p></section>
  <section id="session-map" class="session-map"><input class="session-filter" type="search" aria-label="Поиск эпизода или реплики" placeholder="Найти действие или слова…">${roots
    .map(
      (e) =>
        card(e) +
        `<div class="session-child">${episodes
          .filter((c) => c.parent === e.id)
          .map(card)
          .join('')}</div>`,
    )
    .join('')}</section></section>
  <script>(()=>{
    const data=${json(data)},query=${queryEvidence.toString()},quote=${shellQuote.toString()};
    const inspector=document.getElementById('session-inspector'),select=inspector.querySelector('select'),status=inspector.querySelector('[data-inspection-status]');
    let at=data.frames[0].time,object='',point,revision=0;
    function inspect(){const evidence=query(data,{at,radius:.3,object:object||undefined,point,limit:3});
      const full=query(data,{at,radius:.3,limit:2});
      const ids=[...new Map([...full.objects,...(evidence.hits??[])].map(o=>[o.id,o])).values()];
      select.replaceChildren(new Option('Все объекты',''),...ids.map(o=>new Option((o.text||o.id).slice(0,90),o.id)));
      object=evidence.requested.object||object;const missing=object&&!ids.some(o=>o.id===object);if(missing)select.append(new Option(object+' · нет отсчёта',object));select.value=object;
      status.textContent=at.toFixed(3)+' с · '+(object||(point?'область изображения':'общий кадр'))+' · '+evidence.observed.frames+' кадров в выбранной окрестности'+(missing?' · геометрия объекта в этом кадре не наблюдалась':'');
      const speaking=evidence.episodes.filter(e=>e.text&&e.kind!=='chapter');
      const reads=evidence.scene?.cueReads??evidence.frames.find(f=>Math.abs(f.time-at)<.15)?.cueReads;
      inspector.querySelector('[data-evidence-context]').textContent=speaking.map(e=>e.text).join(' · ')+(reads?' | Код запросил: '+reads.reads.map(r=>r.id+' '+r.operation+' = '+r.value).join('; '):'');
      inspector.querySelector('[data-inspection-data]').textContent=JSON.stringify(evidence,null,2);
      inspector.querySelector('[data-inspection-command]').textContent=${json("visual-story review inspect '" + out.replaceAll("'", "'\\''") + "'")}+' --at '+at.toFixed(6)+(object?' --object '+quote(object):point?' --point '+point.map(Math.round).join(','):'');
      const owners=inspector.querySelector('[data-evidence-owners]');owners.replaceChildren();
      for(const file of new Set([...evidence.objects,...evidence.ancestors].map(o=>o.sourceFile).filter(Boolean))){const a=document.createElement('a');a.href='file://'+file.split('/').map(encodeURIComponent).join('/');a.textContent=file;a.target='_blank';a.rel='noopener';owners.append(a,document.createElement('br'))}
      const frame=data.frames.reduce((a,b)=>Math.abs(b.time-at)<Math.abs(a.time-at)?b:a),body=object?evidence.objects[0]:evidence.region;
      const token=++revision,img=new Image();img.onload=()=>{if(token!==revision)return;
        for(const [selector,zoom] of [['[data-fixed-lens]',false],['[data-object-lens]',true]]){const canvas=inspector.querySelector(selector),ctx=canvas.getContext('2d');canvas.width=640;canvas.height=240;ctx.clearRect(0,0,640,240);const b=body&&body.width>0?body:undefined;if(zoom&&missing){ctx.fillStyle='#586570';ctx.font='16px sans-serif';ctx.fillText('Нет наблюдения геометрии в этом кадре',24,120);continue}
          let x=0,y=0,w=img.naturalWidth,h=img.naturalHeight;
          if(zoom&&b){x=Math.max(0,b.x-12);y=Math.max(0,b.y-12);w=Math.min(img.naturalWidth-x,b.width+24);h=Math.min(img.naturalHeight-y,b.height+24)}
          const scale=Math.min(640/w,240/h),dx=(640-w*scale)/2,dy=(240-h*scale)/2;ctx.drawImage(img,x,y,w,h,dx,dy,w*scale,h*scale);
          if(!zoom&&b){ctx.strokeStyle='#2367b0';ctx.lineWidth=2;ctx.strokeRect(dx+b.x*scale,dy+b.y*scale,b.width*scale,b.height*scale)}
        }};img.src=frame.file;
    }
    document.addEventListener('motionframe',e=>{at=e.detail.time;point=undefined;inspect()});
    document.addEventListener('click',e=>{
      const f=e.target.closest('[data-evidence-time]'),r=e.target.closest('[data-evidence-range]'),link=e.target.closest('[data-episode-link]');
      if(link){const d=document.getElementById(decodeURIComponent(link.hash.slice(1)));if(d)d.open=true}
      const player=document.getElementById('motion-playback');
      if(f||r){player.open=true;const range=r?.dataset.evidenceRange.split(',').map(Number);player.dispatchEvent(new CustomEvent(range?'motionrange':'motionseek',{detail:range?{from:range[0],to:range[1]}:{time:Number(f.dataset.evidenceTime)}}));player.scrollIntoView({block:'start'})}
      if(e.target.matches('.motion-playback')){const img=e.target,b=img.getBoundingClientRect(),scale=Math.min(b.width/img.naturalWidth,b.height/img.naturalHeight),x=(e.clientX-b.left-(b.width-img.naturalWidth*scale)/2)/scale,y=(e.clientY-b.top-(b.height-img.naturalHeight*scale)/2)/scale;if(x<0||y<0||x>img.naturalWidth||y>img.naturalHeight)return;point=[x,y];object='';inspect();inspector.scrollIntoView({block:'nearest'})}
    });
    select.onchange=()=>{object=select.value;point=undefined;inspect()};
    document.querySelector('.session-filter').oninput=e=>{const q=e.target.value.toLocaleLowerCase();for(const row of document.querySelectorAll('.session-episode'))row.hidden=!row.textContent.toLocaleLowerCase().includes(q)};
    inspect();
  })();</script>`;
}
