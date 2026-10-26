import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { buildScene } from '../tools/build-pages.mjs';
import { exportVideo } from '../tools/video-export.mjs';
import { renderer } from '../tools/render.mjs';
const execute = promisify(execFile);

test(
  'a dense comparison retains both cases in the same framed 16:9 silent video',
  { timeout: 90000 },
  async () => {
    const evidence = 'artifacts/slice14/comparison-video';
    const built = evidence + '/built';
    await mkdir(evidence, { recursive: true });
    await buildScene('tools/document-modules/route-comparison', built, {
      sourcePackage: true,
      silent: true,
    });
    const view = await renderer({ directory: built, width: 960, height: 540, controls: true });
    try {
      for (const [time, active] of [
        [0, 'before'],
        [5, 'after'],
      ]) {
        await view.seek(time);
        assert.equal(
          await view.page.locator(`[data-comparison-case="${active}"]`).isVisible(),
          true,
        );
        assert.equal(
          await view.page
            .locator(`[data-comparison-case="${active === 'before' ? 'after' : 'before'}"]`)
            .isVisible(),
          false,
        );
        const pair = (await view.capture.evaluate((scene) => scene.snapshot())).comparison;
        assert.equal(pair.before.state.trace.status, 'blocked');
        assert.equal(pair.after.state.trace.status, 'delivered');
        await writeFile(`${evidence}/${active}.png`, await view.png());
      }
    } finally {
      await view.close();
    }
    const output = `${evidence}/comparison.mp4`;
    const receipt = await exportVideo({
      directory: built,
      width: 960,
      height: 540,
      fps: 2,
      jobs: 1,
      silent: true,
      output,
      theme: 'light',
    });
    const { stdout } = await execute('ffprobe', [
      '-v',
      'error',
      '-show_streams',
      '-of',
      'json',
      output,
    ]);
    const streams = JSON.parse(stdout).streams;
    assert.equal(streams.filter((s) => s.codec_type === 'audio').length, 0);
    const video = streams.find((s) => s.codec_type === 'video');
    assert.equal(video.width, 960);
    assert.equal(video.height, 540);
    assert.equal(Number(video.duration), 6);
    await writeFile(`${evidence}/receipt.json`, JSON.stringify({ receipt, streams }, null, 2));
    for (const [name, time] of [
      ['encoded-before', 0.5],
      ['encoded-after', 4.5],
    ])
      await execute('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-ss',
        String(time),
        '-i',
        output,
        '-frames:v',
        '1',
        `${evidence}/${name}.png`,
      ]);
  },
);
