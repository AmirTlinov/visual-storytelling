#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir, cp, stat, rm } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildPage } from './build-pages.mjs';
import { serve } from './site.mjs';
import { packDirectory } from './standalone.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    example: { type: 'string', default: 'area-story' },
    out: { type: 'string' },
    port: { type: 'string', default: '8793' },
    'no-audio': { type: 'boolean', default: false },
    audio: { type: 'boolean', default: false },
    inline: { type: 'boolean', default: false },
  },
});
const [command, directory = '.'] = positionals,
  destination = resolve(directory);
const catalog = JSON.parse(await readFile(join(root, 'examples/catalog.json'), 'utf8'));
if (command === 'new') {
  if (!catalog[values.example])
    throw new Error(`Choose an example: ${Object.keys(catalog).join(', ')}`);
  try {
    if ((await readdir(destination)).length) throw new Error('Choose an empty output directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(destination, { recursive: true });
  const source = join(root, 'examples', values.example);
  for (const name of await readdir(source)) {
    if (
      (name.startsWith('preview') && name.endsWith('.png')) ||
      name === '__pycache__' ||
      name === '.venv'
    )
      continue;
    await cp(join(source, name), join(destination, name), { recursive: true });
  }
  if (catalog[values.example].page !== 'index.html') {
    const page = catalog[values.example].page;
    if (page.endsWith('.html')) await cp(join(destination, page), join(destination, 'index.html'));
    else
      await writeFile(
        join(destination, 'index.html'),
        `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">import '@visual-storytelling/core/style.css';</script></head><body class="ve-standalone"><main class="ve-scene" data-paper="false"><object data="${page}" type="image/svg+xml" style="width:100%;height:1200px"></object></main></body></html>`,
      );
  }
  // Each scene records an immutable packed dependency rather than a mutable workspace link.
  const receipt = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', destination, '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  )[0];
  await writeFile(
    join(destination, 'package.json'),
    JSON.stringify(
      {
        name: 'visual-story-scene',
        private: true,
        type: 'module',
        scripts: {
          build: 'visual-story build .',
          ...(catalog[values.example].generator
            ? { generate: `visual-story generate . --example ${values.example}` }
            : {}),
          dev: 'visual-story preview dist',
          pack: 'visual-story pack dist --out story.html',
          audio: 'visual-story audio .',
          export: 'visual-story-export --directory dist',
        },
        dependencies: { '@visual-storytelling/core': `file:./${receipt.filename}` },
      },
      null,
      2,
    ) + '\n',
  );
  if (values['no-audio'])
    for (const name of await readdir(destination))
      if (name.endsWith('.html')) {
        const file = join(destination, name);
        await writeFile(
          file,
          (await readFile(file, 'utf8')).replace(/<audio\b/g, '<audio data-silent="true"'),
        );
      }
  if (values.audio)
    execFileSync(
      join(root, 'tools/sketch-audio'),
      ['build', join(destination, 'narration.json'), '--out', destination],
      { stdio: 'inherit' },
    );
  console.log(`${destination}\ncd ${destination}\nnpm install\nnpm run build\nnpm run dev`);
} else if (command === 'audio') {
  execFileSync(
    join(root, 'tools/sketch-audio'),
    ['build', join(destination, 'narration.json'), '--out', destination],
    { stdio: 'inherit' },
  );
  for (const name of await readdir(destination))
    if (name.endsWith('.html')) {
      const file = join(destination, name);
      await writeFile(file, (await readFile(file, 'utf8')).replace(/ data-silent="true"/g, ''));
    }
} else if (command === 'generate') {
  const generator = catalog[values.example]?.generator;
  if (!generator) throw new Error('This example has no separate SVG generator');
  const args =
    generator.runner === 'uv' ? ['run', '--python', '3.12', generator.file] : [generator.file];
  execFileSync(generator.runner, args, {
    cwd: destination,
    env: { ...process.env, VISUAL_STORY_TOOLS: join(root, 'tools') },
    stdio: 'inherit',
  });
} else if (command === 'build') {
  const output = values.out ? resolve(values.out) : join(destination, 'dist');
  if (output === destination)
    throw new Error('The build output must be separate from scene sources');
  if (!values.out) await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const name of await readdir(destination)) {
    const path = join(destination, name);
    if (!(await stat(path)).isFile()) continue;
    if (name.endsWith('.html')) await buildPage(path, output);
    else if (
      ['.svg', '.css', '.wav', '.m4a', '.png', '.json', '.glb', '.txt'].includes(extname(name)) &&
      name !== 'package.json' &&
      name !== 'package-lock.json'
    )
      await cp(path, join(output, name));
  }
  console.log(output);
} else if (command === 'preview') {
  const server = await serve(destination, Number(values.port));
  console.log(server.url);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
} else if (command === 'pack') {
  const output = resolve(values.out ?? 'story.html');
  await writeFile(
    output,
    await packDirectory(destination, 'index.html', { inline: values.inline }),
  );
  console.log(output);
} else
  console.log(
    'visual-story new DIRECTORY --example NAME | generate DIRECTORY --example NAME | build DIRECTORY | preview DIRECTORY | pack DIST --out story.html',
  );
