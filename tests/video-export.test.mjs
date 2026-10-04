import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { svgRuntime } from '../tools/svg-runtime.mjs';

test('MP4 keeps a circle circular when a chapter changes the HTML frame height', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-video-'));
  try {
    const runtime = await svgRuntime({ '': ['mountScene'] });
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html><head><style>
      body{margin:10px}.ve-scene{width:355px}h1{font:30px/1.4 sans-serif;margin:0}
      svg{display:block;width:355px;height:300px}
      </style></head><body><main class="ve-scene"><h1>Short</h1><svg viewBox="0 0 355 300"><circle fill="red" cx="177" cy="150" r="60"/></svg></main><script>
      ${runtime}
      VisualStory.mountScene(document.querySelector('main'),{duration:2,dispose(){},pause(){},seek(t){document.querySelector('h1').textContent=t<1?'Short':'A much longer chapter heading that wraps into several lines above the same circular shape';}});
      </script></body></html>`,
    );
    for (const height of [undefined, 640]) {
      const output = join(directory, `circle-${height ?? 'auto'}.mp4`);
      execFileSync(
        process.execPath,
        [
          resolve('tools/export.mjs'),
          '--directory',
          directory,
          '--format',
          'mp4',
          '--fps',
          '2',
          '--width',
          '375',
          '--out',
          output,
          ...(height ? ['--height', String(height)] : []),
        ],
        { stdio: 'pipe' },
      );
      const frames = [];
      for (const time of [0, 1.5]) {
        const png = join(directory, `frame-${time}.png`);
        execFileSync(
          'ffmpeg',
          [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            String(time),
            '-i',
            output,
            '-frames:v',
            '1',
            png,
          ],
          { stdio: 'pipe' },
        );
        const image = PNG.sync.read(await readFile(png));
        let minX = image.width,
          maxX = 0,
          minY = image.height,
          maxY = 0;
        for (let y = 0; y < image.height; y++)
          for (let x = 0; x < image.width; x++) {
            const i = (y * image.width + x) * 4;
            if (image.data[i] > 170 && image.data[i + 1] < 70 && image.data[i + 2] < 70) {
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
              minY = Math.min(minY, y);
              maxY = Math.max(maxY, y);
            }
          }
        assert(maxX > minX && maxY > minY, 'circle must remain visible');
        assert(
          Math.abs((maxX - minX) / (maxY - minY) - 1) < 0.04,
          'circle must preserve its aspect ratio',
        );
        if (height) assert.equal(image.height, height);
        frames.push([image.width, image.height]);
      }
      assert.deepEqual(frames[0], frames[1]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
