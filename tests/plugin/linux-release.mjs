#!/usr/bin/env node
// Actual unpacked release acceptance; the SDK here is only the test MCP client.
import assert from 'node:assert/strict';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execute = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const releaseArgument = process.argv[2];
if (!releaseArgument)
  throw new Error('Usage: node tests/plugin/linux-release.mjs UNPACKED_RELEASE [RECEIPT.json]');
const receiptPath = resolve(
  process.argv[3] ?? `artifacts/plugin/linux-${process.arch}-acceptance.json`,
);
const receipt = {
  result: 'running',
  scope:
    'unpacked Linux release, isolated install, real stdio MCP and offline browser; Codex UI is not exercised',
  startedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  checks: {},
};
let client, browser, activeJob;
const commandOptions = { timeout: 120000, maxBuffer: 2_000_000 };
const jobDeadlineMs = 10 * 60 * 1000;
let stage = 'release';

async function environmentEntries(data) {
  return readdir(join(data, 'environment')).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

async function directoryState(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const result = {};
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    result[entry.name] = entry.isDirectory()
      ? await directoryState(path)
      : hash(await readFile(path));
  }
  return result;
}

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  assert.equal(result.isError, undefined, `${name}: ${JSON.stringify(result)}`);
  assert.ok(result.structuredContent, `${name} has no structured result`);
  return result.structuredContent;
}

async function finish(jobId) {
  activeJob = jobId;
  const deadline = Date.now() + jobDeadlineMs;
  while (Date.now() < deadline) {
    const job = await call('story_inspect', { jobId, waitMs: 15000 });
    if (job.status === 'succeeded') {
      activeJob = undefined;
      return job;
    }
    if (['failed', 'cancelled', 'interrupted'].includes(job.status))
      throw new Error(`Job ${jobId}: ${JSON.stringify(job)}`);
  }
  throw new Error(`Job exceeded ${jobDeadlineMs / 60000} minutes: ${jobId}`);
}

// The neutral scaffold becomes a small authored story through the same public edit path.
const sceneSource = `import { SceneShell, surface, vector, SvgLayout } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.querySelector('main');
  const shell = SceneShell.mount(root, { title: 'Linux release acceptance' });
  const drawing = surface(shell.stage, { id: 'linux-subject', width: 960, height: 540, grid: false });
  const arrow = vector(drawing, 'linux-motion', 'blue');
  const label = SvgLayout.element('text', { 'font-size': 42, fill: 'var(--ve-ink)' });
  label.textContent = 'Linux · движение';
  drawing.layer.append(label);
  shell.onDispose(drawing.dispose);
  shell.attachStory({
    script: { duration: 2, segments: [{ id: 'move', title: 'Движение', text: 'Стрелка движется вправо.', start: 0, end: 2 }], cues: { move: { start: 0, end: 2 } } },
    stateAt: (frame) => ({ progress: frame.progress('move') }),
    render({ progress }) {
      const { width, height } = shell.layout;
      drawing.resize(width, height);
      arrow.set([width * .15, height * .6], [width * (.55 + .25 * progress), height * .6]);
      label.setAttribute('x', width * .15);
      label.setAttribute('y', height * .35);
    },
  });
})();
`;

try {
  assert.equal(process.platform, 'linux', 'Run this acceptance on Linux');
  const generated = await realpath(resolve(releaseArgument));
  const release = JSON.parse(await readFile(join(generated, 'release.json'), 'utf8'));
  assert.equal(release.platform, 'linux');
  assert.equal(release.arch, process.arch);
  receipt.release = release;
  const workspace = await mkdtemp(join(tmpdir(), 'visual-story-linux-'));
  receipt.workspace = workspace;
  stage = 'archive checksum and unpack';
  const archive = join(
    dirname(generated),
    'artifacts/plugin',
    `visual-storytelling-${release.plugin}-linux-${release.arch}.tar.gz`,
  );
  const archiveBytes = await readFile(archive);
  const sidecar = (await readFile(archive + '.sha256', 'utf8')).trim();
  const checksum = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(sidecar);
  assert.ok(checksum, 'Archive SHA-256 sidecar is malformed');
  assert.equal(checksum[2], basename(archive));
  assert.equal(hash(archiveBytes), checksum[1], 'Archive SHA-256 differs from the sidecar');
  const unpacked = join(workspace, 'unpacked');
  await mkdir(unpacked);
  await execute('/usr/bin/tar', ['-xzf', archive, '-C', unpacked], commandOptions);
  const source = await realpath(join(unpacked, basename(generated)));
  assert.deepEqual(JSON.parse(await readFile(join(source, 'release.json'), 'utf8')), release);
  receipt.unpackedDirectory = source;
  receipt.checks.distributionArchive = {
    path: archive,
    bytes: archiveBytes.length,
    sha256: checksum[1],
    freshlyUnpacked: true,
  };
  const installDirectory = join(workspace, 'installation');
  const data = join(workspace, 'data');
  const osBin = join(workspace, 'os-bin');
  await mkdir(osBin);
  const npmCache = join(workspace, 'npm-cache');
  if (process.env.VISUAL_STORY_TEST_NPM_CACHE) {
    await cp(process.env.VISUAL_STORY_TEST_NPM_CACHE, npmCache, { recursive: true });
    receipt.npmCacheFixture = process.env.VISUAL_STORY_TEST_NPM_CACHE;
  }
  // Only the release provides node/npm. Keep the few ordinary OS tools used by packing.
  for (const name of ['sh', 'tar', 'unzip', 'dirname', 'gzip', 'xz', 'uname']) {
    let found;
    for (const directory of ['/usr/bin', '/bin']) {
      const candidate = join(directory, name);
      if (
        await access(candidate, constants.X_OK).then(
          () => true,
          () => false,
        )
      ) {
        found = candidate;
        break;
      }
    }
    assert.ok(found, `Missing operating-system command: ${name}`);
    await symlink(found, join(osBin, name));
  }
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(VISUAL_STORY_|SKETCH_AUDIO_|UV_|PLAYWRIGHT_)/.test(key)) delete env[key];
  Object.assign(env, {
    VISUAL_STORY_DATA_DIR: data,
    VISUAL_STORY_INSTALL_DIR: installDirectory,
    XDG_CACHE_HOME: join(workspace, 'cache'),
    XDG_DATA_HOME: join(workspace, 'xdg-data'),
    XDG_CONFIG_HOME: join(workspace, 'xdg-config'),
    npm_config_cache: npmCache,
    PATH: [join(source, 'runtime/bin'), osBin].join(delimiter),
  });
  const node = join(source, 'runtime/node');
  const native = JSON.parse(
    (
      await execute(
        node,
        [
          '--input-type=module',
          '-e',
          "import sharp from 'sharp'; import { transform } from 'esbuild'; const transformed = await transform('const value: number = 2', {loader:'ts'}); const image = await sharp({create:{width:2,height:2,channels:3,background:'#28458e'}}).png().toBuffer(); console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,execPath:process.execPath,esbuild:transformed.code.includes('const value = 2'),sharpPNG:image.subarray(1,4).toString()==='PNG'}));",
        ],
        { ...commandOptions, cwd: source, env },
      )
    ).stdout,
  );
  assert.equal(native.platform, 'linux');
  assert.equal(native.arch, release.arch);
  assert.equal(native.node, release.node);
  assert.equal(native.esbuild, true);
  assert.equal(native.sharpPNG, true);
  receipt.checks.bundledNodeAndNativeDependencies = native;

  stage = 'install';
  const installed = JSON.parse(
    (
      await execute(
        node,
        [
          join(source, 'plugin/install.mjs'),
          source,
          '--skip-registration',
          '--directory',
          installDirectory,
        ],
        { ...commandOptions, cwd: source, env },
      )
    ).stdout,
  );
  assert.equal(installed.registered, false);
  assert.equal(await realpath(join(installDirectory, 'current')), installed.release);
  const installReceipt = JSON.parse(
    await readFile(join(installed.release, '.installation.json'), 'utf8'),
  );
  assert.equal(installReceipt.digest, installed.digest);
  assert.equal((await stat(installDirectory)).mode & 0o777, 0o700);
  receipt.workspace = workspace;
  receipt.installation = installed;
  receipt.checks.installer = 'passed';

  stage = 'stdio MCP';
  env.PATH = [join(installed.release, 'runtime/bin'), osBin].join(delimiter);
  const transport = new StdioClientTransport({
    command: installed.launcher,
    args: [],
    cwd: data,
    env,
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (bytes) => {
    stderr = (stderr + bytes).slice(-8000);
  });
  await mkdir(data, { recursive: true });
  client = new Client({ name: 'linux-release-acceptance', version: '1' });
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  for (const name of [
    'story_help',
    'story_open',
    'story_create',
    'story_edit',
    'story_inspect',
    'story_produce',
    'story_voice',
  ])
    assert.ok(
      tools.some((tool) => tool.name === name),
      `Missing MCP tool: ${name}`,
    );
  const help = await call('story_help', { queries: ['SceneShell.mount', 'SceneHandle'] });
  assert.deepEqual(help.missing, []);
  assert.match(help.text, /SceneHandle/);
  const exemplar = await call('story_open', { example: 'gpt-model' });
  assert.ok(exemplar.sessionId);
  assert.ok(exemplar.buildRevision);
  const resourceUri = tools.find((tool) => tool.name === 'story_open')._meta.ui.resourceUri;
  const resource = (await client.readResource({ uri: resourceUri })).contents[0];
  assert.match(resource.mimeType, /html/);
  assert.match(resource.text, /<html\b/i);
  receipt.checks.mcpDiscoveryAndExemplar = {
    sessionId: exemplar.sessionId,
    resourceUri,
    resourceBytes: Buffer.byteLength(resource.text),
  };

  stage = 'voice inspection';
  const beforeVoice = await environmentEntries(data);
  const voice = await call('story_voice');
  assert.equal(voice.ready, false);
  assert.equal(voice.supported, false);
  assert.match(voice.reason, /MLX.*macOS Apple Silicon/);
  assert.ok(voice.voices.every((item) => item.ready === false && item.supported === false));
  assert.deepEqual(
    await environmentEntries(data),
    beforeVoice,
    'Voice inspection prepared resources',
  );
  receipt.checks.voiceInspection = {
    ready: voice.ready,
    supported: voice.supported,
    reason: voice.reason,
    requirements: voice.requirements,
  };

  stage = 'create neutral project';
  const created = await call('story_create', {
    title: 'Linux release acceptance',
    requestId: randomUUID(),
  });
  const creation = await finish(created.job.id);
  let project = await call('story_inspect', { projectId: created.project.id });
  assert.equal(project.entry, 'index.html');
  assert.ok(project.files['scene.js']);
  assert.match(project.sourceRevision, /^[a-f0-9]{64}$/);
  const manifest = JSON.parse(await readFile(join(project.path, 'package.json'), 'utf8'));
  const dependency = manifest.dependencies['@visual-storytelling/core'];
  const pin = /^file:\.\/dependencies\/visual-storytelling-core-([a-f0-9]{64})\.tgz$/.exec(
    dependency,
  );
  assert.ok(pin, 'Project runtime is not content-addressed');
  assert.equal(hash(await readFile(join(project.path, dependency.slice(7)))), pin[1]);
  const pinnedHelp = await call('story_help', {
    projectId: project.id,
    queries: ['SceneShell.mount', 'SceneHandle'],
  });
  assert.deepEqual(pinnedHelp.missing, []);
  assert.match(pinnedHelp.text, /SceneHandle/);
  receipt.checks.neutralProjectAndPinnedRuntime = {
    projectId: project.id,
    path: project.path,
    runtimeSHA256: pin[1],
    buildRevision: creation.result.buildRevision,
  };

  stage = 'unsupported voice rejects without mutations';
  assert.equal(
    await access(join(project.path, 'voice.json')).then(
      () => true,
      () => false,
    ),
    false,
  );
  const jobsBeforeVoice = (await readdir(join(data, 'jobs'))).sort();
  const historyBeforeVoice = await directoryState(join(project.path, '.vstory'));
  const rejectedProviders = [];
  for (const provider of ['higgs', 'macos', 'local', 'api']) {
    const rejected = await client.callTool(
      {
        name: 'story_voice',
        arguments: {
          context: project.context,
          requestId: randomUUID(),
          enabled: true,
          provider,
          language: 'ru-RU',
        },
      },
      undefined,
      { timeout: 60000 },
    );
    assert.equal(rejected.isError, true, `${provider} was enabled on Linux`);
    const reason = rejected.content
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n');
    assert.match(
      reason,
      provider === 'higgs'
        ? /MLX.*macOS Apple Silicon/
        : provider === 'macos'
          ? /Invalid|Unsupported|higgs.*local.*api/is
          : /model|adapter/i,
    );
    assert.equal(
      (await call('story_inspect', { projectId: project.id })).sourceRevision,
      project.sourceRevision,
    );
    assert.equal(
      await access(join(project.path, 'voice.json')).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.deepEqual((await readdir(join(data, 'jobs'))).sort(), jobsBeforeVoice);
    assert.deepEqual(await directoryState(join(project.path, '.vstory')), historyBeforeVoice);
    assert.deepEqual(await environmentEntries(data), beforeVoice);
    rejectedProviders.push({ provider, reason });
  }
  receipt.checks.unsupportedVoiceRejectsWithoutMutations = rejectedProviders;

  stage = 'author a timed scene';
  const edited = await call('story_edit', {
    context: project.context,
    requestId: randomUUID(),
    changes: [{ path: 'scene.js', content: sceneSource }],
  });
  const built = await finish(edited.job.id);
  project = await call('story_inspect', { projectId: project.id });
  assert.notEqual(
    project.sourceRevision,
    edited.project.previousSourceRevision ?? created.project.sourceRevision,
  );
  assert.equal(await readFile(join(project.path, 'scene.js'), 'utf8'), sceneSource);
  const opened = await call('story_open', { projectId: project.id });
  assert.equal(opened.projectId, project.id);
  assert.equal(opened.buildRevision, built.result.buildRevision);
  receipt.checks.writableAuthoringAndOpen = {
    sourceRevision: project.sourceRevision,
    buildRevision: opened.buildRevision,
    sessionId: opened.sessionId,
  };

  stage = 'produce HTML PNG MP4';
  const produced = await call('story_produce', {
    target: { kind: 'working', context: project.context },
    requestId: randomUUID(),
    options: {
      formats: ['html', 'png', 'mp4'],
      silent: true,
      width: 640,
      fps: 3,
      video: { kind: 'interval', from: 0, to: 1 },
    },
  });
  const production = await finish(produced.id);
  const output = production.result;
  assert.equal(output.sourceRevision, project.sourceRevision);
  const paths = Object.fromEntries(
    ['html', 'png', 'mp4'].map((extension) => {
      const file = output.files.find((file) => file.endsWith('.' + extension));
      assert.ok(file, `Missing ${extension} output`);
      return [extension, file];
    }),
  );
  const html = await readFile(paths.html, 'utf8');
  assert.match(html, /data:[^;,]*woff[^;,]*;base64,/);
  assert.ok(!/<script[^>]+\bsrc=/i.test(html), 'HTML has an external script');
  const requireRelease = createRequire(join(installed.release, 'package.json'));
  const sharp = requireRelease('sharp');
  const png = await sharp(paths.png).metadata();
  assert.equal(png.format, 'png');
  assert.ok(png.width > 0 && png.width <= 640);
  assert.ok(png.height > 0);
  assert.ok(Math.abs(png.width * 9 - png.height * 16) <= 16, 'PNG frame is not 16:9');
  const imageStats = await sharp(paths.png).removeAlpha().stats();
  assert.ok(
    imageStats.channels.some((channel) => channel.stdev > 5),
    'PNG frame is blank',
  );

  stage = 'offline HTML and video decode';
  // Rebind the already prepared tools into this test process; no resource is missing now.
  const entries = await environmentEntries(data);
  assert.ok(entries.some((entry) => entry.startsWith('chromium-')));
  assert.ok(entries.some((entry) => entry.startsWith('ffmpeg-')));
  const { prepareEnvironment } = await import(
    pathToFileURL(join(installed.release, 'tools/environment.mjs')).href
  );
  const previousEnv = { ...process.env };
  Object.assign(process.env, env);
  try {
    await prepareEnvironment(data, { browser: true, encoder: true, progress: () => {} });
    const { chromium } = requireRelease('playwright');
    browser = await chromium.launch({ executablePath: process.env.VISUAL_STORY_CHROMIUM });
    // PNG width is the browser viewport. The exporter crops its rendered scene frame;
    // MP4 subsequently scales/pads that crop to the requested video dimensions.
    const context = await browser.newContext({ viewport: { width: 640, height: 1200 } });
    await context.setOffline(true);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(paths.html).href);
    await page.evaluate(() => window.galleryReady);
    const offline = await page.evaluate(() => {
      const scene = document.querySelector('main').scene;
      return {
        checkpoint: scene.capture(),
        fonts: document.fonts.status,
        bodyText: document.body.textContent,
        frame: (() => {
          const { x, y, width, height } = document
            .querySelector('[data-scene-frame]')
            .getBoundingClientRect();
          return { x, y, width, height };
        })(),
      };
    });
    assert.equal(offline.fonts, 'loaded');
    assert.match(offline.bodyText, /Linux/);
    assert.equal(offline.checkpoint.mode, 'story');
    assert.deepEqual(errors, []);
    assert.ok(Math.abs(offline.frame.width / offline.frame.height - 16 / 9) < 0.001);
    assert.ok(
      Math.abs(png.width - offline.frame.width) <= 1,
      'PNG width differs from the rendered frame crop',
    );
    assert.ok(
      Math.abs(png.height - offline.frame.height) <= 1,
      'PNG height differs from the rendered frame crop',
    );
    await browser.close();
    browser = undefined;
    const decoded = await execute(
      'ffmpeg',
      ['-nostdin', '-hide_banner', '-i', paths.mp4, '-f', 'null', '-'],
      {
        ...commandOptions,
        env: process.env,
      },
    );
    assert.match(decoded.stderr, /Video: h264/);
    assert.match(decoded.stderr, /640x360/);
    assert.match(decoded.stderr, /Duration: 00:00:01\.0\d/);
    assert.ok(!/Stream[^\n]*Audio:/.test(decoded.stderr), 'Silent MP4 has an audio stream');
    const delivery = JSON.parse(await readFile(join(output.directory, 'delivery.json'), 'utf8'));
    assert.equal(delivery.video.frames, 3);
    assert.equal(delivery.video.duration, 1);
    receipt.checks.offlineHTMLAndExports = {
      outputDirectory: output.directory,
      files: await Promise.all(
        Object.entries(paths).map(async ([format, path]) => {
          const bytes = await readFile(path);
          return { format, path, bytes: bytes.length, sha256: hash(bytes) };
        }),
      ),
      png: {
        width: png.width,
        height: png.height,
        channelStandardDeviations: imageStats.channels.map((channel) => channel.stdev),
      },
      video: {
        codec: 'h264',
        width: 640,
        height: 360,
        duration: delivery.video.duration,
        frames: delivery.video.frames,
        decoded: true,
        silent: true,
      },
      offline: {
        fonts: offline.fonts,
        mode: offline.checkpoint.mode,
        frame: offline.frame,
        pageErrors: errors,
      },
    };
  } finally {
    for (const key of Object.keys(process.env))
      if (!Object.hasOwn(previousEnv, key)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
  assert.ok(
    !(await environmentEntries(data)).some((entry) => entry.startsWith('higgs-')),
    'Silent route prepared Higgs',
  );
  assert.equal(
    await access(join(env.XDG_CACHE_HOME, 'sketch-visualization/models')).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(
    (await call('story_inspect', { projectId: project.id })).sourceRevision,
    project.sourceRevision,
  );
  const { releaseDigest } = await import(
    pathToFileURL(join(installed.release, 'plugin/install.mjs')).href
  );
  assert.equal(
    await releaseDigest(installed.release),
    installed.digest,
    'Acceptance changed the immutable installed release',
  );
  receipt.checks.noVoicePreparationOrSourceMutation = 'passed';
  receipt.mcpStderr = stderr || undefined;
  receipt.result = 'passed';
} catch (error) {
  receipt.result = 'failed';
  receipt.stage = stage;
  receipt.error = error.stack ?? error.message;
  if (activeJob && client) {
    try {
      await call('story_cancel', { jobId: activeJob });
    } catch {}
  }
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await client?.close().catch(() => {});
  receipt.finishedAt = new Date().toISOString();
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(
    JSON.stringify({
      result: receipt.result,
      platform: receipt.platform,
      arch: receipt.arch,
      stage: receipt.stage,
      receipt: receiptPath,
      error: receipt.result === 'failed' ? receipt.error.split('\n')[0] : undefined,
    }),
  );
}
