import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { svgRange } from '@visual-storytelling/core/controls';
import { SketchInk } from '@visual-storytelling/core/ink';
import {
  projectionBreakdown,
  validateProjection,
  decimal,
  weightColor,
  escapeXML,
} from './model.mjs';
import { cubeScene } from './geometry.mjs';
import { mountCube } from './runtime.mjs';

const tools = process.env.VISUAL_STORY_TOOLS ?? new URL('../../tools', import.meta.url).pathname;
const { svgRuntime } = await import(pathToFileURL(`${tools}/svg-runtime.mjs`));
const sharedRuntime = await svgRuntime({
  '': ['transport', 'mountScene'],
  '/ink': ['SketchInk'],
  '/three': ['SvgOrbit'],
});
const initial = JSON.parse(await readFile(new URL('projection.json', import.meta.url), 'utf8'));
if (initial.model !== 'prajjwal1/bert-mini' || initial.total_heads !== 4)
  throw Error('Generate the BERT-mini snapshot with projection.py --snapshot first.');
const parameters = initial.parameters,
  start = { spread: 0.3, yaw: -0.64, pitch: -0.48, selected: '1-2-0', token: 1 };
const { inkShape, inkBox, markerDefs, markerMarkup } = SketchInk;
const cells = cubeScene(
  parameters,
  start.spread,
  start.yaw,
  start.pitch,
  start.selected,
  inkShape,
  weightColor,
)
  .map(
    (cell) =>
      `<g data-cell="${cell.key}">${cell.faces
        .map(
          (face) =>
            `<path data-cell="${cell.key}" stroke-linejoin="round" vector-effect="non-scaling-stroke" ${Object.entries(
              face,
            )
              .map(([key, value]) => `${key}="${value}"`)
              .join(' ')}/>`,
        )
        .join('')}</g>`,
  )
  .join('');
const heads = Array.from(
  { length: 4 },
  (_, h) =>
    `<g data-head="${h}" role="button" tabindex="0" aria-label="Голова ${h + 1}" aria-pressed="${h === 0}" transform="translate(${83 + h * 126} 46)"><path d="${inkBox(-34, -27, 68, 44, h)}"/><text text-anchor="middle">${h + 1}</text></g>`,
).join('');
const matrices = parameters.values
  .map(
    (matrix, h) =>
      `<g role="group" aria-label="Голова ${h + 1}" style="${h ? 'display:none' : ''}">${matrix
        .map((row, i) =>
          row
            .map((value, j) => {
              const key = [i, j, h].join('-');
              return `<g id="entry-${key}" data-cell="${key}" class="entry" role="option" aria-selected="${key === start.selected}" aria-label="W_Q[${i + 1},${j + 1},${h + 1}] = ${value.toFixed(6)}" transform="translate(${83 + j * 126} ${149 + i * 54})"><title>W_Q[${i + 1},${j + 1},${h + 1}] = ${value.toFixed(6)}</title><path d="${inkBox(-55, -29, 110, 42, h * 16 + i * 4 + j)}" fill="${weightColor(value, parameters.color_limit, 'transparent')}"/><text text-anchor="middle">${decimal(value)}</text></g>`;
            })
            .join(''),
        )
        .join('')}</g>`,
  )
  .join('');
const indices = Array.from(
  { length: 4 },
  (_, i) =>
    `<text x="${83 + i * 126}" y="107" class="small muted" text-anchor="middle">j=${i + 1}</text><text x="15" y="${149 + i * 54}" class="small muted" text-anchor="middle">${i + 1}</text>`,
).join('');
const values = projectionBreakdown(initial, start.selected, start.token);
const rows = values.inputs
  .map(
    (
      value,
      i,
    ) => `<g id="calc-row-${i}" transform="translate(0 ${108 + i * 56})" data-selected="${i === values.i}">
<text id="index-${i}" x="90" class="small muted" text-anchor="middle">${i + 1}</text>
<path id="input-box-${i}" class="input-box" d="${inkBox(199, -30, 102, 43, i)}"/>
<text id="input-${i}" x="250" text-anchor="middle">${decimal(value)}</text>
<text id="multiply-${i}" x="375" text-anchor="middle">×</text>
<path id="weight-box-${i}" class="weight-box" d="${inkBox(464, -30, 102, 43, i + 4)}"/>
<text id="weight-${i}" x="515" text-anchor="middle">${decimal(values.weights[i])}</text>
<path id="calculation-flow-${i}" fill="none" stroke="var(--ve-purple)" stroke-width="1.5" pathLength="100" visibility="hidden"/>
<g id="product-${i}" visibility="hidden"><text id="equal-${i}" x="640" text-anchor="middle">≈</text><path id="product-box-${i}" fill="var(--ve-green-wash)" d="${inkBox(764, -30, 102, 43, i + 8)}"/><text id="term-${i}" x="815" text-anchor="middle" class="green">${decimal(values.terms[i])}</text></g></g>`,
  )
  .join('');
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="group" aria-labelledby="title desc">
<title id="title">Как веса BERT собирают запрос</title>
<desc id="desc">Реальные коэффициенты проекции запросов четвёртого слоя BERT-mini. Один куб показывает первые четыре входные и выходные компоненты каждой из четырёх голов, всего 64 веса из 65536. Справа раскрывается выбранная голова. Выбранный столбец даёт одну компоненту запроса: первые четыре входа умножаются на свои веса, их вклады складываются, затем учитываются остальные 252 компоненты и смещение. Полный выход вычислен настоящей моделью. Числа округлены. Стрелки в матрице выбирают строку и столбец; PageUp и PageDown переключают голову. Токены выбираются стрелками. Для времени вычисления используйте плеер HTML-страницы. Куб вращается общей камерой; Home восстанавливает вид.</desc>
<metadata id="provenance">${escapeXML(JSON.stringify({ model: initial.model, revision: initial.revision, layer: initial.layer, text: initial.text, parameter_sha256: parameters.sha256 }))}</metadata>
${markerDefs('bert-ink')}
<defs><linearGradient id="weight-scale"><stop stop-color="var(--ve-orange)" stop-opacity=".52"/><stop offset=".5" stop-color="var(--ve-orange)" stop-opacity="0"/><stop offset=".5" stop-color="var(--ve-blue)" stop-opacity="0"/><stop offset="1" stop-color="var(--ve-blue)" stop-opacity=".52"/></linearGradient></defs>
<style>
svg.ve-scene{width:100%;height:100%;display:block;aspect-ratio:2/1;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;background-image:var(--ve-grid);background-size:30px 30px;font-size:28px}
text{font-family:inherit;fill:var(--ve-ink);font-variant-numeric:tabular-nums}.small{font-size:26px}#matrix-section .small{font-size:30px}#matrix-section .entry text,#heads text{font-size:32px}.muted{fill:var(--ve-muted)}.green{fill:var(--ve-green)}.purple{fill:var(--ve-purple)}
.entry{cursor:pointer}.entry text,#heads text,#tokens text{pointer-events:none}.entry>path{stroke:transparent;stroke-width:1.6;pointer-events:all}.entry[data-column=true]>path{stroke:var(--ve-pencil)}.entry[aria-selected=true]>path{stroke:var(--ve-purple);stroke-width:2}
#notation:focus-visible .entry[aria-selected=true]>path{stroke-dasharray:4 3}
#heads [data-head]{cursor:pointer;outline:none}#heads path{fill:none;stroke:transparent;pointer-events:all}#heads [aria-pressed=true] path{fill:var(--ve-purple-wash);stroke:var(--ve-purple);stroke-width:1.4}#heads [data-head]:focus-visible path,#heads [data-head]:hover path{stroke:var(--ve-purple);stroke-width:1.4}
#tokens{outline:none}#tokens [data-token]{cursor:pointer}#tokens .token-outline{fill:none;stroke:transparent;pointer-events:all}#tokens [aria-selected=true] .token-outline{fill:var(--ve-blue-wash);stroke:var(--ve-blue);stroke-width:1.4}#tokens:focus-visible [aria-selected=true] .token-outline{stroke-dasharray:4 3}
#stage{cursor:grab;touch-action:none;outline:none}#stage.dragging{cursor:grabbing}.focus-ring{fill:none;stroke:transparent}svg:not(.pointer-input) #stage:focus-visible .focus-ring{stroke:var(--ve-ink);stroke-width:1.4}
.input-box{fill:var(--ve-blue-wash);stroke:transparent}.weight-box{fill:var(--ve-purple-wash);stroke:transparent}[data-selected=true] .input-box{stroke:var(--ve-blue);stroke-width:1.3}[data-selected=true] .weight-box{stroke:var(--ve-purple);stroke-width:1.3}#activation-region.pending{opacity:.3;pointer-events:none}
</style>
<text id="heading" x="32" y="39" font-size="36">Как веса BERT собирают запрос</text>
<g id="token-paging"><g id="token-prev" role="button" tabindex="0" aria-label="Предыдущий токен" transform="translate(24 91)"><rect x="-20" y="-29" width="40" height="44" fill="transparent"/><text text-anchor="middle" font-size="34">‹</text></g><g id="token-next" role="button" tabindex="0" aria-label="Следующий токен" transform="translate(1256 91)"><rect x="-20" y="-29" width="40" height="44" fill="transparent"/><text text-anchor="middle" font-size="34">›</text></g></g>
<g id="stage" transform="translate(-30 70) scale(.7)" tabindex="0" role="group" aria-label="Куб четырёх голов. Нажатие выбирает коэффициент."><rect x="24" y="133" width="506" height="334" fill="transparent"/><g id="orbit-world"><g id="cells">${cells}</g></g><path id="stage-focus" class="focus-ring" d="M200 466Q270 468 340 466"/></g>
<text x="159" y="148" text-anchor="middle" font-size="28">Четыре головы</text>
<text x="159" y="444" text-anchor="middle" class="small">64 веса из 65 536</text>
<text x="159" y="496" text-anchor="middle" class="small">Раздвинуть головы</text>
${svgRange({ id: 'layers', x: 43, y: 511, width: 232, value: start.spread, label: 'Раздвинуть фрагменты четырёх голов' })}
<g id="color-key" transform="translate(-20 142) scale(.72)"><text x="130" y="627" text-anchor="end" class="small muted">${decimal(-parameters.color_limit, 2)}</text>${markerMarkup({ x: 150, y: 610, width: 236, height: 17, color: 'url(#weight-scale)', seed: 4, prefix: 'bert-ink' })}<text x="406" y="627" class="small muted">+${decimal(parameters.color_limit, 2)}</text><text x="270" y="631" text-anchor="middle" class="small muted">0</text></g>
<g id="matrix-section" transform="translate(294 153) scale(.73)"><text x="272" y="0" text-anchor="middle" font-size="36">Голова и столбец</text><g id="heads" role="group" aria-label="Головы внимания">${heads}</g>
${indices}<path d="M35 120H29V327H35M516 120H522V327H516" fill="none" stroke="var(--ve-pencil)" stroke-width="1.4"/>
<g id="notation" tabindex="0" role="listbox" aria-label="Коэффициенты выбранной головы. Стрелки выбирают строку и столбец, PageUp и PageDown — голову." aria-activedescendant="entry-${start.selected}">${matrices}</g>
<text id="head-caption" x="272" y="365" text-anchor="middle" class="small purple">Голова 1 · столбец 3 → q₃</text>
<text id="component" x="272" y="407" text-anchor="middle" class="small">W_Q[2,3,1] = −0.034802</text>
<text x="272" y="450" text-anchor="middle" class="small muted">Строка i → вход · столбец j → выход</text></g>
<g id="activation-region" transform="translate(710 140)">
<text id="calculation-title" x="266" y="8" text-anchor="middle" font-size="28">2. Соберём q₁,₃ для токена</text>
<g id="tokens" transform="translate(-710 -140)" tabindex="0" role="listbox" aria-label="Выберите токен. Стрелки влево и вправо." aria-activedescendant="token-1"></g>
<g id="calculation">
<text id="input-heading" x="250" y="56" text-anchor="middle" class="small">Вход xᵢ</text><text id="weight-heading" x="515" y="56" text-anchor="middle" class="small">Вес → q₃</text><text id="term-heading" x="815" y="56" text-anchor="middle" class="small">Вклад</text>
${rows}
<g id="gather" fill="none" stroke="var(--ve-green)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" visibility="hidden"><path id="gather-bracket" pathLength="100"/><g id="gather-arrow" visibility="hidden"><path id="gather-shaft" pathLength="100"/><path id="gather-head" visibility="hidden"/></g></g>
<g id="partial" visibility="hidden"><path id="partial-box" d="${inkBox(38, 336, 1024, 64, 50)}" fill="var(--ve-green-wash)"/><text id="partial-label" x="16" y="319">Первые 4 вклада</text><text id="partial-value" x="512" y="319" text-anchor="end" class="green">${decimal(values.partial)}</text></g>
<text id="plus" x="266" y="349" text-anchor="middle" visibility="hidden">+</text>
<g id="rest" visibility="hidden"><path id="rest-box" d="${inkBox(38, 440, 1024, 64, 51)}" fill="var(--ve-purple-wash)"/><text id="rest-label" x="16" y="389" class="small">Остальные 252 + b</text><text id="rest-value" x="512" y="389" text-anchor="end" class="purple">${decimal(values.rest)}</text></g>
<g id="final" visibility="hidden"><path id="final-box" d="${inkBox(364, 524, 372, 70, 62)}" fill="var(--ve-blue-wash)" stroke="var(--ve-blue)" stroke-width="1.5"/><text id="output-value" x="266" y="466" text-anchor="middle" font-size="34">q₁,₃ ≈ ${decimal(values.output)}</text></g>

</g></g>
<script><![CDATA[
${sharedRuntime}
${[projectionBreakdown, validateProjection, decimal, weightColor, escapeXML, cubeScene, mountCube].map((fn) => fn.toString()).join('\n')}
mountCube(${JSON.stringify(initial).replace(/</g, '\\u003c')},${JSON.stringify(start)},VisualStory,{projectionBreakdown,validateProjection,decimal,weightColor,escapeXML},cubeScene);
]]></script>
</svg>`;
const output = resolve(
  process.env.VISUAL_STORY_OUTPUT ?? new URL('.', import.meta.url).pathname,
  'tensor-cube.svg',
);
await writeFile(output, svg);
execFileSync(process.env.VISUAL_STORY_PYTHON ?? 'python3', [`${tools}/svg_style.py`, output]);
console.log('Created tensor-cube.svg: one selected head and a timed full-projection explanation.');
