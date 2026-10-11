import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { buildPage } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const completeFrameError = /complete frame.*PNG or HTML.*exportSVG/;

async function buildFixture(name, directory, entry = 'index.html') {
  await buildPage(resolve('tests/fixtures', name, entry), directory, { outputName: 'index.html' });
}

test(
  'a compact video viewport captures the same MorphStory without relocating its subject controls',
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'story-video-frame-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const entry = join(directory, 'index.html');
    await writeFile(
      entry,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body class="ve-standalone"><main class="ve-scene"></main><script type="module">
    import { MathMorph, MorphStory } from '@visual-storytelling/core';
    import '@visual-storytelling/core/style.css';
    window.galleryReady = MorphStory.mount(document.querySelector('main'), {
      title:'Почему площадь растёт быстрее стороны', presenter:MathMorph, initial:{k:2},
      parameters:[{key:'k',label:'Масштаб стороны k',min:1,max:3,step:.25}],
      script:{duration:16,cues:{scale:{start:2,end:12,action:'Умножить обе стороны.'}},segments:[{id:'scale',start:0,end:16,title:'Два направления роста',text:'Площадь зависит от обеих сторон.'}]},
      chapters:[{id:'scale',operation:({k})=>MathMorph.linear([[k,0],[0,k]])}],
    }).then(lesson => window.lesson = lesson);
    </script>`,
    );
    const output = join(directory, 'dist');
    await buildPage(entry, output, { sourcePackage: true });
    const render = await renderer({
      directory: output,
      width: 640,
      height: 360,
      controls: false,
      signal: t.signal,
    });
    try {
      const frames = [];
      for (const time of [4, 12, 4]) {
        await render.seek(time);
        const before = await render.page.evaluate(() => {
          const root = document.querySelector('.ve-scene');
          return {
            time: window.lesson.story.presented.time,
            k: window.lesson.story.presented.state.inputs.k,
            playing: root.scene.inspect({ presentation: false }).playing,
            snapshot: root.scene.snapshot(),
            frameMarkup: root.querySelector('[data-scene-frame]').outerHTML,
            controlsParent: root.querySelector('.ve-scene-toolbar').parentElement.className,
            playerVisible: root.querySelector('.ve-player').checkVisibility(),
          };
        });
        assert.equal(before.time, time);
        assert.equal(before.k, 2);
        assert.equal(before.playing, false);
        assert.equal(before.controlsParent, 've-scene-conditions');
        assert.equal(before.playerVisible, false);
        const composition = await render.capture.evaluate((scene) => scene.presentation());
        assert.equal(composition.outsideViewport, false);
        assert.deepEqual(composition.clipped, []);
        assert.deepEqual(composition.unreadableText, []);
        assert.ok(Math.abs(composition.frame.width / composition.frame.height - 16 / 9) < 0.001);
        const image = PNG.sync.read(await render.png());
        assert.ok(Math.abs(image.width - composition.frame.width) <= 1);
        assert.ok(Math.abs(image.height - composition.frame.height) <= 1);
        assert.deepEqual(
          await render.capture.evaluate((scene) => scene.snapshot()),
          before.snapshot,
        );
        frames.push({
          image,
          snapshot: before.snapshot,
          markup: before.frameMarkup,
          frame: composition.frame,
        });
      }
      assert.equal(
        frames[0].image.data.equals(frames[1].image.data),
        false,
        'the measured square visibly changes',
      );
      const first = frames[0],
        restored = frames[2];
      assert.deepEqual(restored.snapshot, first.snapshot, 'reverse seek restores the same model');
      assert.equal(
        restored.markup,
        first.markup,
        'reverse seek restores every drawn path, transform and text',
      );
      assert.deepEqual(restored.frame, first.frame, 'reverse seek preserves the frame geometry');
      assert.equal(restored.image.width, first.image.width);
      assert.equal(restored.image.height, first.image.height);

      // Identical DOM/model produced 13 AA edge pixels on Chromium/Metal (max 10, total 70).
      // Keep these independent bounds tight; a mean-image tolerance could hide a real drawing change.
      const difference = { changedPixels: 0, maxChannelDelta: 0, totalDelta: 0, changedAlpha: 0 };
      for (let pixel = 0; pixel < first.image.data.length; pixel += 4) {
        let changed = false;
        for (let channel = 0; channel < 3; channel++) {
          const delta = Math.abs(
            first.image.data[pixel + channel] - restored.image.data[pixel + channel],
          );
          changed ||= delta > 0;
          difference.maxChannelDelta = Math.max(difference.maxChannelDelta, delta);
          difference.totalDelta += delta;
        }
        difference.changedPixels += Number(changed);
        difference.changedAlpha += Number(
          first.image.data[pixel + 3] !== restored.image.data[pixel + 3],
        );
      }
      const detail = `reverse seek raster difference: ${JSON.stringify(difference)}`;
      assert.equal(difference.changedAlpha, 0, detail);
      assert.ok(difference.changedPixels <= 16, detail);
      assert.ok(difference.maxChannelDelta <= 12, detail);
      assert.ok(difference.totalDelta <= 96, detail);
    } finally {
      await render.close();
    }
  },
);

test('interactive lessons and PNG share the complete 16:9 frame and its current model', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'story-frame-export-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const [name, entry] of [
    ['scene-shell', 'plot.html'],
    ['chapters', 'index.html'],
    ['arithmetic', 'projection.html'],
  ]) {
    const directory = join(temporary, name);
    await buildFixture(name, directory, entry);
    for (const width of [1000, 390]) {
      const render = await renderer({
        directory,
        width,
        height: 760,
        theme: 'light',
        controls: true,
      });
      try {
        const geometry = () =>
          render.page.locator('[data-scene-frame]').evaluate((element) => {
            const frame = element.getBoundingClientRect(),
              stage = element.querySelector('.ve-stage').getBoundingClientRect();
            return {
              width: frame.width,
              height: frame.height,
              stage: { x: stage.x, y: stage.y, width: stage.width, height: stage.height },
            };
          });
        const bounds = await geometry();
        assert.ok(Math.abs(bounds.width / bounds.height - 16 / 9) < 0.001, name);
        assert.deepEqual(
          (await render.capture.evaluate((scene) => scene.presentation())).clipped,
          [],
          `${name}: the drawing fits inside its complete frame`,
        );
        await render.control([{ type: 'mode', value: 'explore' }]);
        assert.deepEqual(await geometry(), bounds, `${name}: mode keeps drawing geometry`);
        const before = await render.capture.evaluate((scene) => scene.snapshot());
        const png = PNG.sync.read(await render.png());
        assert.ok(Math.abs(png.width - bounds.width) <= 1, `${name}: complete width`);
        assert.ok(Math.abs(png.height - bounds.height) <= 1, `${name}: complete height`);
        assert.deepEqual(
          await render.capture.evaluate((scene) => scene.snapshot()),
          before,
          `${name}: PNG capture retains the current model`,
        );
        await render.control([{ type: 'mode', value: 'story' }]);
        assert.deepEqual(await geometry(), bounds, `${name}: return preserves drawing geometry`);
      } finally {
        await render.close();
      }
    }
  }
});

test('a pure SVG frame retains its geometry and text through fallback export', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-svg-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, 'index.html'),
    `<!doctype html><html><body>
    <main class="ve-scene"><div data-scene-frame data-frame-scope="scene">
      <div class="ve-stage">
      <svg class="vs-canvas" xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
        <rect id="unit" x="20" y="20" width="80" height="80" fill="blue"/>
        <text x="20" y="140" rotate="12">One square unit</text>
      </svg>
    </div></div></main></body></html>`,
  );
  const render = await renderer({ directory, width: 400, height: 300 });
  try {
    const svg = await render.svg();
    assert.match(svg, /id="unit"/);
    assert.match(svg, /One square unit/);
    assert.match(svg, /rotate="12"/, 'SVG glyph rotation is independent of CSS rotate');
    assert.match(svg, /viewBox="0 0 240 160"/);
    await render.page.evaluate(() => {
      const heading = document.createElement('h1');
      heading.className = 've-heading';
      heading.textContent = 'This heading belongs to the complete composition.';
      document.querySelector('[data-scene-frame]').prepend(heading);
    });
    await assert.rejects(render.svg(), completeFrameError);
    await render.page.evaluate(() => {
      document.querySelector('.ve-heading').remove();
      const note = document.createElement('p');
      note.textContent = 'This explanation belongs to the same drawing.';
      document.querySelector('.ve-stage').append(note);
    });
    await assert.rejects(render.svg(), completeFrameError);
    await render.page.evaluate(() => {
      document.querySelector('.ve-stage p').remove();
      document.querySelector('.ve-stage').append('A note can also be a direct text node.');
    });
    await assert.rejects(render.svg(), completeFrameError);
    const explicit =
      '<svg xmlns="http://www.w3.org/2000/svg"><text>Complete composition</text></svg>';
    await render.page.evaluate((value) => {
      document.querySelector('.ve-scene').scene = { exportSVG: () => value };
    }, explicit);
    assert.equal(await render.svg(), explicit);
  } finally {
    await render.close();
  }
});

test('the shared header separator and paper region retain their bounds in vector export', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-paper-region-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'index.html');
  await writeFile(
    entry,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body class="ve-standalone"><main class="ve-scene"></main><script type="module">
    import { SceneShell, surface } from '@visual-storytelling/core';
    import '@visual-storytelling/core/style.css';
    window.galleryReady = (async () => {
      await SceneShell.ready();
      const shell = SceneShell.mount(document.querySelector('main'), {title:'Один рисунок'});
      const drawing = surface(shell.stage, {width:1280,height:720,grid:false});
      drawing.pen.line(drawing.layer, 'subject', [200,200], [500,400]);
      shell.onDispose(() => drawing.dispose());
      window.shell = shell;
    })();
    </script>`,
  );
  const output = join(directory, 'dist');
  await buildPage(entry, output, { sourcePackage: true });
  for (const width of [1280, 390])
    for (const theme of ['light', 'dark']) {
      const render = await renderer({ directory: output, width, height: 900, theme });
      try {
        const expected = await render.page.evaluate(() => {
          const sheet = document.querySelector('.ve-scene-content'),
            frame = sheet.getBoundingClientRect(),
            scale = frame.width / sheet.clientWidth,
            paper = sheet.querySelector('.ve-scene-paper').getBoundingClientRect(),
            header = sheet.querySelector('.ve-scene-header'),
            head = header.getBoundingClientRect(),
            weight = parseFloat(getComputedStyle(header).borderBottomWidth);
          return {
            x: (paper.x - frame.x) / scale,
            y: (paper.y - frame.y) / scale,
            width: paper.width / scale,
            height: paper.height / scale,
            separator: (head.bottom - frame.top) / scale - weight / 2,
            weight,
          };
        });
        const exported = await render.page.evaluate(
          (source) => {
            const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
            const papers = [...svg.querySelectorAll('[data-export-paper] > rect[fill^="url("]')];
            const paper = papers[0];
            return {
              papers: papers.length,
              bounds: Object.fromEntries(
                ['x', 'y', 'width', 'height'].map((key) => [key, Number(paper.getAttribute(key))]),
              ),
              lines: [...svg.querySelectorAll('line')].map((line) =>
                Object.fromEntries(
                  ['x1', 'y1', 'x2', 'y2', 'stroke-width'].map((key) => [
                    key,
                    Number(line.getAttribute(key)),
                  ]),
                ),
              ),
              text: [...svg.querySelectorAll('text')].map((node) => node.textContent),
            };
          },
          await render.svg(),
        );
        assert.equal(exported.papers, 1, 'only the paper region carries the notebook grid');
        assert.ok(expected.y > 0, 'the header is outside the paper material');
        for (const key of ['x', 'y', 'width', 'height'])
          assert.ok(
            Math.abs(exported.bounds[key] - expected[key]) < 0.01,
            `${theme}/${width}: ${key}`,
          );
        assert.ok(exported.text.includes('Один рисунок'), 'the heading remains in the composition');
        assert.ok(
          exported.lines.some(
            (line) =>
              line.x1 === 0 &&
              line.x2 === 1280 &&
              Math.abs(line.y1 - expected.separator) < 0.01 &&
              line.y1 === line.y2 &&
              line['stroke-width'] === expected.weight,
          ),
          `the separator matches the visible bottom border: ${JSON.stringify({ expected, lines: exported.lines })}`,
        );
        await render.page.evaluate(() => window.shell.setPresentation('stage'));
        const staged = await render.svg();
        assert.doesNotMatch(staged, /id="export-paper|Один рисунок/);
        await render.page.evaluate(() => window.shell.setPresentation('explanation'));
        assert.match(await render.svg(), /id="export-paper/);
        await render.page.locator('.ve-scene-header').evaluate((header) => {
          header.style.borderBottomStyle = 'dashed';
        });
        await assert.rejects(
          render.svg(),
          completeFrameError,
          'unencoded header borders still fail',
        );
        await render.page.locator('.ve-scene-header').evaluate((header) => {
          header.style.borderBottomStyle = '';
          const arbitrary = document.createElement('div');
          arbitrary.style.cssText = 'height:10px;border-bottom:1px solid black';
          header.after(arbitrary);
        });
        await assert.rejects(
          render.svg(),
          completeFrameError,
          'arbitrary borders are not accepted',
        );
      } finally {
        await render.close();
      }
    }
});

test('the shared shell exports the complete vector composition, current conditions and shared ink', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-vector-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scene = join(directory, 'scene');
  await buildFixture('scene-shell', scene, 'camera.html');
  for (const theme of ['light', 'dark']) {
    const render = await renderer({
      directory: scene,
      width: 1280,
      height: 900,
      theme,
      controls: true,
    });
    try {
      await render.seek(render.info.duration);
      await render.control([
        { type: 'mode', value: 'explore' },
        { type: 'parameters', values: { x: -2.5, y: -1.5 } },
      ]);
      const before = await render.capture.evaluate((scene) => scene.snapshot());
      const expected = await render.page.locator('.ve-scene-content').evaluate((content) => {
        const frame = content.parentElement.getBoundingClientRect();
        return {
          width: Math.round(frame.width),
          height: Math.round(frame.height),
          world: getComputedStyle(content.querySelector('[data-camera-world]')).transform,
          heading: content.querySelector('.ve-heading').textContent,
          grid: content.querySelector('.vs-grid').innerHTML,
        };
      });
      const png = PNG.sync.read(await render.png());
      const output = await render.svg();
      const decoded = await render.page.evaluate(
        async ({ source, raster }) => {
          const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
          const svg = doc.documentElement;
          if (doc.querySelector('parsererror')) throw new Error('Invalid exported SVG');
          const image = new Image();
          const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
          try {
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = raster.width;
            canvas.height = raster.height;
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            return {
              width: image.naturalWidth,
              height: image.naturalHeight,
              viewBox: svg.getAttribute('viewBox'),
              texts: [...svg.querySelectorAll('text')].map((node) => node.textContent),
              world: svg.querySelector('[data-camera-world]').style.transform,
              controls: [...svg.querySelectorAll('[data-control-value]')].map((node) =>
                node.getAttribute('data-control-value'),
              ),
              grids:
                svg.querySelectorAll('.vs-grid').length +
                svg.querySelectorAll('[data-camera-transform] > path').length,
              raster: svg.querySelectorAll('image,foreignObject').length,
              pixels: canvas.toDataURL('image/png').split(',')[1],
            };
          } finally {
            URL.revokeObjectURL(url);
          }
        },
        { source: output, raster: { width: png.width, height: png.height } },
      );
      assert.deepEqual([decoded.width, decoded.height], [1280, 720]);
      assert.ok(
        Math.abs(png.width - expected.width) <= 1 && Math.abs(png.height - expected.height) <= 1,
      );
      assert.equal(decoded.viewBox, '0 0 1280 720');
      assert.ok(decoded.texts.includes(expected.heading), 'the heading belongs to the SVG frame');
      assert.ok(decoded.texts.includes('Одна клетка — один шаг'));
      assert.ok(decoded.texts.includes('(-2.5; -1.5)'));
      assert.deepEqual(
        decoded.controls,
        ['-2.5', '-1.5'],
        'live input values survive in the vector control',
      );
      assert.equal(decoded.world, expected.world, 'the current camera is frozen');
      assert.ok(decoded.grids > 0, 'the measured grid is retained');
      assert.equal(decoded.raster, 0, 'SVG paper, lettering and controls stay vector');
      assert.doesNotMatch(output, /data-player|Читать крупнее|Открыть крупнее/);
      assert.deepEqual(await render.capture.evaluate((scene) => scene.snapshot()), before);
      const vector = PNG.sync.read(Buffer.from(decoded.pixels, 'base64'));
      const difference = (top, bottom) => {
        let total = 0,
          samples = 0;
        for (let y = top; y < bottom; y++)
          for (let x = 0; x < png.width; x++) {
            const offset = (y * png.width + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
              total += Math.abs(png.data[offset + channel] - vector.data[offset + channel]);
              samples++;
            }
          }
        return total / samples;
      };
      assert.ok(
        difference(0, Math.round(png.height * 0.27)) < 12,
        `${theme}: heading/actions match the painted frame`,
      );
      assert.ok(
        difference(Math.round(png.height * 0.27), png.height) < 8,
        `${theme}: SVG and PNG show the same drawing`,
      );
      await mkdir(resolve(repository, 'artifacts/frame-consistency'), { recursive: true });
      await writeFile(
        resolve(repository, `artifacts/frame-consistency/export-composition-${theme}.svg`),
        output,
      );
      await writeFile(
        resolve(repository, `artifacts/frame-consistency/export-composition-${theme}.png`),
        Buffer.from(decoded.pixels, 'base64'),
      );
      await writeFile(
        resolve(repository, `artifacts/frame-consistency/export-composition-${theme}-live.png`),
        PNG.sync.write(png),
      );
      const atomic = await render.page.evaluate(async () => {
        const handle = document.querySelector('.ve-scene').scene;
        const frozen = handle.exportSVG();
        await handle.control([{ type: 'parameters', values: { x: 3, y: 2 } }]);
        const parsed = new DOMParser().parseFromString(await frozen, 'image/svg+xml');
        return [...parsed.querySelectorAll('[data-control-value]')].map((node) =>
          node.getAttribute('data-control-value'),
        );
      });
      assert.deepEqual(atomic, ['-2.5', '-1.5'], 'an intervening edit cannot mix SVG revisions');
      await render.control([{ type: 'select', ids: ['horizontal'] }]);
      const selected = await render.page.evaluate(async () => {
        const selected = document.querySelector('[data-object="horizontal"]');
        const contour = selected.nextElementSibling.querySelector('[data-selection-contour]');
        const style = getComputedStyle(contour);
        const parsed = new DOMParser().parseFromString(
          await document.querySelector('.ve-scene').scene.exportSVG(),
          'image/svg+xml',
        );
        const exported = parsed
          .querySelector('[data-object="horizontal"]')
          .nextElementSibling.querySelector('[data-selection-contour]');
        return {
          visible: style.visibility,
          before: contour.getAttribute('d'),
          after: exported.getAttribute('d'),
          focus: parsed.querySelectorAll('[data-interaction-focus]').length,
        };
      });
      assert.equal(selected.visible, 'visible', 'the selected subject has its semantic contour');
      assert.ok(selected.before.length > 0);
      assert.deepEqual(
        selected.after,
        selected.before,
        'subject selection remains in the exported drawing',
      );
      assert.equal(selected.focus, 0, 'temporary keyboard focus is not part of the drawing');
      const longTitle =
        'Почему направление и величина перемещения сохраняются при изменении системы координат';
      await render.page.locator('.ve-select-trigger').evaluate((element, value) => {
        element.textContent = value;
      }, longTitle);
      const reading = await render.svg();
      const read = await render.page.evaluate((source) => {
        const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
        return {
          size: [
            parsed.documentElement.getAttribute('width'),
            parsed.documentElement.getAttribute('height'),
          ],
          text: [...parsed.querySelectorAll('text')]
            .map((node) => node.textContent)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        };
      }, reading);
      assert.deepEqual(
        read.size,
        ['1280', '720'],
        'the composition keeps its authored logical frame',
      );
      assert.ok(
        read.text.includes(longTitle),
        'the current chapter heading keeps its wrapped text in the complete frame',
      );
      await writeFile(
        resolve(repository, `artifacts/frame-consistency/export-composition-${theme}-long.svg`),
        reading,
      );
      await render.page.setViewportSize({ width: 390, height: 844 });
      await render.page
        .locator('.ve-scene-header .ve-select-trigger')
        .waitFor({ state: 'attached' });
      const compact = await render.svg();
      assert.match(compact, /viewBox="0 0 1280 720"/);
      const compactText = await render.page.evaluate((source) => {
        const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
        return [...parsed.querySelectorAll('text')]
          .map((node) => node.textContent)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      }, compact);
      assert.ok(compactText.includes(longTitle), 'the chapter heading stays in the compact frame');
      const chapter = render.page.getByRole('combobox', { name: 'Глава', exact: true });
      await chapter.evaluate((node, value) => (node.textContent = value), expected.heading);
      await chapter.click();
      const menu = render.page.getByRole('listbox', { name: 'Глава', exact: true });
      await menu.waitFor({ state: 'visible' });
      const menuFont = await menu
        .getByRole('option')
        .first()
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
      const openMenuPNG = PNG.sync.read(await render.png());
      const menuVector = await render.page.evaluate(
        async ({ source, width, height }) => {
          const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
          const host = document.createElement('div');
          host.style.cssText = 'position:fixed;left:-5000px;top:0';
          host.append(document.importNode(parsed.documentElement, true));
          document.body.append(host);
          const svg = host.firstElementChild;
          svg.style.width = width + 'px';
          svg.style.height = height + 'px';
          const first = svg.querySelector('[data-export-chapter-menu] text'),
            matrix = first.getScreenCTM(),
            font = parseFloat(getComputedStyle(first).fontSize) * Math.hypot(matrix.c, matrix.d);
          host.remove();
          const image = new Image(),
            url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
          try {
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(image, 0, 0, width, height);
            return { font, pixels: canvas.toDataURL('image/png').split(',')[1] };
          } finally {
            URL.revokeObjectURL(url);
          }
        },
        { source: await render.svg(), width: openMenuPNG.width, height: openMenuPNG.height },
      );
      assert.ok(
        Math.abs(menuVector.font - menuFont) < 0.2,
        'native chapter menu keeps its physical font size',
      );
      const menuImage = PNG.sync.read(Buffer.from(menuVector.pixels, 'base64'));
      let menuDelta = 0;
      for (let i = 0; i < openMenuPNG.data.length; i++)
        menuDelta += Math.abs(openMenuPNG.data[i] - menuImage.data[i]);
      assert.ok(
        menuDelta / openMenuPNG.data.length < 6,
        'the open chapter menu has the same top-layer geometry in SVG and PNG',
      );
      assert.equal(await menu.evaluate((node) => node.matches(':popover-open')), true);
      await chapter.press('Escape');
      await render.page.setViewportSize({ width: 1280, height: 900 });
      const expanded = await render.svg();
      assert.match(expanded, /viewBox="0 0 1280 720"/);
      await render.page.evaluate(() => {
        const extra = document.createElement('canvas');
        extra.width = extra.height = 20;
        document.querySelector('.ve-stage').append(extra);
      });
      await assert.rejects(
        render.svg(),
        completeFrameError,
        'mixed canvas is never silently omitted',
      );
    } finally {
      await render.close();
    }
  }
});

test('complete SVG preserves native marker filters, skips hidden layers and rejects an unencoded filter', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-marker-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'index.html');
  await writeFile(
    entry,
    `<!doctype html><html><head><meta charset="utf-8"></head><body class="ve-standalone">
    <main class="ve-scene"></main><script type="module">
    import { SceneShell, surface, object, lettering } from '@visual-storytelling/core';
    import '@visual-storytelling/core/style.css';
    window.galleryReady = (async () => {
      await SceneShell.ready();
      const shell = SceneShell.mount(document.querySelector('main'), {title:'Маркер',heading:false});
      const view = surface(shell.stage, {id:'marker-proof',width:1280,height:720,title:'Маркер',description:'Родные SVG эффекты',grid:false});
      const mark = object(view.layer, 'marker', 'orange');
      view.pen.rect(mark.content, 'highlight', 260, 160, 540, 240, {fill:'marker'});
      const text = lettering(mark.content, 'Проверка', {x:530,y:280,size:52});
      const canvas = document.createElement('canvas'); canvas.hidden = true; shell.stage.append(canvas);
      const overlay = document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
      overlay.setAttribute('width','100'); overlay.setAttribute('height','100'); overlay.style.display = 'none';
      overlay.append(document.createElement('div')); view.layer.append(overlay);
      shell.onDispose(() => {text.dispose();view.dispose();});
    })();
    </script></body></html>`,
  );
  const output = join(directory, 'dist');
  await buildPage(entry, output, { sourcePackage: true });
  for (const theme of ['light', 'dark']) {
    const render = await renderer({ directory: output, width: 1280, height: 900, theme });
    try {
      const live = PNG.sync.read(await render.png());
      const source = await render.svg();
      const decoded = await render.page.evaluate(
        async ({ source, width, height }) => {
          const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
          const filters = [...svg.querySelectorAll('[filter]')].map((node) =>
            node.getAttribute('filter'),
          );
          const image = new Image(),
            url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
          try {
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(image, 0, 0, width, height);
            return {
              filters,
              definitions: svg.querySelectorAll('filter feGaussianBlur').length,
              pixels: canvas.toDataURL('image/png').split(',')[1],
              htmlLayers: svg.querySelectorAll('canvas,foreignObject').length,
            };
          } finally {
            URL.revokeObjectURL(url);
          }
        },
        { source, width: live.width, height: live.height },
      );
      assert.ok(decoded.filters.length > 0, 'native marker filter references survive');
      assert.ok(decoded.definitions > 0, 'the filter definition travels with the marker');
      assert.equal(decoded.htmlLayers, 0);
      const vector = PNG.sync.read(Buffer.from(decoded.pixels, 'base64'));
      assert.deepEqual([vector.width, vector.height], [live.width, live.height]);
      let delta = 0;
      for (let i = 0; i < live.data.length; i++) delta += Math.abs(live.data[i] - vector.data[i]);
      assert.ok(
        delta / live.data.length < 3,
        `${theme}: marker output retains its visible appearance (mean difference ${delta / live.data.length})`,
      );
      for (const effect of ['blur(4px)', 'none']) {
        await render.page.evaluate((effect) => {
          const override = document.createElement('style');
          override.id = 'filter-override';
          override.textContent = `.vs-canvas .ve-marker {filter:${effect}}`;
          document.head.append(override);
        }, effect);
        await assert.rejects(
          render.svg(),
          completeFrameError,
          'an overriding CSS effect cannot be silently dropped',
        );
        await render.page.locator('#filter-override').evaluate((node) => node.remove());
      }
      await render.page.locator('canvas').evaluate((canvas) => {
        canvas.hidden = false;
      });
      await assert.rejects(render.svg(), completeFrameError, 'visible canvas cannot be omitted');
      await render.page.locator('canvas').evaluate((canvas) => {
        canvas.hidden = true;
      });
      await render.page.locator('foreignObject').evaluate((node) => {
        node.style.display = '';
      });
      await assert.rejects(render.svg(), completeFrameError, 'visible HTML cannot be omitted');
    } finally {
      await render.close();
    }
  }
});

test('compact construction and SVG overflow export the same visible button and open explanation as vectors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-overflow-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'index.html');
  await writeFile(
    entry,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body class="ve-standalone"><main class="ve-scene"></main><script type="module">
    import { MathMorph, MorphStory, SceneShell, surface, lettering, SvgLayout } from '@visual-storytelling/core';
    import '@visual-storytelling/core/style.css';
    const root = document.querySelector('main');
    window.galleryReady = MorphStory.mount(root, {
      title:'Почему площадь растёт быстрее стороны', presenter:MathMorph, initial:{k:2},
      parameters:[{key:'k',label:'Масштаб стороны k',min:1,max:3,step:.25}],
      script:{duration:16,cues:{scale:{start:2,end:12,action:'Умножить обе стороны.'}},segments:[{id:'scale',start:0,end:16,title:'Два направления роста',text:'Площадь зависит от обеих сторон.'}]},
      chapters:[{id:'scale',operation:({k})=>MathMorph.linear([[k,0],[0,k]])}],
    });
    window.mountLabels = async () => {
      await SceneShell.ready();
      const shell = SceneShell.mount(root, {title:'Подписи',heading:false});
      const view = surface(shell.stage, {width:1280,height:720,grid:false});
      const label = lettering(view.layer, 'Один предмет', {x:640,y:240,size:70});
      const overflow = SvgLayout.overflow(view.layer);
      overflow.reserve();
      overflow.update([{id:'number',subject:'Подробность',label:'Число 4 связано с площадью.'}]);
      shell.onDispose(() => {overflow.dispose();label.dispose();view.dispose();});
    };
    </script>`,
  );
  const output = join(directory, 'dist');
  await buildPage(entry, output, { sourcePackage: true });
  for (const theme of ['light', 'dark']) {
    const render = await renderer({
      directory: output,
      width: 390,
      height: 800,
      theme,
      controls: true,
    });
    try {
      await render.seek(14);
      for (const owner of ['construction', 'layout']) {
        if (owner === 'layout') await render.page.evaluate(() => window.mountLabels());
        const button = render.page.locator('.ve-label-overflow');
        const expected = await button.evaluate((node) => ({
          label: node.textContent,
          font:
            (parseFloat(getComputedStyle(node).fontSize) * node.getBoundingClientRect().height) /
            node.offsetHeight,
        }));
        for (const expanded of [false, true]) {
          if (expanded) {
            await button.click();
            await render.page.locator('.ve-label-overflow-list:popover-open').waitFor();
          }
          const live = PNG.sync.read(await render.png());
          const source = await render.svg();
          const decoded = await render.page.evaluate(
            async ({ source, width, height }) => {
              const document = new DOMParser().parseFromString(source, 'image/svg+xml');
              if (document.querySelector('parsererror'))
                throw new Error('Invalid vector composition');
              const svg = document.documentElement;
              const image = new Image(),
                url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
              try {
                image.src = url;
                await image.decode();
                const canvas = window.document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(image, 0, 0, width, height);
                const pixels = canvas.toDataURL('image/png').split(',')[1];
                const host = window.document.createElement('div');
                host.style.cssText = 'position:fixed;left:-5000px;top:0';
                host.append(window.document.importNode(svg, true));
                window.document.body.append(host);
                const drawing = host.firstElementChild;
                drawing.style.width = width + 'px';
                drawing.style.height = height + 'px';
                const button = drawing.querySelector('[data-export-overflow] text');
                const matrix = button.getScreenCTM();
                const font =
                  parseFloat(getComputedStyle(button).fontSize) * Math.hypot(matrix.c, matrix.d);
                host.remove();
                return {
                  pixels,
                  font,
                  label: button.textContent,
                  panels: svg.querySelectorAll('[data-export-overflow-popover]').length,
                  text: [...svg.querySelectorAll('[data-export-overflow-popover] text')]
                    .map((node) => node.textContent)
                    .join(' '),
                  htmlLayers: svg.querySelectorAll('foreignObject,canvas,image').length,
                };
              } finally {
                URL.revokeObjectURL(url);
              }
            },
            { source, width: live.width, height: live.height },
          );
          assert.equal(decoded.label, expected.label);
          assert.ok(
            Math.abs(decoded.font - expected.font) < 0.2,
            `${owner}: physical lettering survives SVG`,
          );
          if (owner === 'construction') assert.ok(decoded.font >= 17.8);
          assert.equal(decoded.htmlLayers, 0);
          assert.equal(decoded.panels, Number(expanded));
          if (expanded)
            assert.match(
              decoded.text,
              owner === 'construction' ? /Модуль определителя/ : /Число 4 связано с площадью/,
            );
          const vector = PNG.sync.read(Buffer.from(decoded.pixels, 'base64'));
          let delta = 0;
          for (let i = 0; i < live.data.length; i++)
            delta += Math.abs(live.data[i] - vector.data[i]);
          assert.ok(
            delta / live.data.length < 4,
            `${owner}/${theme}/${expanded}: mean image difference ${delta / live.data.length}`,
          );
          if (expanded) await render.page.keyboard.press('Escape');
        }
        await button.evaluate((node) =>
          node.parentElement.append(document.createTextNode('Unrepresented explanation')),
        );
        await assert.rejects(
          render.svg(),
          completeFrameError,
          'additional HTML is never silently omitted',
        );
      }
    } finally {
      await render.close();
    }
  }
});

test('PNG excludes external Conditions while retaining its numeric draft, focus and nested choices', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-conditions-capture-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'index.html');
  await writeFile(
    entry,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body class="ve-standalone"><main class="ve-scene"></main><script type="module">
    import { SceneShell, surface, lettering } from '@visual-storytelling/core';
    import '@visual-storytelling/core/style.css';
    window.galleryReady = (async () => {
      await SceneShell.ready();
      const shell = SceneShell.mount(document.querySelector('main'), {title:'Один рисунок',parameters:[
        {key:'amount',label:'Число',type:'stepper',value:6,min:-10,max:10},
        {key:'method',label:'Действие',type:'select',value:'sum',options:[{value:'sum',label:'Сложить'},{value:'difference',label:'Вычесть'}]},
      ]});
      const view = surface(shell.stage, {width:1280,height:720,grid:false});
      const label = lettering(view.layer, 'Клетка', {x:640,y:360,size:88});
      shell.attachStory({script:{duration:10,cues:{}},stateAt:()=>({amount:6,method:'sum'}),render(){}});
      shell.onDispose(() => {label.dispose();view.dispose();});
    })();
    </script>`,
  );
  const output = join(directory, 'dist');
  await buildPage(entry, output, { sourcePackage: true });
  const render = await renderer({
    directory: output,
    width: 390,
    height: 800,
    theme: 'light',
    controls: true,
  });
  try {
    await render.seek(6);
    await render.control([{ type: 'mode', value: 'explore' }]);
    await render.page.mouse.move(0, 750);
    const closed = PNG.sync.read(await render.png());
    const baseline = await render.page
      .locator('.ve-scene')
      .evaluate((node) => node.scene.capture({ basis: 'requested' }));
    await render.page.getByRole('button', { name: 'Условия', exact: true }).click();
    const panel = render.page.getByRole('dialog', { name: 'Условия объяснения' });
    await panel.waitFor({ state: 'visible' });
    await panel.evaluate((node) => node.style.setProperty('opacity', '0.9', 'important'));
    const input = render.page.getByRole('spinbutton', { name: 'Число' });
    await input.focus();
    await input.press('ControlOrMeta+A');
    await input.press('-');
    await render.page.mouse.move(0, 750);
    const draft = () =>
      input.evaluate((node) => ({
        value: node.value,
        badInput: node.validity.badInput,
        focused: document.activeElement === node,
      }));
    assert.deepEqual(await draft(), { value: '', badInput: true, focused: true });
    const captured = PNG.sync.read(await render.png());
    assert.ok(
      captured.data.equals(closed.data),
      'external controls do not cover the captured composition',
    );
    assert.deepEqual(await draft(), { value: '', badInput: true, focused: true });
    assert.equal(await panel.evaluate((node) => node.matches(':popover-open')), true);
    assert.deepEqual(
      await panel.evaluate((node) => [
        node.style.opacity,
        node.style.getPropertyPriority('opacity'),
      ]),
      ['0.9', 'important'],
    );
    assert.deepEqual(
      await render.page
        .locator('.ve-scene')
        .evaluate((node) => node.scene.capture({ basis: 'requested' })),
      baseline,
    );
    const select = render.page.getByRole('combobox', { name: 'Действие', exact: true });
    await select.press('ArrowDown');
    const choices = render.page.getByRole('listbox', { name: 'Действие', exact: true });
    await choices.waitFor({ state: 'visible' });
    const nested = PNG.sync.read(await render.png());
    assert.ok(
      nested.data.equals(closed.data),
      'nested native choices share the external UI boundary',
    );
    assert.equal(await choices.evaluate((node) => node.matches(':popover-open')), true);
    assert.equal(await choices.evaluate((node) => node.style.opacity), '');
    assert.equal(await select.evaluate((node) => document.activeElement === node), true);
    await select.press('End');
    await select.press('Enter');
    assert.equal((await render.capture.evaluate((scene) => scene.snapshot())).method, 'difference');
    assert.equal(await panel.evaluate((node) => node.matches(':popover-open')), true);
  } finally {
    await render.close();
  }
});
