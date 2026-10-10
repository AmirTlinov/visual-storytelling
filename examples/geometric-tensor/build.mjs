import { resolve } from 'node:path';
import { svgRange } from '@visual-storytelling/core/controls';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

// One geometry implementation creates both the saved SVG and its live updates.
import { pathToFileURL } from 'node:url';
const { svgRuntime } = await import(
  pathToFileURL(
    `${process.env.VISUAL_STORY_TOOLS ?? new URL('../../tools', import.meta.url).pathname}/svg-runtime.mjs`,
  )
);
const sharedRuntime = await svgRuntime({ '': ['mountScene', 'SvgLayout'], '/three': ['SvgOrbit'] });

function tensorScene(t, yaw, pitch) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const rotate = ([x, y, z]) => [
    c * x + s * z,
    cp * y + sp * (-s * x + c * z),
    -sp * y + cp * (-s * x + c * z),
  ];
  const axes = [1 + 0.85 * t, 1, 1 - 0.48 * t],
    parts = [],
    annotations = [],
    routes = [];
  const scale = 120,
    fmt = (n) => Number(n.toFixed(3));
  const spherePoint = (a, b) => [Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)];
  function body(radii, cx, theme) {
    const [rx, ry, rz] = radii,
      cy = 354;
    const part = (id, tag, attrs, text) => parts.push({ id: theme + '-' + id, tag, attrs, text });
    const project = (p) => {
      const q = rotate(p.map((v, i) => v * radii[i]));
      return [cx + scale * q[0], cy - scale * q[1], q[2]];
    };
    const normal = (p) => rotate(p.map((v, i) => v / radii[i]))[2];
    const columns = [
      [rx, 0, 0],
      [0, ry, 0],
      [0, 0, rz],
    ].map(rotate);
    const q00 = columns.reduce((a, v) => a + v[0] * v[0], 0) * scale * scale;
    const q01 = -columns.reduce((a, v) => a + v[0] * v[1], 0) * scale * scale;
    const q11 = columns.reduce((a, v) => a + v[1] * v[1], 0) * scale * scale;
    const d = Math.hypot(q00 - q11, 2 * q01);
    const a = Math.sqrt((q00 + q11 + d) / 2),
      b = Math.sqrt((q00 + q11 - d) / 2);
    const angle = d < 1e-10 * (q00 + q11) ? 0 : (Math.atan2(2 * q01, q00 - q11) * 90) / Math.PI;
    // An exact projected ellipse, without rotating its paint coordinate system.
    // sqrt(Q) gives a continuous starting point even at repeated eigenvalues.
    const det = Math.sqrt(Math.max(0, q00 * q11 - q01 * q01));
    const denominator = Math.sqrt(q00 + q11 + 2 * det);
    const dx = (q00 + det) / denominator,
      dy = q01 / denominator;
    const first = fmt(cx + dx) + ',' + fmt(cy + dy),
      opposite = fmt(cx - dx) + ',' + fmt(cy - dy);
    const arc = 'A' + fmt(a) + ',' + fmt(b) + ' ' + fmt(angle) + ' 0 1 ';
    part('surface', 'path', {
      d: 'M' + first + ' ' + arc + opposite + ' ' + arc + first + ' Z',
      fill:
        'color-mix(in srgb,var(--ve-' +
        (theme === 'sphere' ? 'blue' : 'purple') +
        ') 12%,var(--ve-surface))',
      stroke: theme === 'sphere' ? 'var(--ve-blue)' : 'var(--ve-purple)',
      'stroke-width': 1.1,
    });
    function curve(points) {
      let path = '',
        drawing = false;
      for (const p of points) {
        const q = project(p),
          front = normal(p) >= 0;
        if (front) path += (drawing ? ' L' : ' M') + fmt(q[0]) + ',' + fmt(q[1]);
        drawing = front;
      }
      return path;
    }
    const grid = [];
    for (let k = 1; k < 8; k++) {
      const b = -Math.PI / 2 + (k * Math.PI) / 8;
      grid.push(curve(Array.from({ length: 145 }, (_, j) => spherePoint((j * Math.PI) / 72, b))));
    }
    for (let k = 0; k < 16; k++)
      grid.push(
        curve(
          Array.from({ length: 97 }, (_, j) =>
            spherePoint((k * Math.PI) / 8, -Math.PI / 2 + (j * Math.PI) / 96),
          ),
        ),
      );
    grid.forEach((d, i) =>
      part('grid-' + i, 'path', {
        d,
        fill: 'none',
        stroke: theme === 'sphere' ? 'var(--ve-blue)' : 'var(--ve-purple)',
        'stroke-width': 1,
        opacity: 0.7,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    );
    const basis = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    for (let k = 0; k < 3; k++) {
      const p = basis[k],
        n = project(p.map((v) => -1.18 * v)),
        e = project(p.map((v) => 1.18 * v));
      const back = rotate(p)[2] < 0;
      part('axis-' + k + '-negative', 'path', {
        d: 'M' + fmt(n[0]) + ',' + fmt(n[1]) + ' L' + cx + ',' + cy,
        fill: 'none',
        stroke: 'var(--ve-pencil)',
        'stroke-width': 1,
        'stroke-dasharray': back ? 'none' : '3 6',
        opacity: 0.6,
      });
      part('axis-' + k + '-positive', 'path', {
        d: 'M' + cx + ',' + cy + ' L' + fmt(e[0]) + ',' + fmt(e[1]),
        fill: 'none',
        stroke: 'var(--ve-pencil)',
        'stroke-width': 1.1,
        'stroke-dasharray': back ? '3 6' : 'none',
        opacity: 0.7,
      });
      routes.push({ start: { x: n[0], y: n[1] }, end: { x: e[0], y: e[1] }, width: 1.1 });
      if (theme === 'tensor') {
        part(
          'axis-' + k + '-label',
          'text',
          { x: fmt(e[0]), y: fmt(e[1]), 'text-anchor': 'middle', class: 'axis' },
          'e<tspan baseline-shift="sub" font-size="13">' + (k + 1) + '</tspan>',
        );
        annotations.push({
          id: theme + '-axis-' + k + '-label',
          anchor: { x: e[0], y: e[1] },
          route: { start: { x: cx, y: cy }, end: { x: e[0], y: e[1] }, width: 1.1 },
          role: 'axis',
        });
      }
    }
    const v = [0.56, 0.76, 0.3298484500494128];
    const end = project(v),
      dxv = end[0] - cx,
      dyv = end[1] - cy,
      len = Math.hypot(dxv, dyv);
    const ux = dxv / Math.max(len, 1e-12),
      uy = dyv / Math.max(len, 1e-12);
    const headLength = Math.min(12, len),
      headWidth = Math.min(4.5, len / 3);
    part('vector', 'path', {
      d:
        'M' +
        cx +
        ',' +
        cy +
        ' L' +
        fmt(end[0] - headLength * 0.67 * ux) +
        ',' +
        fmt(end[1] - headLength * 0.67 * uy),
      fill: 'none',
      stroke: 'var(--ve-orange)',
      'stroke-width': 2.7,
    });
    part('vector-head', 'polygon', {
      points:
        fmt(end[0]) +
        ',' +
        fmt(end[1]) +
        ' ' +
        fmt(end[0] - headLength * ux + headWidth * uy) +
        ',' +
        fmt(end[1] - headLength * uy - headWidth * ux) +
        ' ' +
        fmt(end[0] - headLength * ux - headWidth * uy) +
        ',' +
        fmt(end[1] - headLength * uy + headWidth * ux),
      fill: 'var(--ve-orange)',
    });
    part('origin', 'circle', { cx, cy, r: 3, fill: 'var(--ve-orange)' });
    part(
      'vector-label',
      'text',
      { x: fmt(end[0]), y: fmt(end[1]), class: 'vector' },
      theme === 'sphere' ? 'v' : 'Tv',
    );
    const route = { start: { x: cx, y: cy }, end: { x: end[0], y: end[1] }, width: 2.7 };
    routes.push(route);
    annotations.push({
      id: theme + '-vector-label',
      anchor: route.end,
      route,
      role: 'vector',
    });
  }
  body([1, 1, 1], 250, 'sphere');
  body(axes, 775, 'tensor');
  return { parts, axes, annotations, routes };
}

const initial = { t: 1, yaw: 0.58, pitch: 0.34 };
const scene = tensorScene(initial.t, initial.yaw, initial.pitch);
const geometry = ['sphere', 'tensor']
  .map(
    (theme) =>
      `<g id="${theme}-geometry">${scene.parts
        .filter((p) => p.id.startsWith(theme + '-'))
        .map(
          (p) =>
            `<${p.tag} id="${p.id}" ${Object.entries(p.attrs)
              .map(([key, value]) => `${key}="${value}"`)
              .join(' ')}>${p.text ?? ''}</${p.tag}>`,
        )
        .join('')}</g>`,
  )
  .join('');
const matrix =
  scene.axes
    .map(
      (v, i) =>
        `<text id="eigen-${i}" x="${773 + i * 62}" y="${53 + i * 30}" class="matrix">${v.toFixed(2)}</text>`,
    )
    .join('') +
  [
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 1],
  ]
    .map(([i, j]) => `<text x="${773 + j * 62}" y="${53 + i * 30}" class="matrix zero">0</text>`)
    .join('');
const script = String.raw`
(()=>{
  'use strict';
  const root=document.querySelector('svg.ve-scene'),byID=id=>document.getElementById(id);
  const lifetime=new AbortController(),listen={signal:lifetime.signal};
  const viewport=byID('viewport'),slider=byID('tensor-control-input');
  const aperture=viewport.querySelector('rect'),world=byID('orbit-world'),labels=byID('annotations');
  root.addEventListener('pointerdown',()=>root.classList.add('pointer-input'),{...listen,capture:true});
  root.addEventListener('keydown',()=>root.classList.remove('pointer-input'),{...listen,capture:true});
  let t=1,yaw=.58,pitch=.34;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const format=x=>x.toFixed(2);
  const nodes=new Map(Array.from(byID('geometry').querySelectorAll('[id]'),node=>[node.id,node]));
  const leaders=new Map(),covers=new Map();
  const overflow=SvgLayout.overflow(labels,{region:aperture});
  const leaderLayer=SvgLayout.element('g',{'mask':'url(#annotation-ink-mask)'});
  const mask=SvgLayout.element('mask',{
    id:'annotation-ink-mask',maskUnits:'userSpaceOnUse',maskContentUnits:'userSpaceOnUse'
  });
  const clear=SvgLayout.element('rect',{fill:'white'});
  mask.append(clear);labels.append(mask,leaderLayer);
  // Labels live outside the scaled world. Their ink, obstacles and aperture are
  // measured in one screen-space SVG group by the shared layout owner.
  for(const item of tensorScene(t,yaw,pitch).annotations) {
    const label=nodes.get(item.id);
    labels.append(label);
    label.setAttribute('data-review-id',item.id);
    const anchor=SvgLayout.element('circle',{r:.01,fill:'none'});
    const leader=SvgLayout.element('path',{
      fill:'none',stroke:item.role==='vector'?'var(--ve-orange)':'var(--ve-muted)',
      'stroke-width':1,'stroke-linecap':'round',opacity:.7
    });
    const cover=SvgLayout.element('rect',{fill:'black'});
    mask.append(cover);covers.set(item.id,cover);
    labels.prepend(anchor);leaderLayer.append(leader);
    leader.setAttribute('data-label-for',item.id);
    leaders.set(item.id,{anchor,leader});
  }
  function layout(scene){
    const crop=SvgLayout.box(aperture,labels);
    for(const key of ['x','y','width','height']){
      mask.setAttribute(key,crop[key]);clear.setAttribute(key,crop[key]);
    }
    const worldToLabels=labels.getCTM().inverse().multiply(world.getCTM());
    const point=p=>{const q=new DOMPoint(p.x,p.y).matrixTransform(worldToLabels);return{x:q.x,y:q.y};};
    const route=r=>({...r,start:point(r.start),end:point(r.end),
      width:r.width*Math.hypot(worldToLabels.a,worldToLabels.b)});
    const avoid=[overflow.reserve(),byID('sphere-surface'),byID('tensor-surface'),byID('mapping'),byID('mapping-label'),
      byID('sphere-label'),byID('tensor-label'),...scene.routes.map(route)];
    const ordered=[...scene.annotations].sort((a,b)=>Number(b.role==='vector')-Number(a.role==='vector'));
    for(const item of ordered){
      const label=nodes.get(item.id),{anchor,leader}=leaders.get(item.id),target=point(item.anchor);
      anchor.setAttribute('cx',target.x);anchor.setAttribute('cy',target.y);
      const placed=SvgLayout.along(label,route(item.route),{
        at:1,offset:-18,avoid,gap:5,space:labels,region:aperture
      });
      if(placed.status==='placed'){
        const link=SvgLayout.connect(anchor,label,{space:labels,gap:3,route:'straight'});
        leader.setAttribute('d',link.d);leader.removeAttribute('visibility');
        avoid.push(label,link);
      }else leader.setAttribute('visibility','hidden');
    }
    overflow.update(ordered.filter(item=>nodes.get(item.id).dataset.layoutStatus==='overflow').map(item=>({
      id:item.id,label:nodes.get(item.id).textContent,
      subject:item.id==='sphere-vector-label'?'Исходный вектор':item.id==='tensor-vector-label'?'Преобразованный вектор':'Главное направление'
    })));
    for(const item of ordered){
      const label=nodes.get(item.id),cover=covers.get(item.id);
      const ink=SvgLayout.box(label,labels);
      const shown=label.dataset.layoutStatus==='placed';
      cover.setAttribute('x',ink.x-3);cover.setAttribute('y',ink.y-3);
      cover.setAttribute('width',shown?ink.width+6:0);cover.setAttribute('height',shown?ink.height+6:0);
    }
  }
  function draw(){
    const scene=tensorScene(t,yaw,pitch);
    for(const part of scene.parts) {
      const node=nodes.get(part.id);
      for(const [name,value] of Object.entries(part.attrs)) {
        const next=String(value);
        if(node.getAttribute(name)!==next)node.setAttribute(name,next);
      }
    }
    scene.axes.forEach((value,i)=>{
      const node=byID('eigen-'+i),next=format(value);
      if(node.textContent!==next)node.textContent=next;
    });
    slider.value=t;
    slider.setAttribute('aria-valuetext',scene.axes.map(format).join(', '));
    layout(scene);
  }
  function setT(value){
    if(!Number.isFinite(value))throw new Error('Tensor transformation must be finite');
    t=clamp(value,0,1);draw();
  }
  slider.addEventListener('input',()=>setT(slider.valueAsNumber),listen);
  const orbit=SvgOrbit.mount(root,viewport,byID('orbit-world'),{
    yaw,pitch,pitchLimits:[-.75,.75],changed(pose){yaw=pose.yaw;pitch=pose.pitch;draw();}
  });
  mountScene(root,{
    camera:orbit,
    svg:()=>root,
    snapshot:()=>({t,view:orbit.pose}),
    dispose(){lifetime.abort();overflow.dispose();orbit.dispose();}
  },{
    parameters:[{key:'t',label:'Преобразование',type:'range',value:1,min:0,max:1,step:.02}],
    values:()=>({t}),
    setValues:values=>{if(values.t!==undefined)setT(values.t)}
  });
  document.fonts.ready.then(()=>{if(!lifetime.signal.aborted)draw();});
})();`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="group" aria-labelledby="title desc">
<title id="title">Геометрия тензора</title>
<desc id="desc">Геометрический пример симметричного положительно определённого тензора второго порядка в его главном ортонормированном базисе. Единичная сфера v преобразуется в множество T v. T = diag(1 + 0.85 t, 1, 1 - 0.48 t), 0 ≤ t ≤ 1. Полуоси эллипсоида равны собственным значениям T. Это образ сферы при линейном преобразовании, не поверхность уровня vᵀ T v = 1. Два вида используют один масштаб и камеру. Перетаскивание вращает оба объекта; стрелки клавиатуры также вращают выбранную сцену. Ползунок меняет тензор; Home и End выбирают границы. Рисунок остаётся видимым без JavaScript.</desc>
<metadata>Original vector illustration. Tensor ellipsoid reference: https://vtk.org/doc/nightly/html/classvtkTensorGlyph.html . No external dependencies.</metadata>
<style>
  text{font-family:inherit;fill:var(--ve-ink)}
  .heading{font-size:34px;font-weight:500;letter-spacing:-.8px}
  .matrix{fill:var(--ve-purple);font-size:20px;text-anchor:middle;font-variant-numeric:tabular-nums}
  .zero{fill:var(--ve-muted)}
  .axis{font-family:inherit;font-style:italic;font-size:20px;fill:var(--ve-muted)}
  .vector{font-family:inherit;font-style:italic;font-size:24px;fill:var(--ve-orange)}
  [data-layout-status='overflow']{visibility:hidden}
  .label{font-size:23px;text-anchor:middle}
  #viewport{cursor:grab;touch-action:none;outline:none}
  #viewport.dragging{cursor:grabbing}
  .focus-ring{stroke:transparent;fill:none}
  svg:not(.pointer-input) #viewport:focus-visible .focus-ring{stroke:var(--ve-pencil);stroke-width:1.3}
</style>


<g transform="translate(90 0)">
<text id="heading" x="64" y="80" class="heading">Геометрия тензора</text>
<g id="tensor-matrix" aria-label="Матрица тензора в главном базисе">
  <text x="694" y="85" font-family="inherit" font-style="italic" font-size="28">T =</text>
  <path d="M748 32 H737 V123 H748 M922 32 H933 V123 H922" fill="none" stroke="var(--ve-pencil)" stroke-width="1.4"/>
  ${matrix}
</g>
<g id="viewport" tabindex="0" role="group" aria-label="Объёмная сцена: единичная сфера и её образ.">
  <rect x="35" y="153" width="1030" height="427" fill="transparent"/>
  <path id="viewport-focus" d="M525 596Q550 598 575 596" class="focus-ring" stroke-linecap="round"/>
  <g id="orbit-world"><g id="geometry">${geometry}</g>
  <g id="mapping" fill="none" stroke="var(--ve-pencil)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M470 353 H558 l-8 -6 m8 6 -8 6"/></g>
  <text id="mapping-label" x="514" y="328" text-anchor="middle" font-size="26" font-family="inherit" font-style="italic">T</text>
</g>
<g id="annotations"></g>
<text id="sphere-label" x="250" y="570" class="label">Единичная сфера</text>
<text id="tensor-label" x="775" y="570" class="label">Образ сферы</text>
</g>
<text id="control-label" x="550" y="637" font-size="21" text-anchor="middle">Преобразование</text>
${svgRange({ id: 'tensor-control', x: 373, y: 652, width: 354, value: 1, label: 'Преобразование от единичного тензора до T' })}
</g>

<script><![CDATA[
${sharedRuntime}
const {SvgOrbit,mountScene,SvgLayout}=VisualStory;
${tensorScene.toString()}
${script}
]]></script>
</svg>`;
const output = resolve(
  process.env.VISUAL_STORY_OUTPUT ?? new URL('.', import.meta.url).pathname,
  'geometric-tensor.svg',
);
await writeFile(output, svg);
execFileSync(process.env.VISUAL_STORY_PYTHON ?? 'python3', [
  `${process.env.VISUAL_STORY_TOOLS ?? new URL('../../tools', import.meta.url).pathname}/svg_style.py`,
  output,
]);
console.log('Created geometric-tensor.svg');
