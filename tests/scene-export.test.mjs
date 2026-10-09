import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { PNG } from 'pngjs';
import { assetURLs } from '../tools/asset-urls.mjs';
import { renderer } from '../tools/render.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const completeFrameError = /complete frame.*PNG or HTML.*exportSVG/;

async function buildExample(name, directory) {
  await mkdir(directory);
  await build({
    entryPoints: [join(repository, 'examples', name, 'scene.js')],
    outfile: join(directory, 'scene.js'),
    bundle: true,
    format: 'esm',
    loader: { '.woff2': 'dataurl', '.png': 'dataurl' },
    plugins: [
      {
        name: 'current-library',
        setup(builder) {
          builder.onResolve(
            {
              filter: /^@visual-storytelling\/core(?:\/(?:ink|controls|recipes|story|style.css))?$/,
            },
            ({ path }) => ({
              path: resolve(
                repository,
                'src',
                path.endsWith('.css')
                  ? 'style.css'
                  : path === '@visual-storytelling/core'
                    ? 'index.ts'
                    : `${path.split('/').at(-1)}/index.ts`,
              ),
            }),
          );
        },
      },
      assetURLs(),
    ],
  });
  const html = await readFile(join(repository, 'examples', name, 'index.html'), 'utf8');
  await writeFile(
    join(directory, 'index.html'),
    html.replace('</head>', '<link rel="stylesheet" href="scene.css"></head>'),
  );
}

test('mixed explanations export a complete PNG and decline a partial SVG', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'story-frame-export-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  for (const name of ['graph-lab', 'area-lesson']) {
    const directory = join(temporary, name);
    await buildExample(name, directory);
    for (const width of [1000, 390]) {
      const render = await renderer({ directory, width, height: 760, theme: 'light' });
      try {
        await assert.rejects(render.svg(), completeFrameError, name);
        const bounds = await render.page.evaluate(() => {
          const scene = document.querySelector('.ve-scene').getBoundingClientRect(),
            notes = document.querySelector('.ve-explanation-notes').getBoundingClientRect();
          return {
            width: scene.width,
            height: scene.height,
            notesRight: notes.right - scene.left,
            notesBottom: notes.bottom - scene.top,
          };
        });
        const before = await render.capture.evaluate((scene) => scene.snapshot());
        const png = PNG.sync.read(await render.png());
        assert.ok(Math.abs(png.width - bounds.width) <= 1, `${name}: complete width`);
        assert.ok(Math.abs(png.height - bounds.height) <= 1, `${name}: complete height`);
        assert.ok(png.width >= bounds.notesRight - 1, `${name}: notes fit horizontally`);
        assert.ok(png.height >= bounds.notesBottom - 1, `${name}: notes fit vertically`);
        assert.deepEqual(
          await render.capture.evaluate((scene) => scene.snapshot()),
          before,
          `${name}: PNG capture retains the model and viewport`,
        );
        // A surface accessor still cannot preserve the HTML beside it.
        await render.page.evaluate(() =>
          document.querySelector('.ve-scene').scene.extend({
            svg: () => document.querySelector('svg.vs-canvas'),
          }),
        );
        await assert.rejects(render.svg(), completeFrameError, `${name}: surface accessor`);
        // A complete exporter remains the authoritative owner, including mixed frames.
        const explicit =
          '<svg xmlns="http://www.w3.org/2000/svg"><text>Complete explanation</text></svg>';
        await render.page.evaluate(
          (value) =>
            document.querySelector('.ve-scene').scene.extend({
              exportSVG: async () => value,
            }),
          explicit,
        );
        assert.equal(await render.svg(), explicit);
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
      <h1 class="ve-heading">A heading outside the SVG stage</h1><div class="ve-stage">
      <svg class="vs-canvas" xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">
        <rect id="unit" x="20" y="20" width="80" height="80" fill="blue"/>
        <text x="20" y="140">One square unit</text>
      </svg>
    </div></div></main></body></html>`,
  );
  const render = await renderer({ directory, width: 400, height: 300 });
  try {
    const svg = await render.svg();
    assert.match(svg, /id="unit"/);
    assert.match(svg, /One square unit/);
    assert.match(svg, /viewBox="0 0 240 160"/);
    await render.page.evaluate(() => {
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
  } finally {
    await render.close();
  }
});
