#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir, cp, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildScene } from './build-pages.mjs';
import { serve } from './site.mjs';
import { packDirectory } from './standalone.mjs';
import { readCatalog } from './catalog.mjs';
const reviewArgs = process.argv.slice(3);
if (
  process.argv[2] === 'review' &&
  (reviewArgs.some((arg) =>
    [
      '--motion',
      '--slice',
      '--capture',
      '--click',
      '--scenario',
      '--target',
      '--cdp',
      '--window',
      '--windows',
      '--doctor',
      '--help',
      '-h',
    ].includes(arg.split('=')[0]),
  ) ||
    reviewArgs.some((arg) => /^https?:\/\//.test(arg)))
) {
  const { runMotionCLI } = await import('./motion/cli.mjs');
  const code = await runMotionCLI(reviewArgs);
  // Agents read pipes: flush the complete JSON/help before an explicit exit.
  await Promise.all(
    [process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write('', done))),
  );
  process.exit(code);
}
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
  },
});
const [command, directory = '.'] = positionals,
  destination = resolve(directory);
const catalog = await readCatalog({ optional: true });
const help = `${catalog ? 'visual-story new DIRECTORY --example NAME [--no-audio]\nvisual-story examples                         list supported starting points\n' : ''}visual-story api [NAME ... | ./SUBPATH]       public names or exact shipped declarations
visual-story dev DIRECTORY [--port 8793]       rebuild + reload at the current story time
visual-story build DIRECTORY [--cdn]          build dist/; CDN mode loads pinned Rapier remotely
visual-story audio DIRECTORY                  voice + aligned cues from narration.json
visual-story preview DIST [--port 8793]        serve an existing build
visual-story review DIST --out review [--cue ID] [--width 375] [--theme dark] [--reduced]
visual-story review URL --click SELECTOR --target CSS  capture an interaction
visual-story review INPUT --motion                    scene, video or PNG analysis
visual-story review --help                            capture, replay, comparison and native windows
visual-story pack DIST --out artifacts/story.html [--inline]

${catalog ? `Authoring: ${join(root, 'skill/SKILL.md')}` : 'Authoring templates: use the installed visual-explainer skill workspace.'}`;
if (values.help || command === 'help' || !command) console.log(help);
else if (command === 'examples') {
  if (!catalog) await readCatalog();
  for (const [name, entry] of Object.entries(catalog))
    console.log(`${name.padEnd(22)} ${entry.title}`);
} else if (command === 'api') {
  const { describeAPI } = await import('./api.mjs');
  const { text, missing } = await describeAPI(root, ...positionals.slice(1));
  console.log(text);
  if (missing.length) process.exitCode = 1;
} else if (command === 'new') {
  if (!catalog) await readCatalog();
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
      name === '.venv' ||
      ['voice.wav', 'music.wav'].includes(name) ||
      (values['no-audio'] && name === 'audio.wav')
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
} else if (command === 'build') {
  const output = values.out ? resolve(values.out) : join(destination, 'dist');
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
  console.log(
    JSON.stringify(
      await reviewScene({
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
