import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPage } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';
import { exportVideo } from '../tools/video-export.mjs';
const execute = promisify(execFile);
async function rms(file) {
  const { stdout } = await execute(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '24000', '-'],
    { encoding: 'buffer', maxBuffer: 2000000 },
  );
  const samples = new Float32Array(
    stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength),
  );
  return (a, b) => {
    const values = samples.slice(a * 24000, b * 24000);
    return Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length);
  };
}
for (const ordinary of [false, true])
  test(
    `${ordinary ? 'ordinary author' : 'prepared document'} frozen experiment video keeps its inputs and excludes invalid whole takes from the final mixed track`,
    { timeout: 60000 },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'story-speech-delivery-'));
      const evidence = 'artifacts/slice11/export-output' + (ordinary ? '-ordinary' : '');
      await mkdir(evidence, { recursive: true });
      try {
        const source = join(directory, 'source'),
          built = join(directory, 'dist');
        await cp('tests/fixtures/speech-units', source, { recursive: true });
        await mkdir(join(source, 'node_modules/@visual-storytelling'), { recursive: true });
        await symlink(resolve('.'), join(source, 'node_modules/@visual-storytelling/core'), 'dir');
        const file = join(source, 'scene.js');
        const text = await readFile(file, 'utf8');
        let scene = text.replace(
          "return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));",
          "return 'data:audio/wav;base64,'+btoa(Array.from(new Uint8Array(bytes),x=>String.fromCharCode(x)).join(''));",
        );
        if (ordinary) {
          scene = scene.replace('{ IllustratedStory }', '{ IllustratedStory, SceneShell }');
          const start = scene.indexOf('window.galleryReady = IllustratedStory.mount');
          const end = scene.indexOf('window.outputBytes', start);
          scene =
            scene.slice(0, start) +
            `
window.galleryReady=(async()=>{
  let story;
  const shell=await SceneShell.mount(window.document.querySelector('main'),{title:'Предметы',
    parameters:[{key:'count',label:'Количество',value:17,min:1,max:30,step:1}],
    onInput:values=>story?.input(values)});
  story=shell.attachStory({script,audio,stateAt:()=>({count:17,divisor:4}),derive:values=>values,
    speechApplicable:(unit,moment)=>unit.conditions.models.every(model=>Object.entries(model.inputs).every(([key,value])=>moment.values[key]===value)),
    render:values=>{shell.stage.textContent=String(values.count);shell.stage.dataset.count=String(values.count);}});
  return window.lab={shell,story,scene:window.document.querySelector('main').scene};
})();
` +
            scene.slice(end);
        }
        await writeFile(file, scene);
        await buildPage(join(source, 'index.html'), built);
        const view = await renderer({ directory: built });
        let checkpoint;
        try {
          await view.control([
            { type: 'seek', time: 4.5 },
            { type: 'parameters', values: { count: 18 } },
          ]);
          checkpoint = await view.page.evaluate(() =>
            document.querySelector('main').scene.capture(),
          );
          assert.equal(checkpoint.values.count, 18);
          assert.equal(checkpoint.mode, 'explore');
          assert.equal(checkpoint.time, 4.5);
        } finally {
          await view.close();
        }
        const frozen = await renderer({ directory: built, checkpoint });
        try {
          await frozen.seek(0);
          const shown = await frozen.page.evaluate(() =>
            document.querySelector('main').scene.inspect({ presentation: false }),
          );
          assert.equal(shown.mode, 'explore');
          assert.equal(shown.parameters.find((parameter) => parameter.key === 'count').value, 18);
          assert.equal(shown.time, 0);
        } finally {
          await frozen.close();
        }
        const receipts = {};
        for (const [name, options] of [
          ['authored', {}],
          ['experiment', { checkpoint }],
          ['silent', { checkpoint, silent: true }],
        ]) {
          const output = join(evidence, name + '.mp4');
          receipts[name] = await exportVideo({
            directory: built,
            output,
            fps: 4,
            jobs: 2,
            width: 960,
            ...options,
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
          assert.equal(
            streams.filter((s) => s.codec_type === 'audio').length,
            name === 'silent' ? 0 : 1,
          );
          if (name !== 'silent') {
            const level = await rms(output);
            receipts[name].rms = {
              look: level(0.3, 1.7),
              number: level(2.3, 3.7),
              try: level(4.3, 5.7),
              check: level(6.3, 7.7),
            };
            assert(
              receipts[name].rms.look > 0.02 && receipts[name].rms.try > 0.02,
              JSON.stringify(receipts[name]),
            );
            if (name === 'experiment') {
              assert(
                receipts[name].rms.number < 0.001 && receipts[name].rms.check < 0.001,
                JSON.stringify(receipts[name]),
              );
              assert.deepEqual(
                receipts[name].speech.excludedUnits.map((unit) => unit.id),
                ['voice.lesson.number', 'voice.lesson.check'],
              );
            } else assert(receipts[name].rms.number > 0.02 && receipts[name].rms.check > 0.02);
          }
          await execute('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-']);
        }
        const interval = join(evidence, 'interval.mp4');
        receipts.interval = await exportVideo({
          directory: built,
          output: interval,
          from: 2.5,
          to: 3.5,
          width: 960,
          fps: 4,
          jobs: 1,
        });
        assert(
          (await rms(interval))(0.1, 0.9) < 0.001,
          'interval must not export a middle fragment of a take',
        );
        await writeFile(
          join(evidence, 'receipt.json'),
          JSON.stringify({ checkpoint, receipts }, null, 2) + '\n',
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
