import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse } from 'parse5';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { closeSceneDependencies } from '../tools/scene-project.mjs';
import { deliver } from '../tools/deliver.mjs';
import { writeBuildInfo } from '../tools/build-info.mjs';
import { captionSource } from '../tools/caption-source.mjs';

const scripts = (html) => {
  const result = [];
  const visit = (node) => {
    if (node.tagName === 'script') result.push(node.childNodes.map((n) => n.value ?? '').join(''));
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(html));
  return result;
};

test('a mounted page cannot silently borrow an unrelated audio-only caption timeline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-caption-owner-'));
  try {
    const timeline = {
      duration: 2,
      segments: [{ id: 'speech', start: 0, end: 2, text: 'Audio only' }],
    };
    await writeFile(join(directory, 'timeline.json'), JSON.stringify(timeline));
    assert.deepEqual(await captionSource(directory), timeline);
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><main class="ve-scene">A separate illustration</main>',
    );
    await assert.rejects(captionSource(directory), /Register the scene/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a nested TypeScript module keeps its asset through build and offline packing; inert scripts stay inert', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scene-resource-'));
  try {
    await mkdir(join(root, 'modules'));
    await writeFile(join(root, '.private.html'), '<script src="missing.js"></script>');
    await mkdir(join(root, 'modules/artifacts'));
    await writeFile(join(root, 'modules/artifacts/private.json'), '{}');
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><HTML><HEAD></HEAD><BODY><!-- <script src="absent.js"></script> --><template><script>throw new Error("inert")</script></template><script type=module src="./modules/scene.ts"></script></BODY></HTML>',
    );
    await writeFile(join(root, 'modules/model.glb'), Buffer.from('local-model-payload'));
    await writeFile(join(root, 'modules/decoder.js'), 'var Decoder = () => 42;');
    await writeFile(
      join(root, 'modules/scene.ts'),
      `
      const example: string = "new URL('./absent.glb', import.meta.url)";
      // new URL('./absent.glb', import.meta.url)
      globalThis.asset = new URL('./model.glb', import.meta.url).href;
      globalThis.decoder = new URL('./decoder.js', import.meta.url).href;
      globalThis.example = example;`,
    );
    const out = join(root, 'dist');
    await buildScene(root, out);
    await assert.rejects(readFile(join(out, '.private.html')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(out, 'modules/artifacts/private.json')), { code: 'ENOENT' });
    const builtHTML = await readFile(join(out, 'index.html'), 'utf8');
    const html = await packDirectory(out);
    const context = { URL, document: { baseURI: 'file:///recipient/story.html' } };
    for (const code of scripts(html)) runInNewContext(code, context);
    assert.equal(
      Buffer.from(context.asset.split(',')[1], 'base64').toString(),
      'local-model-payload',
    );
    assert.equal(
      Buffer.from(context.decoder.split(',')[1], 'base64').toString(),
      'var Decoder = () => 42;',
    );
    assert.equal(context.example, "new URL('./absent.glb', import.meta.url)");
    assert(html.includes('<!-- <script src="absent.js"></script> -->'));
    assert(html.includes('<template><script>throw new Error("inert")</script></template>'));
    await writeFile(
      join(root, 'modules/scene.ts'),
      'const file = location.hash; new URL(file, import.meta.url)',
    );
    await assert.rejects(buildScene(root, out), /must name a static file/);
    assert.equal(await readFile(join(out, 'index.html'), 'utf8'), builtHTML);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('source delivery closes an external archive and a local directory with its own local dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scene-local-dependencies-'));
  const execute = promisify(execFile);
  const source = join(root, 'scene'),
    delivered = join(root, 'recipient');
  const putPackage = async (name, manifest, code) => {
    const path = join(root, name);
    await mkdir(path);
    await writeFile(
      join(path, 'package.json'),
      JSON.stringify({
        name,
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
        files: ['index.js'],
        ...manifest,
      }),
    );
    await writeFile(join(path, 'index.js'), code);
    return path;
  };
  try {
    const leaf = await putPackage('delivery-leaf', {}, 'export const answer = 42;');
    const runtime = await putPackage(
      'delivery-runtime',
      { dependencies: { 'delivery-leaf': 'file:../delivery-leaf' } },
      "export { answer } from 'delivery-leaf';",
    );
    const archiveSource = await putPackage('delivery-extra', {}, 'export default "portable";');
    const packed = await execute(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
      { cwd: archiveSource },
    );
    const archive = JSON.parse(packed.stdout)[0].filename;
    await mkdir(source);
    const manifest = {
      private: true,
      type: 'module',
      dependencies: {
        'delivery-runtime': 'file:../delivery-runtime',
        'delivery-extra': `file:../${archive}`,
      },
    };
    await writeFile(join(source, 'package.json'), JSON.stringify(manifest));
    await execute(
      'npm',
      ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: source },
    );
    await cp(source, delivered, { recursive: true });
    await closeSceneDependencies(source, delivered);
    assert.deepEqual(
      JSON.parse(await readFile(join(source, 'package.json'), 'utf8')),
      manifest,
      'delivery never rewrites the authoring project',
    );
    for (const path of [leaf, runtime, archiveSource, join(root, archive), source])
      await rm(path, { recursive: true });
    await execute('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: delivered,
    });
    const { stdout } = await execute(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { answer } from 'delivery-runtime'; import extra from 'delivery-extra'; console.log(answer, extra);",
      ],
      { cwd: delivered },
    );
    assert.equal(stdout.trim(), '42 portable');
    const lock = await readFile(join(delivered, 'package-lock.json'), 'utf8');
    assert(!lock.includes(root));
    assert(!lock.includes('file:../'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('editable delivery pins the inherited runtime used by its HTML and keeps the scene manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scene-inherited-runtime-'));
  const execute = promisify(execFile);
  const workspace = join(root, 'workspace');
  const runtime = join(workspace, 'node_modules/@visual-storytelling/core');
  const recipients = [];
  try {
    await mkdir(join(runtime, 'dist'), { recursive: true });
    await mkdir(join(runtime, 'tools'));
    await writeFile(
      join(runtime, 'package.json'),
      JSON.stringify({
        name: '@visual-storytelling/core',
        version: '7.0.0',
        type: 'module',
        files: ['dist', 'tools'],
        exports: './dist/index.js',
      }),
    );
    await writeFile(join(runtime, 'dist/index.js'), 'export const marker = "runtime-from-scene";');
    await writeFile(join(runtime, 'dist/api.json'), '{"modules":{}}');
    await writeFile(
      join(runtime, 'tools/identity.mjs'),
      'export { marker } from "../dist/index.js";',
    );
    await writeBuildInfo(runtime, join(runtime, 'dist'));
    for (const manifest of [
      undefined,
      { name: 'my-story', private: true, type: 'module', scripts: { inspect: 'echo authored' } },
    ]) {
      const index = recipients.length;
      const source = join(workspace, `scene-${index}`),
        output = join(root, `release-${index}`);
      await mkdir(source);
      await writeFile(
        join(source, 'index.html'),
        '<html><body><script type="module">import {marker} from "@visual-storytelling/core";globalThis.packageMarker=marker;</script></body></html>',
      );
      await writeFile(
        join(source, 'scene.json'),
        JSON.stringify({ generator: { runner: 'node', file: 'generate.mjs' } }),
      );
      await writeFile(
        join(source, 'generate.mjs'),
        `
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const {marker}=await import(pathToFileURL(join(process.env.VISUAL_STORY_TOOLS,'identity.mjs')));
await writeFile(join(process.env.VISUAL_STORY_OUTPUT,'generated.json'),JSON.stringify({marker}));
`,
      );
      if (manifest) await writeFile(join(source, 'package.json'), JSON.stringify(manifest));
      const receipt = await deliver(source, {
        out: output,
        formats: ['html', 'source'],
        silent: true,
      });
      assert.equal(receipt.runtime.version, '7.0.0');
      assert.equal(
        JSON.parse(await readFile(join(source, 'dist/generated.json'), 'utf8')).marker,
        'runtime-from-scene',
      );
      const context = {};
      for (const code of scripts(await readFile(join(output, 'story.html'), 'utf8')))
        runInNewContext(code, context);
      assert.equal(context.packageMarker, 'runtime-from-scene');
      const recipient = join(root, `recipient-${index}`);
      await mkdir(recipient);
      await execute('tar', [
        '-xzf',
        join(output, 'source.tar.gz'),
        '-C',
        recipient,
        '--strip-components=1',
      ]);
      const shipped = JSON.parse(await readFile(join(recipient, 'package.json'), 'utf8'));
      if (manifest) {
        assert.equal(shipped.name, manifest.name);
        assert.deepEqual(shipped.scripts, manifest.scripts);
        assert.equal(
          await readFile(join(source, 'package.json'), 'utf8'),
          JSON.stringify(manifest),
        );
      }
      assert.match(shipped.dependencies['@visual-storytelling/core'], /^file:/);
      recipients.push(recipient);
    }
    await rm(workspace, { recursive: true });
    for (const recipient of recipients) {
      await execute(
        'npm',
        ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
        { cwd: recipient },
      );
      await buildScene(recipient, join(recipient, 'dist'));
      assert.equal(
        JSON.parse(await readFile(join(recipient, 'dist/generated.json'), 'utf8')).marker,
        'runtime-from-scene',
      );
      const context = {};
      runInNewContext(await readFile(join(recipient, 'dist/index.js'), 'utf8'), context);
      assert.equal(context.packageMarker, 'runtime-from-scene');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CDN builds pin the Rapier version resolved by the importing scene', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scene-cdn-version-'));
  try {
    const installed = join(root, 'node_modules/@dimforge/rapier3d-compat');
    await mkdir(installed, { recursive: true });
    await writeFile(
      join(installed, 'package.json'),
      JSON.stringify({
        name: '@dimforge/rapier3d-compat',
        version: '9.8.7',
        type: 'module',
        exports: './index.js',
      }),
    );
    await writeFile(join(installed, 'index.js'), 'export default {};');
    await writeFile(
      join(root, 'index.html'),
      '<script type="module">import engine from "@dimforge/rapier3d-compat";globalThis.engine=engine;</script>',
    );
    await buildScene(root, join(root, 'dist'), { cdn: true });
    assert.match(
      await readFile(join(root, 'dist/index.js'), 'utf8'),
      /rapier3d-compat@9\.8\.7\/dist\/rapier\.mjs/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('packing closes static page fetches and refuses an unresolved external module or remote asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scene-closure-'));
  try {
    await writeFile(join(root, 'data.json'), '{"answer":42}');
    const page = (code) => `<!doctype html><html><body><script>${code}</script></body></html>`;
    await writeFile(join(root, 'index.html'), page("fetch('./data.json')"));
    let requested;
    for (const code of scripts(await packDirectory(root)))
      runInNewContext(code, {
        fetch: (url) => {
          requested = url;
        },
      });
    assert.deepEqual(JSON.parse(Buffer.from(requested.split(',')[1], 'base64')), { answer: 42 });
    await writeFile(join(root, 'index.html'), page("fetch('https://example.invalid/data.json')"));
    await assert.rejects(packDirectory(root), /Cannot bundle remote resource/);
    await writeFile(join(root, 'index.html'), page("import('./other.js')"));
    await assert.rejects(packDirectory(root), /still imports another module/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
