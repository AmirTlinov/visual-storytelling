import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('beside places labels in their board coordinates and converts explicit spaces through transformed parents', async () => {
  const bundle = await build({
    entryPoints: ['dist/layout/svg.js'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'Layout',
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    await page.setContent(`<svg viewBox="0 0 1280 720" width="1000" height="562.5">
      <g id="board" transform="translate(210 90) scale(.7)">
        <rect x="0" y="0" width="640" height="320" fill="none" />
        <g transform="translate(14 4) rotate(8 300 150)">
          <rect id="target" x="260" y="120" width="90" height="54" />
        </g>
        <g id="labels"><g id="label"><text x="7" y="23" font-size="22">Напряжение</text></g></g>
      </g>
    </svg>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const results = await page.evaluate(() => {
      const { SvgLayout } = Layout;
      const svg = document.querySelector('svg');
      const board = document.querySelector('#board');
      const parent = document.querySelector('#labels');
      const label = document.querySelector('#label');
      const target = document.querySelector('#target');
      const results = [];
      const poses = [
        'translate(210 90) scale(.7)',
        'translate(150 120) rotate(-12) skewX(9) scale(.9 .65)',
        'translate(210 90) scale(.7)',
      ];
      for (const explicit of [false, true]) {
        parent.setAttribute(
          'transform',
          explicit ? 'translate(90 20) rotate(24) skewY(11) scale(1.2 .8)' : 'translate(12 -7)',
        );
        for (const pose of poses) {
          board.setAttribute('transform', pose);
          for (const side of ['bottom', 'top', 'left', 'right']) {
            const options = { side, gap: 12, ...(explicit ? { space: svg } : {}) };
            SvgLayout.beside(label, target, options);
            const placement = label.getAttribute('transform');
            // Repeated rendering must not accumulate the previous placement transform.
            SvgLayout.beside(label, target, options);
            const space = explicit ? svg : parent;
            results.push({
              explicit,
              pose,
              side,
              repeated: label.getAttribute('transform') === placement,
              label: SvgLayout.box(label, space),
              target: SvgLayout.box(target, space),
              placement,
            });
          }
        }
      }
      return results;
    });
    for (const { label, target, side, repeated, explicit } of results) {
      const gap =
        side === 'bottom'
          ? label.y - target.y - target.height
          : side === 'top'
            ? target.y - label.y - label.height
            : side === 'left'
              ? target.x - label.x - label.width
              : label.x - target.x - target.width;
      const alignment =
        side === 'bottom' || side === 'top' ? label.cx - target.cx : label.cy - target.cy;
      assert.ok(Math.abs(gap - 12) < 0.001, `${explicit ? 'root' : 'board'} ${side}: gap ${gap}`);
      assert.ok(Math.abs(alignment) < 0.001, `${side}: centers differ by ${alignment}`);
      assert.equal(repeated, true, 'repeated placement preserves its transform');
      if (!explicit) {
        assert.ok(label.x >= 0 && label.y >= 0);
        assert.ok(label.x + label.width <= 640 && label.y + label.height <= 320);
      }
    }
    for (let offset = 0; offset < results.length; offset += 12) {
      assert.deepEqual(
        results.slice(offset, offset + 4),
        results.slice(offset + 8, offset + 12),
        'returning to the same board pose restores exactly the same label placement',
      );
    }
  } finally {
    await browser.close();
  }
});

test('character boards keep real ink measurable through hidden preparation, presentation and capture', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import {characterSurfaces} from './dist/characters/surfaces.js';
        import {SvgLayout} from './dist/layout/svg.js';
        import {object} from './dist/ink/object.js';
        import {lettering} from './dist/ink/lettering.js';
        import {loadFonts} from './dist/ink/fonts.js';
        import './dist/style.css';
        window.Kit={characterSurfaces,SvgLayout,object,lettering,ready:loadFonts()};`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    outfile: 'svg-beside-board.js',
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    await page.setContent(
      '<main class="ve-scene" style="position:relative;width:800px;height:400px"><canvas width="800" height="400"></canvas></main><section id="presentation"></section>',
    );
    await page.addStyleTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.css')).text,
    });
    await page.addScriptTag({
      content: bundle.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    const result = await page.evaluate(async () => {
      const { characterSurfaces, SvgLayout, object, lettering } = Kit;
      await Kit.ready;
      const parent = document.querySelector('main');
      const canvas = parent.querySelector('canvas');
      const records = [];
      let owner,
        current = 12,
        failDrawing = false;
      const definition = {
        title: 'Измерение тока',
        size: { width: 640, height: 250 },
        create(view) {
          const body = object(view.layer, 'circuit');
          const sourceGroup = object(body.content, 'source-label');
          const source = lettering(sourceGroup.content, '12 В', { size: 23 });
          const meterGroup = object(body.content, 'meter-label');
          const meter = lettering(meterGroup.content, '2 А', { size: 28 });
          const sourceMark = view.pen.line(
            body.content,
            'source-a',
            [66.2, 132.5],
            [100.2, 132.5],
            { width: 2 },
          );
          const meterMark = view.pen.ellipse(body.content, 'ammeter', 531.2, 115, 27, 27, {
            width: 2,
          });
          const obstruction = SvgLayout.element('rect', { x: 280, y: 85, width: 80, height: 45 });
          body.content.append(obstruction);
          const routeLabel = lettering(object(body.content, 'route-label').content, 'I = V / R', {
            size: 22,
          });
          const route = { start: { x: 220, y: 80 }, end: { x: 420, y: 80 } };
          const render = (frame, viewport) => {
            if (frame.values.fail || failDrawing) throw new Error('board preparation failed');
            current = Number(frame.values.voltage);
            source.text(current + ' В');
            source.at(53.2, 122.5);
            meter.at(579.2, 122);
            SvgLayout.beside(source.element, sourceMark.element, {
              side: 'left',
              gap: 12,
              space: body.content,
            });
            SvgLayout.beside(meter.element, meterMark.element, {
              side: 'right',
              gap: 12,
              space: body.content,
            });
            const along = SvgLayout.along(routeLabel.element, route, {
              space: body.content,
              offset: 25,
              avoid: [obstruction],
            });
            const a = SvgLayout.box(source.element, body.content),
              b = SvgLayout.box(sourceMark.element, body.content);
            const c = SvgLayout.box(meter.element, body.content),
              d = SvgLayout.box(meterMark.element, body.content);
            const text = SvgLayout.box(routeLabel.element, body.content),
              obstacle = SvgLayout.box(obstruction, body.content);
            records.push({
              visible: owner?.snapshot().board.visible ?? false,
              width: viewport.width,
              sourceWidth: a.width,
              targetWidth: b.width,
              sourceGap: b.x - a.x - a.width,
              meterGap: c.x - d.x - d.width,
              sourceY: a.cy - b.cy,
              meterY: c.cy - d.cy,
              along: along.status,
              overlaps:
                text.x < obstacle.x + obstacle.width &&
                text.x + text.width > obstacle.x &&
                text.y < obstacle.y + obstacle.height &&
                text.y + text.height > obstacle.y,
            });
          };
          render({ values: { voltage: 12 } }, definition.size);
          return { render, snapshot: () => ({ voltage: current }), dispose: () => body.dispose() };
        },
      };
      const options = {
        set: { width: 640, height: 250, staging: { objects: { board: { kind: 'board' } } } },
        surfaces: { board: definition },
      };
      const graphics = { canvas, renderer: { flush() {}, clear() {} } };
      owner = characterSurfaces(parent, options, graphics, async () => canvas);
      const host = parent.querySelector('[data-surface="board"]');
      const camera = { x: 0, y: 0, width: 640, height: 250 };
      const quad = [
        { x: 0, y: 0 },
        { x: 640, y: 0 },
        { x: 640, y: 250 },
        { x: 0, y: 250 },
      ];
      const frame = (values = {}) => ({
        time: 0,
        progress: 0,
        reduced: true,
        mode: 'story',
        values: { voltage: 12, ...values },
      });
      const initial = { hidden: host.hidden, visible: owner.snapshot().board.visible };
      owner.begin(frame(), camera);
      owner.place('board', quad);
      const placed = owner.snapshot().board.visible;
      owner.begin(frame({ voltage: 24 }), camera);
      owner.place('board', quad);
      owner.resize();
      owner.begin(frame({ fail: true }), camera);
      let failure;
      try {
        owner.place('board', quad);
      } catch (error) {
        failure = error.message;
      }
      const failed = {
        hidden: host.hidden,
        visible: owner.snapshot().board.visible,
        visibility: host.style.visibility,
      };
      owner.begin(frame(), camera);
      owner.place('board', quad);
      const presentation = owner.present('board', document.querySelector('#presentation'));
      presentation.project(undefined);
      owner.begin(frame(), camera);
      owner.place('board', quad);
      presentation.project(quad, 4);
      presentation.project(undefined);
      const beforeCapture = owner.snapshot().board.visible;
      await owner.capture();
      const afterCapture = owner.snapshot().board.visible;
      failDrawing = true;
      let captureFailure;
      try {
        await owner.capture();
      } catch (error) {
        captureFailure = error.message;
      }
      const failedCapture = {
        hidden: host.hidden,
        visible: owner.snapshot().board.visible,
        visibility: host.style.visibility,
      };
      failDrawing = false;
      owner.begin(frame(), camera);
      presentation.project(quad, 4);
      presentation.release();
      owner.dispose();
      return {
        records,
        initial,
        placed,
        failure,
        failed,
        beforeCapture,
        afterCapture,
        captureFailure,
        failedCapture,
        remaining: document.querySelectorAll('[data-surface="board"]').length,
      };
    });
    assert.deepEqual(result.initial, { hidden: true, visible: false });
    assert.equal(result.placed, true);
    assert.equal(
      result.records[0].visible,
      false,
      'creating a measurable board does not publish it',
    );
    assert.equal(
      result.records[1].visible,
      false,
      'the first render remains unpublished until placement',
    );
    assert.ok(
      result.records.length >= 10,
      'exercise rendering, resizing, lending, projection and capture',
    );
    for (const record of result.records) {
      assert.ok(record.sourceWidth > 20, 'the drawn Cyrillic label has measurable ink');
      assert.ok(record.targetWidth > 30, 'the actual pen stroke has measurable geometry');
      assert.ok(Math.abs(record.sourceGap - 12) < 0.001, `source gap ${record.sourceGap}`);
      assert.ok(Math.abs(record.meterGap - 12) < 0.001, `meter gap ${record.meterGap}`);
      assert.ok(
        Math.abs(record.sourceY) < 0.001 && Math.abs(record.meterY) < 0.001,
        'labels align with their measured objects',
      );
      assert.equal(record.along, 'placed');
      assert.equal(record.overlaps, false, 'hidden staging preserves authored obstacles for along');
    }
    assert.equal(result.failure, 'board preparation failed');
    assert.deepEqual(result.failed, { hidden: true, visible: false, visibility: '' });
    assert.equal(result.beforeCapture, false);
    assert.equal(result.afterCapture, false);
    assert.equal(result.captureFailure, 'board preparation failed');
    assert.deepEqual(result.failedCapture, { hidden: true, visible: false, visibility: '' });
    assert.equal(result.remaining, 0);
  } finally {
    await browser.close();
  }
});

test('pending ink chapters preserve static layout obstacles without publishing their paint', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import {chapterPresentations} from './dist/story/composition-presentations.js';
        import {inkChapter} from './dist/story/ink-chapter.js';
        import {SvgLayout} from './dist/layout/svg.js';
        window.Kit={chapterPresentations,inkChapter,SvgLayout};`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 320 } });
    await page.setContent(
      '<style>body{margin:0;background:white}</style><main style="position:relative;width:640px;height:320px"></main>',
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const { chapterPresentations, inkChapter, SvgLayout } = Kit;
      const gate = new Promise((resolve) => {
        window.releaseChapter = resolve;
      });
      const chapter = inkChapter({
        id: 'pending',
        title: 'Связь с предметом',
        text: '',
        seconds: 1,
        size: { width: 640, height: 320 },
        grid: false,
        async create(view) {
          const background = SvgLayout.element('rect', {
            width: 640,
            height: 320,
            fill: '#c00000',
          });
          const obstacle = SvgLayout.element('rect', {
            x: 280,
            y: 85,
            width: 80,
            height: 45,
            fill: 'blue',
          });
          const label = SvgLayout.element('text', { 'font-size': 22, fill: 'black' });
          label.textContent = 'I = V / R';
          view.layer.append(background, obstacle, label);
          const placement = SvgLayout.along(
            label,
            { start: { x: 220, y: 80 }, end: { x: 420, y: 80 } },
            {
              offset: 25,
              space: view.layer,
              avoid: [obstacle],
            },
          );
          const read = () => ({
            placement: placement.status,
            label: SvgLayout.box(label, view.layer),
            obstacle: SvgLayout.box(obstacle, view.layer),
            authoredVisibility: getComputedStyle(obstacle).visibility,
            transform: label.getAttribute('transform'),
          });
          window.createdLayout = read();
          window.readLayout = read;
          await gate;
          return { render() {} };
        },
      });
      window.presentations = chapterPresentations([chapter], document.querySelector('main'));
      window.preparing = presentations.prepare([0], new AbortController().signal);
    });
    await page.waitForFunction(() => window.createdLayout);
    const pending = await page.evaluate(() => {
      const element = document.querySelector('[data-chapter]');
      return {
        layout: createdLayout,
        inert: element.inert,
        hidden: element.hidden,
        clip: getComputedStyle(element).clipPath,
      };
    });
    const pixel = async () =>
      Array.from(
        PNG.sync
          .read(await page.screenshot())
          .data.slice((20 * 640 + 20) * 4, (20 * 640 + 20) * 4 + 4),
      );
    assert.deepEqual(
      await pixel(),
      [255, 255, 255, 255],
      'pending ink never paints before publication',
    );
    assert.equal(pending.inert, true);
    assert.equal(pending.hidden, false, 'preparation has real measurable geometry');
    assert.equal(pending.clip, 'inset(100%)');
    assert.equal(pending.layout.placement, 'placed');
    assert.equal(pending.layout.authoredVisibility, 'visible');
    const { label, obstacle } = pending.layout;
    assert.ok(label.width > 40 && obstacle.width === 80);
    assert.equal(
      label.x < obstacle.x + obstacle.width &&
        label.x + label.width > obstacle.x &&
        label.y < obstacle.y + obstacle.height &&
        label.y + label.height > obstacle.y,
      false,
      'static layout respects an obstacle inside the pending chapter',
    );
    const ready = await page.evaluate(async () => {
      releaseChapter();
      await preparing;
      const element = presentations.get(0).element;
      return { hidden: element.hidden, inert: element.inert, clip: element.style.clipPath };
    });
    assert.deepEqual(ready, { hidden: true, inert: true, clip: '' });
    assert.deepEqual(await pixel(), [255, 255, 255, 255], 'prepared chapter remains unpublished');
    const shown = await page.evaluate(() => {
      const element = presentations.show(0).element;
      return { layout: readLayout(), hidden: element.hidden, inert: element.inert };
    });
    assert.deepEqual(
      shown.layout,
      pending.layout,
      'publication preserves static layout without repair',
    );
    assert.equal(shown.hidden, false);
    assert.equal(shown.inert, false);
    assert.deepEqual(await pixel(), [192, 0, 0, 255], 'the same chapter paints after publication');
    assert.equal(
      await page.evaluate(() => {
        presentations.dispose();
        return document.querySelector('main').children.length;
      }),
      0,
    );
  } finally {
    await browser.close();
  }
});
