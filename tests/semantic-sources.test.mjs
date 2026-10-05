import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { annotateSources, sourceHash } from '../tools/build-sources.mjs';
import { buildScene } from '../tools/build-pages.mjs';
import { readProjectFile } from '../plugin/project-files.mjs';

test('source annotation resolves lexical bindings and never guesses a dynamic factory', () => {
  const source = `import * as Story from '@visual-storytelling/core';
import {MathMorph as M} from '@visual-storytelling/core';
import {Viewport3D} from '@visual-storytelling/core/three';
const view = Viewport3D.mount(root);
view.describe(mesh,'item',{label:'authored'});
const ink = Story.object(parent,'ink');
ink.describe({label:'ink'});
const operation = M.plan(M.dot([1],[2]));
function hidden(M) { return M.dot([3],[4]); }
const Named = class M { method(){ return M.dot([3],[4]); } };
class Private { #method(M){ return M.dot([3],[4]); } }
function unknown(factory) { factory.describe(mesh,'unknown',{label:'unknown'}); }
const fake = {describe(){}};
fake.describe(mesh,'fake',{label:'fake'});
switch (mode) { case 'local': const M = fake; M.dot([3],[4]); break; }
class Static { static { var M = fake; M.dot([3],[4]); } }
`;
  const output = annotateSources(source, 'parts/scene.ts', '/runtime/scene-source.js');
  assert.match(output, /view\.describe\(mesh,'item',__vstorySourceAt\(/);
  assert.match(output, /ink\.describe\(__vstorySourceAt\(/);
  assert.match(output, /__vstorySourceAt\(M\.plan\(__vstorySourceAt\(M\.dot/);
  for (const code of [
    'function hidden(M) { return M.dot([3],[4]); }',
    'const Named = class M { method(){ return M.dot([3],[4]); } };',
    'class Private { #method(M){ return M.dot([3],[4]); } }',
    "function unknown(factory) { factory.describe(mesh,'unknown',{label:'unknown'}); }",
    "fake.describe(mesh,'fake',{label:'fake'});",
    "switch (mode) { case 'local': const M = fake; M.dot([3],[4]); break; }",
    'class Static { static { var M = fake; M.dot([3],[4]); } }',
  ])
    assert(output.includes(code));
  const changed = `import {MathMorph} from '@visual-storytelling/core'; MathMorph.dot = unknown; MathMorph.dot([1],[2]);`;
  assert.equal(annotateSources(changed, 'scene.js', '/runtime/scene-source.js'), changed);
  for (const change of [
    'const alias = MathMorph; alias.dot = unknown;',
    'delete MathMorph.dot;',
    '[MathMorph.dot] = [unknown];',
    '({method: MathMorph.dot} = unknown);',
    'for (MathMorph.dot of replacements) {}',
  ]) {
    const mutated = `import {MathMorph} from '@visual-storytelling/core'; ${change} MathMorph.dot([1],[2]);`;
    assert.equal(annotateSources(mutated, 'scene.js', '/runtime/scene-source.js'), mutated);
  }
  const commonjs = 'if (ready) return; module.exports = {};';
  assert.equal(annotateSources(commonjs, 'scene.cjs', '/runtime/scene-source.js'), commonjs);
});

test('async SVG and 3D objects retain the authored span of the shown immutable input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'semantic-sources-'));
  const working = join(directory, 'working'),
    snapshot = join(directory, 'snapshot'),
    output = join(directory, 'shown');
  const source = `import {SceneStory, MathMorph, MathMorph2D, describeObject} from '@visual-storytelling/core';
import {Viewport3D, MathMorph3D, ThreeKit as T} from '@visual-storytelling/core/three';
import '@visual-storytelling/core/style.css';
const root=document.querySelector('main');
function indirect(register,parent,id) {
  const button=document.createElement('button'); button.dataset.object=id; parent.append(button);
  register(button,{label:id}); return button;
}
const chapters=[
  {id:'svg',title:'SVG',text:'SVG',seconds:2,async mount(parent) {
    await Promise.resolve();
    indirect(describeObject,parent,'chapter-owned');
    const morph=MathMorph2D.mount(parent,MathMorph.calculate('add',3,4),{id:'sum'});
    return {render(){morph.render(1)},dispose:morph.dispose};
  }},
  {id:'space',title:'3D',text:'3D',seconds:2,async mount(parent) {
    await Promise.resolve();
    const view=Viewport3D.mount(parent);
    const morph=MathMorph3D.mount(view,MathMorph.dot([1,2],[3,4]),{id:'dot'});
    const cube=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());
    morph.object.add(cube); cube.position.x=4;
    view.setObject(morph.object);
    view.describe(cube,'cube',{label:'Cube'});
    return {view,render(){morph.render(1);view.shot({target:morph.object})},dispose:view.dispose};
  }}
];
window.galleryReady=SceneStory.mount(root,{title:'Sources',chapters,frame:{width:600,height:400}}).then(lesson=>{
  indirect(describeObject,root,'unknown-wrapper');
  const explicit=document.createElement('button'); explicit.dataset.object='explicit';root.append(explicit);
  const releaseOriginal=describeObject(explicit,{label:'Explicit',source:{file:'notes.md',line:7}});
  window.lab={...lesson,root,replaceMeaning:(register=describeObject)=>{
    const meaning={label:'Replaced'};
    const releasePrevious=register(explicit,meaning);
    const releaseCurrent=register(explicit,meaning);
    releaseOriginal(); releasePrevious();
    return releaseCurrent;
  }};
});
`;
  let browser;
  try {
    await mkdir(join(working, 'parts'), { recursive: true });
    await writeFile(
      join(working, 'index.html'),
      '<main class="ve-scene"></main><script type="module" src="parts/scene.js"></script>',
    );
    await writeFile(join(working, 'parts/scene.js'), source);
    await cp(working, snapshot, { recursive: true });
    await buildScene(snapshot, output, { sourcePackage: true });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(pathToFileURL(join(output, 'index.html')).href);
    await page.evaluate(() => galleryReady);
    let objects = await page.evaluate(() => lab.scene.inspect({ presentation: false }).objects);
    const sum = objects.find((object) => object.id === 'sum:result');
    assert.equal(sum.value, 7);
    assert.equal(sum.source.file, 'parts/scene.js');
    assert.equal(sum.source.kind, 'operation');
    assert.equal(sum.source.hash, sourceHash(source));
    assert.equal(source.slice(sum.source.start, sum.source.end), "MathMorph.calculate('add',3,4)");
    const chapter = objects.find((object) => object.id === 'chapter-owned');
    assert.equal(chapter.source.kind, 'chapter', 'the owning DOM retains origin across await');
    assert(source.slice(chapter.source.start, chapter.source.end).startsWith("{id:'svg'"));
    assert.equal(objects.find((object) => object.id === 'unknown-wrapper').source, undefined);
    assert.deepEqual(objects.find((object) => object.id === 'explicit').source, {
      file: 'notes.md',
      line: 7,
    });
    await page.evaluate(() => lab.replaceMeaning());
    assert.equal(
      await page.evaluate(
        () => lab.scene.objects().find((object) => object.id === 'explicit').label,
      ),
      'Replaced',
      'older cleanup cannot remove the current registration, even with the same meaning object',
    );
    assert.equal(
      await page.evaluate(
        () => lab.scene.objects().find((object) => object.id === 'explicit').source,
      ),
      undefined,
      're-registering the same element does not retain an old authored span',
    );
    await page.evaluate(() => lab.scene.control([{ type: 'seek', time: 3 }]));
    objects = await page.evaluate(() => lab.scene.inspect({ presentation: false }).objects);
    const dot = objects.find((object) => object.id === 'dot:result'),
      cube = objects.find((object) => object.id === 'cube');
    assert.equal(dot.value, 11);
    assert.equal(source.slice(dot.source.start, dot.source.end), 'MathMorph.dot([1,2],[3,4])');
    assert.equal(cube.source.kind, 'object');
    assert.equal(source.slice(cube.source.start, cube.source.end), "{label:'Cube'}");
    assert.equal(dot.implementation.file, 'src/morph/three.ts');
    await writeFile(join(working, 'parts/scene.js'), source.replace("'add',3,4", "'add',30,40"));
    const shown = await readProjectFile(snapshot, sum.source.file),
      edited = await readProjectFile(working, sum.source.file);
    assert.equal(shown.digest, sum.source.hash);
    assert.notEqual(edited.digest, sum.source.hash);
    assert.equal(
      shown.content.slice(sum.source.start, sum.source.end),
      "MathMorph.calculate('add',3,4)",
    );
    const receipt = JSON.parse(await readFile(join(output, 'index.js.sources.json'), 'utf8'));
    assert(
      receipt.inputs.some(
        (input) => input.hash === shown.digest && input.references.includes(sum.source.file),
      ),
    );
    const declaredLine = source.slice(0, sum.source.start).split('\n').length;
    assert.equal(sum.source.line, declaredLine);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('generator output never claims an authored range in its temporary scene module', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'generated-sources-'));
  let browser;
  try {
    const source = `import {describeObject} from '@visual-storytelling/core';
const button=document.querySelector('button');
describeObject(button,{label:'Generated'});`;
    await writeFile(
      join(directory, 'scene.json'),
      JSON.stringify({ generator: { runner: 'node', file: 'generate.mjs' } }),
    );
    await writeFile(
      join(directory, 'generate.mjs'),
      `
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildPage} from ${JSON.stringify(new URL('../tools/build-pages.mjs', import.meta.url).href)};
const out=process.env.VISUAL_STORY_OUTPUT;
await writeFile(join(out,'scene.js'),${JSON.stringify(source)});
await writeFile(join(out,'index.html'),'<button data-object="generated"></button><script type="module" src="scene.js"></script>');
await buildPage(join(out,'index.html'),out,{sourcePackage:true});
`,
    );
    const output = join(directory, 'dist');
    await buildScene(directory, output, { sourcePackage: true });
    const bundle = await readFile(join(output, 'index.js'), 'utf8');
    assert(!bundle.includes('__vstorySourceSpans'), 'generated calls carry no authored annotation');
    const receipt = JSON.parse(await readFile(join(output, 'index.js.sources.json'), 'utf8'));
    assert(
      !receipt.inputs.some((input) => input.references.some((file) => file.endsWith('scene.js'))),
    );
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(output, 'index.html')).href);
    assert.equal(await page.locator('button').getAttribute('aria-label'), 'Generated');
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
