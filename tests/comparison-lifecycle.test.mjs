import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { serve } from '../tools/site.mjs';

test('comparison retains accepted pixels on failure and releases every child on a committed swap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comparison-lifecycle-'));
  let browser, server;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
import { comparisonSubject } from './dist/recipes/index.js';
let failRender=false, failDispose=false, failRecipe=false, disposed=[];
const model={id:'trial',module:'wrapper',inputs:{comparisonChange:'force',comparisonValue:2,comparisonCase:'after'}};
const pair=(value)=>({before:{id:'trial:before',module:'domain',inputs:{force:1},state:{force:1}},after:{id:'trial:after',module:'domain',inputs:{force:value},state:{force:value}},changes:[],controlled:[]});
const recipe={title:'test',parameters(m){if(m.module!=='domain')throw Error('Wrong parameter module');return [{key:'force',label:'Force',value:1}];},create(viewport,m){
 if(m.module!=='domain')throw Error('Wrong child module');
 const node=document.createElement('output');viewport.stage.append(node);
 return {validate(){},render(model,views,state){if(failRender&&model.id.endsWith('after'))throw Error('render failure');node.textContent=state.force;},snapshot:s=>s,dispose(){disposed.push(m.id);node.remove();if(failDispose&&m.id.endsWith('after'))throw Error('dispose failure');}};
}};
const subject=comparisonSubject({model:{staticState:v=>({comparison:pair(v.comparisonValue)})},recipe:pair=>{if(failRecipe)throw Error('recipe failure');return recipe;},views:()=>[],changes:['force']});
subject.parameters(model);
const drawing=subject.create({stage:document.querySelector('main'),layout:{width:800,height:400,scale:1,displayWidth:800,displayHeight:400,compact:false}},model);
window.lab={model,drawing,pair,flags:(render,dispose,recipe=false)=>{failRender=render;failDispose=dispose;failRecipe=recipe;},disposed,render:(value)=>drawing.render(model,[{id:'view'}],{comparison:pair(value),comparisonProgress:1,comparisonCase:'after'})};
`,
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'index.js'),
    });
    await writeFile(
      join(directory, 'index.html'),
      '<main style="position:relative;width:800px;height:400px"></main><script src="index.js"></script>',
    );
    server = await serve(directory);
    browser = await chromium.launch(await chromiumLaunchOptions());
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.evaluate(() => lab.render(2));
    assert.equal(await page.locator('[data-comparison]').count(), 1);
    await page.evaluate(() => lab.flags(false, false, true));
    await assert.rejects(
      page.evaluate(() => lab.render(3)),
      /recipe failure/,
    );
    assert.equal(await page.locator('[data-comparison]').count(), 1);
    assert.deepEqual(await page.locator('output').allTextContents(), ['1', '2']);
    await page.evaluate(() => lab.flags(true, true));
    await assert.rejects(
      page.evaluate(() => lab.render(3)),
      /rendering failed/,
    );
    assert.equal(await page.locator('[data-comparison]').count(), 1);
    assert.deepEqual(await page.locator('output').allTextContents(), ['1', '2']);
    assert.deepEqual(await page.evaluate(() => lab.disposed), ['trial:after', 'trial:before']);
    await page.evaluate(() => lab.flags(false, true));
    await page.evaluate(() => lab.render(4));
    assert.equal(await page.locator('[data-comparison]').count(), 1);
    assert.deepEqual(await page.locator('output').allTextContents(), ['1', '4']);
    assert.deepEqual(await page.evaluate(() => lab.disposed), [
      'trial:after',
      'trial:before',
      'trial:after',
      'trial:before',
    ]);
    await assert.rejects(
      page.evaluate(() => lab.drawing.dispose()),
      /dispose failure/,
    );
    assert.equal(await page.locator('[data-comparison]').count(), 0);
    await page.evaluate(() => lab.drawing.dispose());
  } finally {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
