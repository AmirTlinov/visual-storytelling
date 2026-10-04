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

const scripts = (html) => {
  const result = [];
  const visit = (node) => {
    if (node.tagName === 'script') result.push(node.childNodes.map((n) => n.value ?? '').join(''));
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(html));
  return result;
};

test('a nested TypeScript module keeps its asset through build and offline packing; inert scripts stay inert', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scene-resource-'));
  try {
    await mkdir(join(root, 'modules'));
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
