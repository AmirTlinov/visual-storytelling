import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { environmentProfile } from '../tools/environment/resources.mjs';

const execute = promisify(execFile);
const environmentModule = new URL('../tools/environment.mjs', import.meta.url).href;
const profileModule = new URL('../tools/environment/resources.mjs', import.meta.url).href;
const voiceModule = new URL('../tools/environment/voice.mjs', import.meta.url).href;

test('Linux browser profiles match the installed Playwright version and their native architecture', async () => {
  const browsers = JSON.parse(
    await readFile(new URL('../node_modules/playwright-core/browsers.json', import.meta.url)),
  );
  const version = browsers.browsers.find(
    ({ name }) => name === 'chromium-headless-shell',
  ).browserVersion;
  for (const [arch, browserTarget, uvTarget, ffmpegTarget] of [
    ['x64', 'linux64', 'x86_64-unknown-linux-gnu', 'linux64'],
    ['arm64', 'linux-arm64', 'aarch64-unknown-linux-gnu', 'linuxarm64'],
  ]) {
    const { resources, encoder } = environmentProfile('linux', arch);
    assert.equal(encoder, 'libx264');
    assert.equal(resources.chromium.version, version);
    assert.ok(
      resources.chromium.url.endsWith(
        `/${browserTarget}/chrome-headless-shell-${browserTarget}.zip`,
      ),
    );
    assert.equal(
      resources.chromium.binary,
      `chrome-headless-shell-${browserTarget}/chrome-headless-shell`,
    );
    assert.ok(resources.uv.binary.startsWith(`uv-${uvTarget}/`));
    assert.ok(resources.ffmpeg.binary.includes(`-${ffmpegTarget}-gpl-8.1/bin/ffmpeg`));
    for (const resource of Object.values(resources)) {
      assert.match(resource.digest, /^[a-f0-9]{64}$/);
      assert.equal(new URL(resource.url).protocol, 'https:');
    }
  }
  assert.equal(environmentProfile('win32', 'x64'), undefined);
});

test('Linux refuses Higgs before touching tools, Python dependencies or speech models', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-linux-voice-'));
  try {
    for (const arch of ['x64', 'arm64'])
      await execute(process.execPath, [
        '--input-type=module',
        '-e',
        `
        import assert from 'node:assert/strict';
        import {readdir} from 'node:fs/promises';
        import {prepareEnvironment,environmentStatus} from ${JSON.stringify(environmentModule)};
        import {prepareVoiceEnvironment} from ${JSON.stringify(voiceModule)};
        Object.defineProperty(process,'platform',{value:'linux'});
        Object.defineProperty(process,'arch',{value:process.argv[2]});
        globalThis.fetch=()=>{throw Error('Unsupported voice must not download')};
        const task={signal:new AbortController().signal,progress(){throw Error('Unsupported voice must not prepare')}};
        await assert.rejects(prepareEnvironment(process.argv[1],{...task,voice:true,browser:true,encoder:true,python:true}),/MLX.*macOS Apple Silicon/);
        await assert.rejects(prepareVoiceEnvironment(process.argv[1],process.execPath,task),/MLX.*macOS Apple Silicon/);
        const status=await environmentStatus(process.argv[1]);
        assert.equal(status.higgs.supported,false);assert.equal(status.higgs.ready,false);assert.equal(status.higgs.stage,'unsupported');
        assert.deepEqual(await readdir(process.argv[1]),[]);
      `,
        directory,
        arch,
      ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Linux preparation extracts a nested xz tool, records provenance and rejects corrupted downloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-linux-resource-'));
  try {
    const root = join(directory, 'fixture', 'ffmpeg-test', 'bin');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'ffmpeg'), '#!/bin/sh\nprintf "fixture encoder\\n"\n');
    const archive = join(directory, 'fixture.tar.xz');
    await execute('/usr/bin/tar', [
      '-cJf',
      archive,
      '-C',
      join(directory, 'fixture'),
      'ffmpeg-test',
    ]);
    await execute(process.execPath, [
      '--input-type=module',
      '-e',
      `
      import assert from 'node:assert/strict';
      import {createHash} from 'node:crypto';
      import {readFile,writeFile,readdir} from 'node:fs/promises';
      import {join,dirname} from 'node:path';
      import {environmentProfile} from ${JSON.stringify(profileModule)};
      import {prepareEnvironment,configureEnvironment,environmentStatus} from ${JSON.stringify(environmentModule)};
      Object.defineProperty(process,'platform',{value:'linux'});Object.defineProperty(process,'arch',{value:'arm64'});
      const resource=environmentProfile().resources.ffmpeg;
      const bytes=await readFile(process.argv[2]);
      resource.version='fixture';resource.binary='ffmpeg-test/bin/ffmpeg';resource.digest=createHash('sha256').update(bytes).digest('hex');
      let downloads=0;
      globalThis.fetch=async url=>{assert.equal(url,resource.url);downloads++;return new Response(bytes)};
      const options={encoder:true,progress(){}};
      await prepareEnvironment(process.argv[1],options);
      const prepared=join(process.argv[1],'environment','ffmpeg-fixture');
      const binary=join(prepared,resource.binary);
      const receipt=JSON.parse(await readFile(join(prepared,'receipt.json')));
      assert.equal(receipt.license,'GPL-3.0-or-later');assert.equal(receipt.licenseURL,resource.licenseURL);assert.equal(receipt.upstreamSource,resource.upstreamSource);assert.equal(receipt.sourceCode,resource.sourceCode);assert.equal(receipt.source,resource.url);
      assert.equal(process.env.VISUAL_STORY_VIDEO_ENCODER,'libx264');
      await prepareEnvironment(process.argv[1],options);assert.equal(downloads,1);
      process.env.PATH=process.env.PATH.split(':').filter(p=>p!==dirname(binary)).join(':');
      await configureEnvironment(process.argv[1]);assert.equal(process.env.PATH.split(':')[0],dirname(binary));
      assert.equal((await environmentStatus(process.argv[1])).ffmpeg.ready,true);
      await writeFile(binary,'corrupted');
      globalThis.fetch=async()=>new Response('bad archive');
      await assert.rejects(prepareEnvironment(process.argv[1],options),/integrity check/);
      assert.equal(await readFile(binary,'utf8'),'corrupted');
      assert.deepEqual(await readdir(join(process.argv[1],'environment')),['ffmpeg-fixture']);
    `,
      join(directory, 'data'),
      archive,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
