import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const tools = process.env.VISUAL_STORY_TOOLS ?? new URL('../../../tools', import.meta.url).pathname;
const { svgRuntime } = await import(pathToFileURL(resolve(tools, 'svg-runtime.mjs')));
const runtime = await svgRuntime({ '': ['mountScene', 'SvgLayout'], '/three': ['SvgOrbit'] });
const script = `
const {mountScene,SvgLayout,SvgOrbit}=VisualStory;
const root=document.querySelector('svg'), viewport=document.querySelector('#viewport'),
  world=document.querySelector('#orbit-world'), labels=document.querySelector('#annotations'),
  aperture=viewport.querySelector('rect'), slider=document.querySelector('input');
const lifetime=new AbortController();
let t=1,yaw=.58,pitch=.34;
const overflow=SvgLayout.overflow(labels,{region:aperture});
const anchors=Array.from({length:5},(_,i)=>{
  const text=SvgLayout.element('text',{id:'label-'+i,'font-size':24,'data-review-id':'label-'+i});
  text.textContent=['Вход','Связь','Результат','Длина','Направление'][i];
  const anchor=SvgLayout.element('circle',{r:.01,fill:'none'});
  const leader=SvgLayout.element('path',{'data-label-for':'label-'+i,fill:'none',stroke:'var(--ve-ink)','stroke-width':1});
  labels.append(anchor,leader,text);return{text,anchor,leader};
});
function draw(){
  const matrix=labels.getCTM().inverse().multiply(world.getCTM());
  const point=(x,y)=>new DOMPoint(x,y).matrixTransform(matrix);
  const avoid=[overflow.reserve(),document.querySelector('#body-surface')];
  for(const [i,item] of anchors.entries()){
    const x=180+i*180+20*Math.sin(yaw), y=290+(i%2)*40+20*Math.sin(pitch);
    const a=point(x,y), b=point(x,y-70-15*t);
    item.anchor.setAttribute('cx',a.x);item.anchor.setAttribute('cy',a.y);
    const placed=SvgLayout.along(item.text,{start:a,end:b,width:1},{space:labels,region:aperture,at:1,offset:-24,gap:6,avoid});
    item.leader.setAttribute('visibility',placed.status==='placed'?'visible':'hidden');
    if(placed.status==='placed'){
      const link=SvgLayout.connect(item.anchor,item.text,{space:labels,gap:3,route:'straight'});
      item.leader.setAttribute('d',link.d);avoid.push(item.text,link);
    }
  }
  overflow.update(anchors.filter(({text})=>text.dataset.layoutStatus==='overflow').map(({text})=>({id:text.id,label:text.textContent,subject:'Измеряемый предмет'})));
  slider.value=t;document.querySelector('#value').textContent=t.toFixed(2);
}
const orbit=SvgOrbit.mount(root,viewport,world,{yaw,pitch,pitchLimits:[-.75,.75],changed(pose){yaw=pose.yaw;pitch=pose.pitch;draw();}});
const set=(values)=>{if(values.t!==undefined){t=Math.max(0,Math.min(1,values.t));draw();}};
slider.addEventListener('input',()=>set({t:slider.valueAsNumber}),{signal:lifetime.signal});
mountScene(root,{camera:orbit,svg:()=>root,snapshot:()=>({t,view:orbit.pose}),dispose(){lifetime.abort();overflow.dispose();orbit.dispose();}},
  {parameters:[{key:'t',label:'Условие',type:'range',value:1,min:0,max:1,step:.02}],values:()=>({t}),setValues:set});
window.galleryReady=document.fonts.ready.then(draw);
`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<title>SVG owner fixture</title><style>text{fill:var(--ve-ink);font-family:inherit} [data-layout-status='overflow']{visibility:hidden} #viewport{touch-action:none;cursor:grab}</style>
<g id="viewport" tabindex="0" role="group" aria-label="Предметная камера"><rect x="30" y="100" width="1220" height="460" fill="transparent"/>
<g id="orbit-world"><rect id="body-surface" x="160" y="260" width="840" height="200" fill="var(--ve-blue-wash)" stroke="var(--ve-ink)"/>
<circle cx="250" cy="340" r="20" fill="var(--ve-orange)"><animate attributeName="cx" values="250;850;250" dur="4s" repeatCount="indefinite"/></circle></g><g id="annotations"/></g>
<text id="value" x="1050" y="625" font-size="28">1.00</text>
<foreignObject x="350" y="580" width="500" height="70"><div xmlns="http://www.w3.org/1999/xhtml"><label>Условие<input id="condition" type="range" min="0" max="1" step=".02" value="1"/></label></div></foreignObject>
<script><![CDATA[${runtime}\n${script}]]></script></svg>`;
const output = resolve(process.env.VISUAL_STORY_OUTPUT ?? '.', 'subject.svg');
await writeFile(output, svg);
execFileSync(process.env.VISUAL_STORY_PYTHON ?? 'python3', [
  resolve(tools, 'svg_style.py'),
  output,
]);
