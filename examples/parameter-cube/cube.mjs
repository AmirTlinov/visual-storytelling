import {svgRange, fitSvgControls} from '@visual-storytelling/core/controls';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {SketchInk} from '@visual-storytelling/core/ink';
import {build} from 'esbuild';
const {inkShape, inkBox, markerDefs, markerMarkup} = SketchInk;
const bundledInk = await build({stdin:{contents:`import {SketchInk} from ${JSON.stringify(`${process.env.VISUAL_STORY_TOOLS ?? new URL('../../tools',import.meta.url).pathname}/../dist/ink/marks.js`)};globalThis.SketchInk=SketchInk;`,resolveDir:new URL('./',import.meta.url).pathname},bundle:true,format:'iife',write:false,target:'es2022'});
const inkRuntime = bundledInk.outputFiles[0].text;
const initial=JSON.parse(await readFile(new URL('projection.json',import.meta.url),'utf8'));
if(initial.model!=='prajjwal1/bert-mini'||initial.total_heads!==4)throw Error('Generate the BERT-mini snapshot with projection.py --snapshot first.');
const parameters=initial.parameters;
const start={spread:0,yaw:-.64,pitch:-.48,selected:'1-2-0',token:1};

function escapeXML(text){return String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}

function weightColor(value,limit,surface='var(--ve-surface)'){const amount=52*Math.min(1,Math.abs(value)/limit);return 'color-mix(in srgb,var(--ve-'+(value<0?'orange':'blue')+') '+amount+'%,'+surface+')';}
function componentLabel(key,parameters){
  const [i,j,h]=key.split('-').map(Number);
  return 'W_Q['+[i+1,j+1,h+1].join(',')+'] = '+parameters.values[h][i][j].toFixed(6);
}
function cubeScene(data,spread,yaw,pitch,selected,mirror=false){
  const n=4,c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const nx=Math.cos(-.64),nz=Math.sin(-.64);
  const rotate=([x,y,z])=>{
    if(mirror){const distance=nx*x+nz*z;x-=2*nx*distance;z-=2*nz*distance;}
    return[c*x+s*z,cp*y+sp*(-s*x+c*z),-sp*y+cp*(-s*x+c*z)];
  };
  const fmt=n=>Number(n.toFixed(3)),half=(mirror?1:.94)/2,scale=62;
  const vertices=[[-1,-1,-1],[-1,-1,1],[-1,1,-1],[-1,1,1],[1,-1,-1],[1,-1,1],[1,1,-1],[1,1,1]].map(v=>rotate(v.map(x=>x*half)));
  const faces=[{n:[-1,0,0],v:[0,1,3,2]},{n:[1,0,0],v:[4,6,7,5]},{n:[0,-1,0],v:[0,4,5,1]},{n:[0,1,0],v:[2,3,7,6]},{n:[0,0,-1],v:[0,2,6,4]},{n:[0,0,1],v:[1,5,7,3]}];
  const visible=faces.map(face=>rotate(face.n)[2]>1e-9);
  const cells=[];
  for(let i=0;i<n;i++)for(let j=0;j<n;j++)for(let h=0;h<4;h++){
    const key=[i,j,h].join('-'),center=rotate([i-(n-1)/2,j-(n-1)/2,(h-1.5)*(1+.85*(mirror?0:spread))]);
    const active=key===selected,base=weightColor(data.values[h][i][j],data.color_limit);
    const points=vertices.map(v=>[fmt(550+scale*(center[0]+v[0])),fmt(396-scale*(center[1]+v[1]))]);
    cells.push({key,depth:center[2],active,faces:faces.map((face,f)=>visible[f]?{
      d:inkShape(face.v.map(v=>points[v]),i*16+j*4+h+f),display:'inline',fill:base,
      stroke:active?'var(--ve-purple)':'var(--ve-pencil)','stroke-width':active?1.8:1.05,
      'fill-opacity':mirror?(active?.28:.07):1,'stroke-opacity':mirror?(active?1:.6):1
    }:{display:'none'})});
  }
  return cells.sort((a,b)=>a.depth-b.depth||a.key.localeCompare(b.key));
}
function geometryMarkup(data,start,mirror){
  return cubeScene(data,start.spread,start.yaw,start.pitch,start.selected,mirror).map(cell=>
    '<g data-cell="'+cell.key+'">'+cell.faces.map(face=>'<path data-cell="'+cell.key+'" stroke-linejoin="round" vector-effect="non-scaling-stroke" '+Object.entries(face).map(([name,value])=>name+'="'+value+'"').join(' ')+'/>').join('')+'</g>').join('');
}
function matricesMarkup(parameters,selected){
  return parameters.values.map((matrix,h)=>{
    const entries=matrix.map((row,i)=>row.map((value,j)=>{
      const key=[i,j,h].join('-');
      return '<g id="entry-'+key+'" class="entry" data-cell="'+key+'" role="option" aria-selected="'+(key===selected)+'" aria-label="'+escapeXML(componentLabel(key,parameters))+'" transform="translate('+(56+j*96)+' '+(940+i*48)+')"><title>'+escapeXML(componentLabel(key,parameters))+'</title><path class="selection-outline" fill="'+weightColor(value,parameters.color_limit,'transparent')+'" d="'+inkBox(-44,-29,88,42,h*16+i*4+j)+'"/><text text-anchor="middle" font-size="21" style="fill:var(--ve-ink)">'+value.toFixed(3)+'</text></g>';
    }).join('')).join('');
    return '<g role="group" aria-label="Голова '+(h+1)+'" transform="translate('+(100+(h%2)*500)+' '+(Math.floor(h/2)*260)+')"><text x="200" y="888" class="head-label" text-anchor="middle">h = '+(h+1)+'</text><path d="M5 906Q0 905 0 911Q-.8 1001 0 1095Q0 1101 5 1100 M395 906Q400 905 400 911Q400.8 1002 400 1095Q400 1101 395 1100" fill="none" stroke="var(--ve-pencil)" stroke-width="1.2"/>'+entries+'</g>';
  }).join('');
}
function tokenMarkup(data,active){
  const step=972/data.tokens.length;
  return data.tokens.map((token,index)=>{
    return '<g id="token-'+index+'" data-token="'+index+'" role="option" aria-selected="'+(index===active)+'" aria-label="Токен '+(index+1)+': '+escapeXML(token)+'" transform="translate('+(64+(index+.5)*step)+' 1242)"><path class="selection-outline" d="'+inkBox(-step/2+4,-30,step-8,43,index)+'"/><text text-anchor="middle" font-size="'+Math.min(23,step/(token.length*.6))+'">'+escapeXML(token)+'</text></g>';
  }).join('');
}
function vectorMarkup(data,selected,token){
  const [i,j,h]=selected.split('-').map(Number);
  const vectors=[{name:'x[1:4]',values:data.inputs[token],active:i,left:84},{name:'q'+'₁₂₃₄'[h]+'[1:4]',values:data.queries[h][token],active:j,left:646}];
  return vectors.map(vector=>'<g><text x="'+(vector.left+200)+'" y="1320" class="vector-name" text-anchor="middle">'+vector.name+'</text>'+vector.values.map((value,k)=>'<g transform="translate('+(vector.left+50+100*k)+' 1370)"><path d="'+inkBox(-46,-33,92,48,k)+'" fill="'+(k===vector.active?'var(--ve-blue-wash)':'none')+'" stroke="'+(k===vector.active?'var(--ve-blue)':'none')+'" stroke-width="1.5"/><text text-anchor="middle" font-size="22">'+value.toFixed(3)+'</text></g>').join('')+'</g>').join('')+'<path d="M514 1359H596M587 1352L596 1359L587 1366" fill="none" stroke="var(--ve-pencil)" stroke-width="1.8"/>';
}
const runtime=String.raw`
(()=>{
  'use strict';
  const root=document.querySelector('svg.ve-scene'),byID=id=>document.getElementById(id);
  const stage=byID('stage'),slider=byID('layers-input'),notation=byID('notation'),tokens=byID('tokens');
  let data=${JSON.stringify(initial).replace(/</g,'\\u003c')};
  const parameters=data.parameters;
  let {spread,yaw,pitch,selected,token}=${JSON.stringify(start)},pending=0,drag=null;
  let displayedSelection=selected;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const point=e=>{const p=root.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(root.getScreenCTM().inverse());};
  const attr=(node,name,value)=>{const v=String(value);if(node.getAttribute(name)!==v)node.setAttribute(name,v)};
  const text=(id,value)=>{const node=byID(id);if(node.textContent!==value)node.textContent=value};
  const views=['cells','mirror'].map((id,i)=>{
    const scene=byID(id);return{scene,mirror:i===1,cells:new Map(Array.from(scene.children,node=>[node.dataset.cell,{node,faces:Array.from(node.children)}]))};
  });
  function updateVectors(){
    byID('vectors').innerHTML=vectorMarkup(data,selected,token);
    data.tokens.forEach((_,index)=>attr(byID('token-'+index),'aria-selected',index===token));
    attr(tokens,'aria-activedescendant','token-'+token);
    text('flow-token','Вход и выход: '+data.tokens[token]);layout();
  }
  function updateSelection(){
    text('component-value',componentLabel(selected,parameters).slice(3));
    attr(byID('component'),'aria-label',componentLabel(selected,parameters));
    attr(byID('entry-'+displayedSelection),'aria-selected','false');
    attr(byID('entry-'+selected),'aria-selected','true');
    attr(notation,'aria-activedescendant','entry-'+selected);
    displayedSelection=selected;updateVectors();
  }
  function draw(){
    pending=0;
    for(const view of views){
      const geometry=cubeScene(parameters,spread,yaw,pitch,selected,view.mirror);
      let cursor=view.scene.firstElementChild;
      for(const cell of geometry){
        const cached=view.cells.get(cell.key);
        cell.faces.forEach((face,i)=>{for(const [name,value] of Object.entries(face))attr(cached.faces[i],name,value)});
        if(cached.node!==cursor)view.scene.insertBefore(cached.node,cursor);
        cursor=cached.node.nextElementSibling;
      }
    }
    if(displayedSelection!==selected)updateSelection();
    slider.value=spread;
  }
  function layout(){
    const small=innerWidth<650;
    attr(root,'viewBox',small?'0 0 550 3860':'0 0 1100 1770');
    root.style.aspectRatio=small?'550 / 3860':'1100 / 1770';
    const positions={heading:[small?24:64,small?42:60],component:[small?275:1036,small?91:60],'shape-note':[small?24:64,small?136:108],'layers-label':[small?275:295,small?634:694],'notation-label':[small?275:550,small?1340:818],'indices-label':[small?275:550,small?1380:853],'flow-token':[small?24:64,1170],'projection-formula':[small?275:1036,small?1220:1170],'projection-note':[small?275:550,small?1770:1430]};
    for(const [id,[x,y]] of Object.entries(positions)){attr(byID(id),'x',x);attr(byID(id),'y',y);}
    attr(byID('component'),'text-anchor',small?'middle':'end');
    attr(byID('projection-formula'),'text-anchor',small?'middle':'end');
    attr(byID('shape-note'),'font-size',small?18:21);
    attr(byID('indices-label'),'font-size',small?17:19);
    attr(byID('projection-note'),'font-size',small?19:21);
    byID('projection-note').innerHTML=small?'<tspan x="275">Полная проекция: 256 компонент + b.</tspan><tspan x="275" dy="29">На рисунке первые четыре.</tspan>':'Расчёт использует все 256 компонент и смещение b; показаны первые четыре.';
    const transforms={cells:small?'translate(-275 0)':'translate(-255 0)',mirror:small?'translate(-275 504)':'translate(255 0)',layers:small?'translate(-20 -60)':'','color-key':small?'translate(-530 520)':'','activation-region':small?'translate(0 2000)':'translate(0 300)'};
    for(const [id,value] of Object.entries(transforms))attr(byID(id),'transform',value);
    Array.from(notation.children).forEach((node,h)=>attr(node,'transform',small?'translate(35 '+(376.4+h*420)+') scale(1.2)':'translate('+(100+(h%2)*500)+' '+(Math.floor(h/2)*260)+')'));
    attr(stage.querySelector('rect'),'height',small?1015:512);attr(stage.querySelector('rect'),'width',small?490:1016);
    attr(byID('stage-focus'),'d',small?'M250 1170 Q275 1172 300 1170':'M525 658 Q550 660 575 658');
    if(small){
      Array.from(tokens.children).forEach((node,i)=>attr(node,'transform','translate('+(82+(i%4)*128)+' '+(1300+Math.floor(i/4)*64)+')'));
      Array.from(tokens.children).forEach((node,i)=>{attr(node.querySelector('.selection-outline'),'d',inkBox(-59,-30,118,43,i));});
      Array.from(tokens.querySelectorAll('text')).forEach(node=>attr(node,'font-size',19));
      const vectors=Array.from(byID('vectors').children);
      attr(vectors[0],'transform','translate(-9 160)');attr(vectors[1],'transform','translate(-571 300)');
      attr(vectors[2],'d','M275 1560V1580m-6 -8 6 8 6-8');
    }
    fitSvgControls(root);
  }
  addEventListener('resize',()=>{tokens.innerHTML=tokenMarkup(data,token);updateVectors();layout();});layout();
  function invalidate(){if(!pending)pending=requestAnimationFrame(draw)}
  function setSpread(value){spread=clamp(value,0,1);invalidate()}
  window.getProjection=()=>data;
  window.setPending=value=>byID('activation-region').classList.toggle('pending',value);
  window.setProjection=next=>{
    if(next.parameters.sha256!==parameters.sha256)throw Error('Параметры модели изменились. Перезагрузите пример.');
    data=next;window.setPending(false);token=Math.min(token,data.tokens.length-1);
    tokens.innerHTML=tokenMarkup(data,token);updateVectors();
    text('provenance',JSON.stringify({model:data.model,revision:data.revision,layer:data.layer,text:data.text,parameter_sha256:parameters.sha256,full_shape:parameters.shape,visible_shape:parameters.visible_shape}));
    // New text owns only activations. It does not touch cube geometry,
    // camera, coefficients, color scale, matrix nodes or selection.
  };
  root.addEventListener('pointerdown',()=>root.classList.add('pointer-input'),true);
  root.addEventListener('keydown',()=>root.classList.remove('pointer-input'),true);
  stage.addEventListener('pointerdown',e=>{
    if(e.button!==0||drag)return;
    e.preventDefault();stage.focus({preventScroll:true});stage.setPointerCapture(e.pointerId);
    const p=point(e);drag={id:e.pointerId,x:p.x,y:p.y,yaw,pitch,moved:false,cell:e.target.dataset.cell};
  });
  slider.addEventListener('input',()=>setSpread(slider.valueAsNumber));
  root.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const p=point(e);
    if(drag.moved||Math.hypot(p.x-drag.x,p.y-drag.y)>3){
      drag.moved=true;stage.classList.add('dragging');yaw=drag.yaw+(p.x-drag.x)*.008;
      pitch=clamp(drag.pitch-(p.y-drag.y)*.008,-1.25,1.25);invalidate();
    }
  });
  function release(e){
    if(!drag||e.pointerId!==drag.id)return;
    if(e.type==='pointerup'&&!drag.moved&&drag.cell){selected=drag.cell;invalidate()}
    drag=null;stage.classList.remove('dragging');
  }
  for(const event of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(event,release);
  notation.addEventListener('click',e=>{
    const entry=e.target.closest('[data-cell]');if(!entry)return;
    selected=entry.dataset.cell;notation.focus({preventScroll:true});invalidate();
  });
  notation.addEventListener('keydown',e=>{
    const moves={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[1,-1],ArrowRight:[1,1],PageUp:[2,-1],PageDown:[2,1]};
    const move=moves[e.key];if(!move)return;e.preventDefault();
    const indices=selected.split('-').map(Number);indices[move[0]]=clamp(indices[move[0]]+move[1],0,3);
    selected=indices.join('-');invalidate();
  });
  tokens.addEventListener('click',e=>{
    const item=e.target.closest('[data-token]');if(!item)return;
    token=Number(item.dataset.token);tokens.focus({preventScroll:true});updateVectors();
  });
  tokens.addEventListener('keydown',e=>{
    if(e.key==='ArrowLeft')token=Math.max(0,token-1);else if(e.key==='ArrowRight')token=Math.min(data.tokens.length-1,token+1);
    else if(e.key==='Home')token=0;else if(e.key==='End')token=data.tokens.length-1;else return;
    e.preventDefault();updateVectors();
  });
  stage.addEventListener('keydown',e=>{
    if(e.key==='ArrowLeft')yaw-=.1;else if(e.key==='ArrowRight')yaw+=.1;
    else if(e.key==='ArrowUp')pitch=clamp(pitch+.1,-1.25,1.25);else if(e.key==='ArrowDown')pitch=clamp(pitch-.1,-1.25,1.25);
    else if(e.key==='Home'){yaw=-.64;pitch=-.48;}
    else if(['i','j','h'].includes(e.key.toLowerCase())){
      const axis='ijh'.indexOf(e.key.toLowerCase()),indices=selected.split('-').map(Number);
      indices[axis]=(indices[axis]+(e.shiftKey?3:1))%4;selected=indices.join('-');
    } else return;e.preventDefault();invalidate();
  });
})();`;
const height=1770,limit=parameters.color_limit;
const svg=`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${height}" viewBox="0 0 1100 ${height}" role="group" aria-labelledby="title desc">
<title id="title">Постоянные параметры и переменные активации BERT-mini</title>
<desc id="desc">Куб показывает реальные обученные коэффициенты проекции запросов W_Q четвёртого слоя BERT-mini: первые четыре входные и первые четыре выходные компоненты каждой из четырёх голов. Показаны 64 коэффициента из 65536, не вся модель. Полная форма в выбранной записи: вход 256, выход на голову 64, головы 4. При смене текста параметры, размер и цвет куба не меняются. Справа — прозрачное отражение того же фрагмента без зазоров, не выходной тензор. Внизу показаны первые четыре компоненты входного вектора x выбранного токена на входе в четвёртый слой и первые четыре компоненты его выходного запроса q для выбранной головы. Выход получен полной проекцией всех 256 компонент со смещением, а не только изображённым фрагментом. Выбор коэффициента выделяет соответствующие входную и выходную компоненты. Числа вектора изменяются при смене текста, токена и выбранной головы. Стрелки вращают сцену, I, J, H меняют координату. В матрицах стрелки выбирают строку и столбец, PageUp и PageDown — голову. В токенах — стрелки влево и вправо. Ползунок раздвигает только основную модель для осмотра. Для пересчёта текста откройте cube.html. SVG самодостаточен для просмотра вычисленного снимка.</desc>
<metadata id="provenance">${escapeXML(JSON.stringify({model:initial.model,revision:initial.revision,layer:initial.layer,text:initial.text,parameter_sha256:parameters.sha256,full_shape:parameters.shape,visible_shape:parameters.visible_shape}))}</metadata>
${markerDefs('bert-ink')}
<defs><linearGradient id="weight-scale"><stop stop-color="var(--ve-orange)" stop-opacity=".52"/><stop offset=".5" stop-color="var(--ve-orange)" stop-opacity="0"/><stop offset=".5" stop-color="var(--ve-blue)" stop-opacity="0"/><stop offset="1" stop-color="var(--ve-blue)" stop-opacity=".52"/></linearGradient></defs>
<style>
svg{width:100%;height:auto;display:block;aspect-ratio:1100/1770;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;background-image:var(--ve-grid);background-size:30px 30px}text{font-family:inherit;fill:var(--ve-ink)}
svg:focus,[tabindex]:focus{outline:none}
.heading{font-size:32px;font-weight:400}#component{font-size:23px;font-variant-numeric:tabular-nums;fill:var(--ve-purple)}
.math,.head-label{font-family:inherit;font-size:27px}.vector-name{font-size:23px;font-family:inherit}
.entry{cursor:pointer}.entry text{font-variant-numeric:tabular-nums;pointer-events:none;fill:inherit}.entry>.selection-outline{stroke:transparent;stroke-width:1.4px;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.entry:hover>.selection-outline{stroke:var(--ve-pencil)}.entry[aria-selected="true"]>.selection-outline{stroke:var(--ve-purple)}
#notation,#tokens{outline:none}#notation:focus-visible .entry[aria-selected="true"]>.selection-outline{stroke:var(--ve-purple);stroke-dasharray:3 2}
#tokens [data-token]{cursor:pointer}#tokens .selection-outline{pointer-events:all;fill:none;stroke:transparent;stroke-width:1.3;stroke-linejoin:round}#tokens text{pointer-events:none}
#tokens [aria-selected="true"] .selection-outline{fill:var(--ve-blue-wash)}#tokens [data-token]:hover .selection-outline{stroke:var(--ve-pencil)}#tokens:focus-visible [aria-selected="true"] .selection-outline{stroke:var(--ve-blue)}
#stage{cursor:grab;touch-action:none;outline:none}#stage.dragging{cursor:grabbing}
.focus-ring{fill:none;stroke:transparent}svg:not(.pointer-input) #stage:focus-visible .focus-ring{stroke:var(--ve-pencil);stroke-width:2}
#vectors text{font-variant-numeric:tabular-nums}#activation-region.pending{opacity:.3;pointer-events:none}
</style>

<text id="heading" x="64" y="60" class="heading">Параметры W<tspan dy="7" font-size="23">Q</tspan></text>
<text id="component" x="1036" y="60" text-anchor="end" aria-live="polite" aria-label="${componentLabel(start.selected,parameters)}">W<tspan dy="6" font-size="17">Q</tspan><tspan id="component-value" dy="-6">${componentLabel(start.selected,parameters).slice(3)}</tspan></text>
<text id="shape-note" x="64" y="108" font-size="21">Фрагмент 4 × 4 × 4 · полная форма 256 × 64 × 4</text>
<g id="stage" tabindex="0" role="group" aria-label="Постоянный фрагмент параметров W_Q. Перетаскивание или стрелки — вращение. Нажатие — выбор коэффициента.">
<rect x="42" y="150" width="1016" height="512" fill="transparent"/><path id="stage-focus" d="M525 658 Q550 660 575 658" class="focus-ring" stroke-linecap="round"/>
<g id="cells" transform="translate(-255 0)">${geometryMarkup(parameters,start,false)}</g>
<g id="mirror" transform="translate(255 0)" pointer-events="none" aria-hidden="true">${geometryMarkup(parameters,start,true)}</g>
</g>
<text id="layers-label" x="295" y="694" font-size="21" text-anchor="middle">Головы</text>
${svgRange({id:'layers', x:118, y:709, width:354, value:0, label:'Раздвинуть фрагменты четырёх голов'})}
<g id="color-key"><text x="805" y="694" text-anchor="middle" font-size="21">Коэффициент</text>
<text x="678" y="736" font-size="18" text-anchor="end">−${limit.toFixed(2)}</text>${markerMarkup({x:697,y:721,width:216,height:18,color:'url(#weight-scale)',seed:4,prefix:'bert-ink'})}<path d="M697 744q54 2 108 0t108 0M805 742v8" fill="none" stroke="var(--ve-pencil)" stroke-width="1.2"/><text x="931" y="736" font-size="18">+${limit.toFixed(2)}</text><text x="805" y="761" text-anchor="middle" font-size="17">0</text>
</g><text id="notation-label" x="550" y="818" class="math" text-anchor="middle">W<tspan dy="6" font-size="19">Q</tspan><tspan dy="-6">[i, j, h]</tspan></text>
<text id="indices-label" x="550" y="853" font-size="19" text-anchor="middle">i — входная компонента · j — выходная · h — голова</text>
<g id="notation" tabindex="0" role="listbox" aria-label="Постоянные коэффициенты W_Q. Стрелки выбирают число, PageUp и PageDown — голову." aria-activedescendant="entry-${start.selected}">${matricesMarkup(parameters,start.selected)}</g>
<g id="activation-region" transform="translate(0 300)">
<text id="flow-token" x="64" y="1170" font-size="28">Вход и выход: ${escapeXML(initial.tokens[start.token])}</text>
<text id="projection-formula" x="1036" y="1170" class="math" text-anchor="end">q<tspan dy="6" font-size="19">h</tspan><tspan dy="-6"> = x W</tspan><tspan dy="6" font-size="19">Q,h</tspan><tspan dy="-6"> + b</tspan><tspan dy="6" font-size="19">h</tspan></text>
<g id="tokens" tabindex="0" role="listbox" aria-label="Выберите токен для просмотра его векторов. Стрелки влево и вправо." aria-activedescendant="token-${start.token}">${tokenMarkup(initial,start.token)}</g>
<g id="vectors" aria-live="polite">${vectorMarkup(initial,start.selected,start.token)}</g>
<text id="projection-note" x="550" y="1430" text-anchor="middle" font-size="21">Расчёт использует все 256 компонент и смещение b; показаны первые четыре.</text>
</g>
<script><![CDATA[
${inkRuntime}
const {inkShape, inkBox} = SketchInk;
${[escapeXML,weightColor,fitSvgControls,componentLabel,cubeScene,geometryMarkup,matricesMarkup,tokenMarkup,vectorMarkup].map(fn=>fn.toString()).join('\n')}
${runtime}
]]></script>
</svg>`;
await writeFile(new URL('tensor-cube.svg',import.meta.url),svg);
execFileSync('python3', [`${process.env.VISUAL_STORY_TOOLS ?? new URL('../../tools',import.meta.url).pathname}/svg_style.py`, new URL('tensor-cube.svg', import.meta.url).pathname]);
console.log('Created tensor-cube.svg: fixed W_Q parameters and live activations.');
