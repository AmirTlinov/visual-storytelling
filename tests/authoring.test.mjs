import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { develop } from '../tools/dev.mjs';

test('authoring: reload keeps the selected time, failed edits keep the scene, face lettering stays attached', async () => {
  const source = await mkdtemp(join(tmpdir(), 'story-authoring-'));
  let server, browser;
  try {
    await writeFile(
      join(source, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"></head><body class="ve-standalone"><main class="ve-scene"></main><script type="module" src="scene.js"></script></body></html>',
    );
    const program = `import {SceneShell, SvgLayout, SketchMotion, lettering} from '@visual-storytelling/core';
      import {Viewport3D, ThreeKit as T} from '@visual-storytelling/core/three';
      import '@visual-storytelling/core/style.css';
      window.galleryReady=(async()=>{
        await SceneShell.ready();
        const root=document.querySelector('main'),shell=SceneShell.mount(root,{title:'Revision one',paper:false});
        const view=Viewport3D.mount(shell.stage);shell.attachView(view);
        const cube=new T.Mesh(new T.BoxGeometry(1,1,1),view.ink(new T.MeshBasicMaterial(),'blue-wash'));view.setObject(cube);
        let value='123.456';const label=view.label(()=>value,cube,{face:'front'});
        const reference=new T.Box3(new T.Vector3(-1,-1,-1),new T.Vector3(1,1,1));
        const controller=shell.attachStory({script:{duration:10,cues:{move:{start:0,end:10,action:'Scale the cube'}},segments:[{id:'move',start:0,end:10,text:'Scale',title:'Revision one: подробный разбор изменения формы и поведения предмета'}]},stateAt:f=>({x:1+f.progress('move')}),render:s=>{cube.scale.x=s.x;view.shot({target:reference,direction:[0,0,1]});}});
        const svg=SvgLayout.element('svg',{width:50,height:50});shell.actions.append(svg);
        const group=SvgLayout.element('g',{visibility:'hidden'});svg.append(group);
        const path=SvgLayout.element('path',{d:'M0 0L40 40',stroke:'black'});group.append(path);SketchMotion.draw(path,.5);lettering(group,'42');
        window.lab={view,cube,label,group,controller,setValue:v=>{value=v;view.invalidate();},far:()=>view.shot({target:new T.Box3(new T.Vector3(-8,-8,-8),new T.Vector3(8,8,8)),direction:[0,0,1]}),back:()=>view.shot({target:cube,direction:[0,0,-1]})};
      })();`;
    await writeFile(join(source, 'scene.js'), 'const broken = ;');
    server = await develop(source, 0, { sourcePackage: true });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 375, height: 850 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url + '/?t=2');
    await page.locator('#visual-story-build-error').waitFor();
    await writeFile(join(source, 'scene.js'), program);
    await page.waitForFunction(() => document.querySelector('main')?.scene?.currentTime === 2);
    assert(
      await page.evaluate(() => lab.label.object.parent === lab.cube && !lab.label.element.hidden),
    );
    assert(
      await page.evaluate(() =>
        [...lab.group.querySelectorAll('path,circle,.vs-lettering')].every(
          (e) => getComputedStyle(e).visibility === 'hidden',
        ),
      ),
    );
    await page.evaluate(() => lab.controller.seek(7));
    await writeFile(join(source, 'scene.js'), program.replaceAll('Revision one', 'Revision two'));
    await page
      .getByRole('combobox', { name: 'Глава' })
      .filter({ hasText: 'Revision two' })
      .waitFor();
    await page.waitForFunction(() => document.querySelector('main').scene.currentTime === 7);
    const heading = page.getByRole('combobox', { name: 'Глава' });
    assert(await heading.evaluate((element) => element.scrollHeight <= element.clientHeight + 1));
    await writeFile(join(source, 'scene.js'), 'const broken = ;');
    await page.locator('#visual-story-build-error').waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('main').scene.currentTime), 7);
    await writeFile(join(source, 'scene.js'), program.replaceAll('Revision one', 'Revision three'));
    await page
      .getByRole('combobox', { name: 'Глава' })
      .filter({ hasText: 'Revision three' })
      .waitFor();
    await page.waitForFunction(() => document.querySelector('main').scene.currentTime === 7);
    await page.evaluate(() => {
      lab.setValue('123456789.987');
      lab.far();
    });
    await page.waitForFunction(() => lab.label.element.textContent === '123456789.987');
    const inscription = await page.evaluate(() => {
      const canvas = lab.label.object.children[0].material.map.image,
        context = canvas.getContext('2d'),
        pixels = context.getImageData(0, 0, canvas.width, canvas.height).data,
        metrics = context.measureText(lab.label.element.textContent);
      let painted = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
      // Texture density follows projection. Measure the actual ink at that density;
      // a fixed texel gutter would consume a distant inscription's whole texture.
      return {
        painted,
        attached: lab.label.object.parent === lab.cube,
        width: canvas.width,
        height: canvas.height,
        left: canvas.width / 2 - metrics.actualBoundingBoxLeft,
        right: canvas.width / 2 + metrics.actualBoundingBoxRight,
        top: canvas.height / 2 - metrics.actualBoundingBoxAscent,
        bottom: canvas.height / 2 + metrics.actualBoundingBoxDescent,
      };
    });
    assert(inscription.painted > 0 && inscription.attached);
    assert(
      inscription.left >= 0 &&
        inscription.top >= 0 &&
        inscription.right <= inscription.width &&
        inscription.bottom <= inscription.height,
      `Face lettering is clipped: ${JSON.stringify(inscription)}`,
    );
    await page.evaluate(() => lab.back());
    await page.waitForFunction(() => lab.label.element.hidden);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(source, { recursive: true, force: true });
  }
});
