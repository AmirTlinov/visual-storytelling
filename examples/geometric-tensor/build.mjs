import { resolve } from 'node:path';
import {svgRange} from '@visual-storytelling/core/controls';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';

// One geometry implementation creates both the saved SVG and its live updates.
import { pathToFileURL } from 'node:url';
const { svgRuntime } = await import(pathToFileURL(`${process.env.VISUAL_STORY_TOOLS ?? new URL('../../tools',import.meta.url).pathname}/svg-runtime.mjs`));
const sharedRuntime = await svgRuntime({'':['mountScene'],'/three':['SvgOrbit'], '/controls':['fitSvgControls']});

function tensorScene(t,yaw,pitch) {
  const c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const rotate=([x,y,z])=>[c*x+s*z,cp*y+sp*(-s*x+c*z),-sp*y+cp*(-s*x+c*z)];
  const axes=[1+.85*t,1,1-.48*t],parts=[];
  const scale=120,fmt=n=>Number(n.toFixed(3));
  const spherePoint=(a,b)=>[Math.cos(b)*Math.cos(a),Math.sin(b),Math.cos(b)*Math.sin(a)];
  function body(radii,cx,theme) {
    const [rx,ry,rz]=radii,cy=354;
    const part=(id,tag,attrs,text)=>parts.push({id:theme+'-'+id,tag,attrs,text});
    const project=p=>{const q=rotate(p.map((v,i)=>v*radii[i]));return[cx+scale*q[0],cy-scale*q[1],q[2]]};
    const normal=p=>rotate(p.map((v,i)=>v/radii[i]))[2];
    const columns=[[rx,0,0],[0,ry,0],[0,0,rz]].map(rotate);
    const q00=columns.reduce((a,v)=>a+v[0]*v[0],0)*scale*scale;
    const q01=-columns.reduce((a,v)=>a+v[0]*v[1],0)*scale*scale;
    const q11=columns.reduce((a,v)=>a+v[1]*v[1],0)*scale*scale;
    const d=Math.hypot(q00-q11,2*q01);
    const a=Math.sqrt((q00+q11+d)/2),b=Math.sqrt((q00+q11-d)/2);
    const angle=d<1e-10*(q00+q11)?0:Math.atan2(2*q01,q00-q11)*90/Math.PI;
    // An exact projected ellipse, without rotating its paint coordinate system.
    // sqrt(Q) gives a continuous starting point even at repeated eigenvalues.
    const det=Math.sqrt(Math.max(0,q00*q11-q01*q01));
    const denominator=Math.sqrt(q00+q11+2*det);
    const dx=(q00+det)/denominator,dy=q01/denominator;
    const first=fmt(cx+dx)+','+fmt(cy+dy),opposite=fmt(cx-dx)+','+fmt(cy-dy);
    const arc='A'+fmt(a)+','+fmt(b)+' '+fmt(angle)+' 0 1 ';
    part('surface','path',{d:'M'+first+' '+arc+opposite+' '+arc+first+' Z',
      fill:'color-mix(in srgb,var(--ve-'+(theme==='sphere'?'blue':'purple')+') 12%,var(--ve-surface))',stroke:theme==='sphere'?'var(--ve-blue)':'var(--ve-purple)','stroke-width':1.1});
    function curve(points) {
      let path='',drawing=false;
      for(const p of points) {
        const q=project(p),front=normal(p)>=0;
        if(front)path+=(drawing?' L':' M')+fmt(q[0])+','+fmt(q[1]);
        drawing=front;
      }
      return path;
    }
    const grid=[];
    for(let k=1;k<8;k++) {
      const b=-Math.PI/2+k*Math.PI/8;
      grid.push(curve(Array.from({length:145},(_,j)=>spherePoint(j*Math.PI/72,b))));
    }
    for(let k=0;k<16;k++)grid.push(curve(Array.from({length:97},(_,j)=>spherePoint(k*Math.PI/8,-Math.PI/2+j*Math.PI/96))));
    grid.forEach((d,i)=>part('grid-'+i,'path',{d,fill:'none',stroke:theme==='sphere'?'var(--ve-blue)':'var(--ve-purple)',
      'stroke-width':1,opacity:.7,'stroke-linecap':'round','stroke-linejoin':'round'}));
    const basis=[[1,0,0],[0,1,0],[0,0,1]];
    for(let k=0;k<3;k++) {
      const p=basis[k],n=project(p.map(v=>-1.18*v)),e=project(p.map(v=>1.18*v));
      const back=rotate(p)[2]<0;
      part('axis-'+k+'-negative','path',{d:'M'+fmt(n[0])+','+fmt(n[1])+' L'+cx+','+cy,
        fill:'none',stroke:'var(--ve-pencil)','stroke-width':1,'stroke-dasharray':back?'none':'3 6',opacity:.6});
      part('axis-'+k+'-positive','path',{d:'M'+cx+','+cy+' L'+fmt(e[0])+','+fmt(e[1]),
        fill:'none',stroke:'var(--ve-pencil)','stroke-width':1.1,'stroke-dasharray':back?'3 6':'none',opacity:.7});
      if(theme==='tensor') {
        const end=project(p.map(v=>1.26*v));
        const dx=end[0]-cx,dy=end[1]-cy,length=Math.hypot(dx,dy)||1;
        end[0]-=12*dy/length;end[1]+=12*dx/length;
        part('axis-'+k+'-label','text',{x:fmt(end[0]),y:fmt(end[1]+6),'text-anchor':'middle',class:'axis'},
          'e<tspan baseline-shift="sub" font-size="13">'+(k+1)+'</tspan>');
      }
    }
    const v=[.56,.76,.3298484500494128];
    const end=project(v),dxv=end[0]-cx,dyv=end[1]-cy,len=Math.hypot(dxv,dyv);
    const ux=dxv/Math.max(len,1e-12),uy=dyv/Math.max(len,1e-12);
    const headLength=Math.min(12,len),headWidth=Math.min(4.5,len/3);
    part('vector','path',{d:'M'+cx+','+cy+' L'+fmt(end[0]-headLength*.67*ux)+','+fmt(end[1]-headLength*.67*uy),
      fill:'none',stroke:'var(--ve-orange)','stroke-width':2.7});
    part('vector-head','polygon',{points:fmt(end[0])+','+fmt(end[1])+' '+
      fmt(end[0]-headLength*ux+headWidth*uy)+','+fmt(end[1]-headLength*uy-headWidth*ux)+' '+
      fmt(end[0]-headLength*ux-headWidth*uy)+','+fmt(end[1]-headLength*uy+headWidth*ux),fill:'var(--ve-orange)'});
    part('origin','circle',{cx,cy,r:3,fill:'var(--ve-orange)'});
    part('vector-label','text',{x:fmt(end[0]+13),y:fmt(end[1]-10),class:'vector'},theme==='sphere'?'v':'Tv');
  }
  body([1,1,1],250,'sphere');body(axes,775,'tensor');
  return {parts,axes};
}

const initial={t:1,yaw:.58,pitch:.34};
const scene=tensorScene(initial.t,initial.yaw,initial.pitch);
const geometry=['sphere','tensor'].map(theme=>`<g id="${theme}-geometry">${scene.parts.filter(p=>p.id.startsWith(theme+'-')).map(p=>
  `<${p.tag} id="${p.id}" ${Object.entries(p.attrs).map(([key,value])=>`${key}="${value}"`).join(' ')}>${p.text??''}</${p.tag}>`).join('')}</g>`).join('');
const matrix=scene.axes.map((v,i)=>`<text id="eigen-${i}" x="${773+i*62}" y="${53+i*30}" class="matrix">${v.toFixed(2)}</text>`).join('')+
[[0,1],[0,2],[1,0],[1,2],[2,0],[2,1]].map(([i,j])=>`<text x="${773+j*62}" y="${53+i*30}" class="matrix zero">0</text>`).join('');
const script=String.raw`
(()=>{
  'use strict';
  const root=document.querySelector('svg.ve-scene'),byID=id=>document.getElementById(id);
  const lifetime=new AbortController(),listen={signal:lifetime.signal};
  const viewport=byID('viewport'),slider=byID('tensor-control-input');
  root.addEventListener('pointerdown',()=>root.classList.add('pointer-input'),{...listen,capture:true});
  root.addEventListener('keydown',()=>root.classList.remove('pointer-input'),{...listen,capture:true});
  let t=1,yaw=.58,pitch=.34;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const format=x=>x.toFixed(2);
  const nodes=new Map(Array.from(byID('geometry').querySelectorAll('[id]'),node=>[node.id,node]));
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
  }
  function layout(){
    const narrow=innerWidth<600;
    root.setAttribute('viewBox',narrow?'0 0 550 1240':'0 0 1100 760');
    const transforms={'heading':narrow?'translate(211 -32)':'','tensor-matrix':narrow?'translate(-565 62)':'','sphere-geometry':narrow?'translate(25 0)':'','tensor-geometry':narrow?'translate(-500 472)':'','sphere-label':narrow?'translate(25 -25)':'','tensor-label':narrow?'translate(-500 472)':'','tensor-control':narrow?'translate(-275 430)':'','control-label':narrow?'translate(-275 440)':'','mapping-label':narrow?'translate(-204 286)':''};
    for(const [id,transform] of Object.entries(transforms))byID(id).setAttribute('transform',transform);
    byID('heading').setAttribute('text-anchor',narrow?'middle':'start');
    byID('viewport').querySelector('rect').setAttribute('height',narrow?900:427);
    byID('viewport').querySelector('rect').setAttribute('width',narrow?500:1030);
    byID('mapping').querySelector('path').setAttribute('d',narrow?'M275 578V636l-6 -8m6 8 6-8':'M470 353H558l-8 -6m8 6-8 6');
    byID('viewport-focus').setAttribute('d',narrow?'M250 1056Q275 1058 300 1056':'M525 596Q550 598 575 596');
    fitSvgControls(root);
  }
  addEventListener('resize',layout,listen);layout();
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
    dispose(){lifetime.abort();orbit.dispose();}
  },{
    parameters:[{key:'t',label:'Преобразование',type:'range',value:1,min:0,max:1,step:.02}],
    values:()=>({t}),
    setValues:values=>setT(values.t)
  });
})();`;

const svg=`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="760" viewBox="0 0 1100 760" role="group" aria-labelledby="title desc">
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
  .label{font-size:23px;text-anchor:middle}
  #viewport{cursor:grab;touch-action:none;outline:none}
  #viewport.dragging{cursor:grabbing}
  .focus-ring{stroke:transparent;fill:none}
  svg:not(.pointer-input) #viewport:focus-visible .focus-ring{stroke:var(--ve-pencil);stroke-width:1.3}
</style>


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
<text id="sphere-label" x="250" y="570" class="label">Единичная сфера</text>
<text id="tensor-label" x="775" y="570" class="label">Образ сферы</text>
</g>
<text id="control-label" x="550" y="637" font-size="21" text-anchor="middle">Преобразование</text>
${svgRange({id:'tensor-control', x:373, y:652, width:354, value:1, label:'Преобразование от единичного тензора до T'})}

<script><![CDATA[
${sharedRuntime}
const {SvgOrbit,fitSvgControls,mountScene}=VisualStory;
${tensorScene.toString()}
${script}
]]></script>
</svg>`;
const output = resolve(process.env.VISUAL_STORY_OUTPUT ?? new URL('.',import.meta.url).pathname, 'geometric-tensor.svg');
await writeFile(output,svg);
execFileSync(process.env.VISUAL_STORY_PYTHON ?? 'python3', [`${process.env.VISUAL_STORY_TOOLS ?? new URL('../../tools',import.meta.url).pathname}/svg_style.py`, output]);
console.log('Created geometric-tensor.svg');
