#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir, cp, rm, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildScene } from './build-pages.mjs';
import { serve } from './site.mjs';
import { packDirectory } from './standalone.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    example: { type: 'string', default: 'explorer-svg' },
    help: { type: 'boolean', short: 'h' },
    out: { type: 'string' },
    port: { type: 'string', default: '8793' },
    'no-audio': { type: 'boolean', default: false },
    audio: { type: 'boolean', default: false },
    inline: { type: 'boolean', default: false },
    cdn: { type: 'boolean', default: false },
    cue: { type: 'string', multiple: true },
    theme: { type: 'string' },
    width: { type: 'string', default: '960' },
    reduced: { type: 'boolean', default: false },
    motion: { type: 'boolean', default: false },
    from: { type: 'string' },
    frames: { type: 'string' },
    fps: { type: 'string' },
    crop: { type: 'string' },
  },
});
const [command, directory = '.'] = positionals,
  destination = resolve(directory);
const catalog = JSON.parse(await readFile(join(root, 'examples/catalog.json'), 'utf8'));
const help = `visual-story new DIRECTORY --example NAME [--no-audio]
visual-story examples                         list supported starting points
visual-story api [NAME | ./SUBPATH]           public names or exact shipped declarations
visual-story dev DIRECTORY [--port 8793]       rebuild + reload at the current story time
visual-story build DIRECTORY [--cdn]          build dist/; CDN mode loads pinned Rapier remotely
visual-story audio DIRECTORY                  voice + aligned cues from narration.json
visual-story preview DIST [--port 8793]        serve an existing build
visual-story review DIST --out review [--cue ID] [--width 375] [--theme dark] [--reduced]
visual-story review INPUT --motion --out review [--from SECONDS] [--frames 12] [--crop x,y,w,h]
                       INPUT: scene directory, video, or PNG manifest; scene-only --fps 60
visual-story pack DIST --out artifacts/story.html [--inline]
visual-story generate DIRECTORY --example NAME

Authoring API: ${join(root, 'skill/references/scene-template.md')}
Narration format: ${join(root, 'skill/references/narration.md')}`;
if (values.help || command === 'help' || !command) console.log(help);
else if (command === 'examples') {
  for (const [name, entry] of Object.entries(catalog))
    console.log(`${name.padEnd(22)} ${entry.title}`);
} else if (command === 'api') {
  const { describeAPI } = await import('./api.mjs');
  console.log(await describeAPI(root, positionals[1]));
} else if (command === 'new') {
  if (values.audio && values['no-audio']) throw new Error('Choose either --audio or --no-audio');
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
  if (
    await access(join(root, 'src/index.ts')).then(
      () => true,
      () => false,
    )
  ) {
    const { buildPackage } = await import('./build-package.mjs');
    await buildPackage();
  }
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
          dev: 'visual-story dev .',
          preview: 'visual-story preview dist',
          pack: 'visual-story pack dist --out artifacts/story.html',
          audio: 'visual-story audio .',
          export: 'visual-story-export --directory dist',
          review: 'visual-story review dist --out artifacts/review',
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
  await buildScene(destination, output, { cdn: values.cdn });
  console.log(output);
} else if (command === 'dev') {
  const { develop } = await import('./dev.mjs');
  const server = await develop(destination, Number(values.port));
  console.log(server.url);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
} else if (command === 'preview') {
  const server = await serve(destination, Number(values.port));
  console.log(server.url);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
} else if (command === 'review') {
  const { reviewScene } = await import('./review.mjs');
  const width = Number(values.width);
  const theme = values.theme ?? 'light';
  if (!['light', 'dark'].includes(theme) || !Number.isInteger(width) || width < 240)
    throw new Error('Review needs --theme light|dark and --width at least 240');
  if (
    !values.motion &&
    [values.from, values.frames, values.fps, values.crop].some((v) => v !== undefined)
  )
    throw new Error('--from, --frames, --fps and --crop require --motion');
  if (values.motion && values.cue?.length)
    throw new Error('Use --from to select a motion window; --cue selects the story overview');
  const { reviewMotion } = await import('./motion-review.mjs');
  const { parseCrop } = await import('./motion-frames.mjs');
  console.log(
    JSON.stringify(
      values.motion
        ? await reviewMotion({
            input: destination,
            out: values.out ?? 'review',
            from: Number(values.from ?? 0),
            frames: Number(values.frames ?? 12),
            fps: values.fps === undefined ? undefined : Number(values.fps),
            crop: parseCrop(values.crop),
            theme,
            width,
            reduced: values.reduced,
          })
        : await reviewScene({
            directory: destination,
            out: values.out ?? 'review',
            cues: values.cue,
            theme,
            width,
            reduced: values.reduced,
          }),
      null,
      2,
    ),
  );
} else if (command === 'pack') {
  const output = resolve(values.out ?? 'story.html');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    await packDirectory(destination, 'index.html', {
      inline: values.inline,
      theme: values.theme ?? 'auto',
    }),
  );
  console.log(output);
} else throw new Error(`Unknown command: ${command}\n${help}`);
