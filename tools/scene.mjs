#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene } from './build-pages.mjs';
import { serve } from './site.mjs';
import { packDirectory } from './standalone.mjs';
import { readCatalog, describeExamples } from './catalog.mjs';
import { buildNarration, setNarrationMode, silenceSceneCopy } from './narration.mjs';
import { pinSceneProject } from './scene-project.mjs';
import { cancellableCommand } from './cancellable-command.mjs';
if (process.argv[2] === 'characters') {
  const { runCharacters } = await import('./characters/cli.mjs');
  await runCharacters(process.argv.slice(3));
} else if (process.argv[2] === 'export') {
  const { runExport } = await import('./export.mjs');
  await runExport(process.argv.slice(3));
  process.exitCode ??= 0;
} else {
  const reviewArgs = process.argv.slice(3);
  if (process.argv[2] === 'review') {
    const { runMotionCLI } = await import('./motion/cli.mjs');
    const code = await runMotionCLI(reviewArgs);
    // Agents read pipes: flush the complete JSON/help before an explicit exit.
    await Promise.all(
      [process.stdout, process.stderr].map(
        (stream) => new Promise((done) => stream.write('', done)),
      ),
    );
    process.exit(code);
  }
  const root = fileURLToPath(new URL('../', import.meta.url));
  const outputOption = { out: { type: 'string' } };
  const serverOptions = { port: { type: 'string', default: '8793' } };
  const commandOptions = {
    new: {
      example: { type: 'string', default: 'explorer-svg' },
      'no-audio': { type: 'boolean', default: false },
      silent: { type: 'boolean', default: false },
      audio: { type: 'boolean', default: false },
    },
    examples: {
      json: { type: 'boolean', default: false },
      group: { type: 'string' },
      recommended: { type: 'boolean', default: false },
    },
    api: { full: { type: 'boolean', default: false } },
    info: { json: { type: 'boolean', default: false } },
    build: { ...outputOption, cdn: { type: 'boolean', default: false } },
    dev: serverOptions,
    preview: serverOptions,
    deliver: {
      ...outputOption,
      formats: { type: 'string', default: 'mp4' },
      silent: { type: 'boolean', default: false },
      width: { type: 'string', default: '1280' },
      height: { type: 'string' },
      fps: { type: 'string', default: '30' },
      jobs: { type: 'string', default: '2' },
      theme: { type: 'string', default: 'light' },
    },
    pack: {
      ...outputOption,
      inline: { type: 'boolean', default: false },
      audio: { type: 'string', default: 'compressed' },
      theme: { type: 'string' },
    },
  };
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      ...commandOptions[process.argv[2]],
    },
  });
  const [command, directory = '.'] = positionals,
    destination = resolve(directory);
  const catalog = await readCatalog({ optional: true });
  const help = `${catalog ? 'visual-story new DIRECTORY --example NAME [--no-audio | --silent | --audio]\nvisual-story examples [QUERY] [--json] [--recommended] [--group explanations|techniques]\n' : ''}visual-story info [DIRECTORY] [--json]        actual packages, build identity and stale sources
visual-story api [NAME.member ... | ./SUBPATH] [--full]       public names or exact shipped declarations
visual-story characters --help              prepared actors, actions and editable SVG skin kits
visual-story dev DIRECTORY [--port 8793]       rebuild + reload at the current story time
visual-story build DIRECTORY [--cdn]          build dist/; CDN mode loads pinned Rapier remotely
visual-story audio DIRECTORY                  voice + aligned cues from narration.json
visual-story preview DIST [--port 8793]        serve an existing build
visual-story review DIST --out review [--cue ID] [--width 375] [--theme dark] [--reduced]
visual-story review URL --click SELECTOR --target CSS  capture an interaction
visual-story review inspect SESSION                    episode, time or object evidence
visual-story review --help                            capture, replay, comparison and native windows
visual-story deliver DIRECTORY --out artifacts/release --formats mp4,html [--jobs 2]
visual-story export --help                       MP4, stills and subtitle files
visual-story pack DIST --out artifacts/story.html [--inline]

${catalog ? `Authoring: ${join(root, 'skill/SKILL.md')}` : 'Authoring templates: use the installed visual-explainer skill workspace.'}`;
  if (values.help && command === 'info')
    console.log(`visual-story info [DIRECTORY] [--json]

Identify this CLI and the package actually installed in DIRECTORY (default: current directory).
Compare content even when versions match; detect stale sources or modified runtime files.
--json includes the installed public API names. No dependencies or files are changed.`);
  else if (values.help || command === 'help' || !command)
    console.log(
      command === 'new'
        ? 'visual-story new DIRECTORY --example NAME [--no-audio | --silent | --audio]\n\n--no-audio defers narration while keeping its editable script.\n--silent creates a scene without speech files or audio controls, preserving cues and asset credits.\n--audio synthesizes the template narration immediately.'
        : command === 'deliver'
          ? `visual-story deliver DIRECTORY [--out artifacts/release] [--formats mp4,html,srt,vtt,source]

Runs cached narration, builds, and publishes the requested files together. Default: mp4.
Video: --width 1280 [--height 720] --fps 30 --jobs 2 --theme light|dark
--silent keeps an explicitly silent draft. HTML follows the viewer's theme.
Re-run the same command after changing a line; unchanged voice segments use the cache.`
          : command === 'pack'
            ? 'visual-story pack DIST --out story.html [--inline] [--theme auto|light|dark] [--audio compressed|original]\nStandalone audio is compressed by default; --inline additionally applies the chat fragment limit.'
            : help,
    );
  else if (command === 'info') {
    const { diagnosePackage, formatPackageInfo } = await import('./build-info.mjs');
    const report = await diagnosePackage(root, destination);
    console.log(values.json ? JSON.stringify(report, null, 2) : formatPackageInfo(report));
  } else if (command === 'examples') {
    if (!catalog) await readCatalog();
    console.log(describeExamples(catalog, { query: positionals.slice(1).join(' '), ...values }));
  } else if (command === 'api') {
    const { describeAPI } = await import('./api.mjs');
    const { text, missing } = await describeAPI(
      root,
      ...positionals.slice(1),
      ...(values.full ? ['--full'] : []),
    );
    console.log(text);
    if (missing.length) process.exitCode = 1;
  } else if (command === 'new') {
    if (!catalog) await readCatalog();
    if ([values.audio, values['no-audio'], values.silent].filter(Boolean).length > 1)
      throw new Error('Choose one of --audio, --no-audio or --silent');
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
        ((values['no-audio'] || values.silent) && name === 'audio.wav')
      )
        continue;
      await cp(join(source, name), join(destination, name), { recursive: true });
    }
    if (catalog[values.example].page !== 'index.html') {
      const page = catalog[values.example].page;
      if (page.endsWith('.html'))
        await cp(join(destination, page), join(destination, 'index.html'));
      else
        await writeFile(
          join(destination, 'index.html'),
          `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script type="module">import '@visual-storytelling/core/style.css';</script></head><body class="ve-standalone"><main class="ve-scene" data-paper="false"><object data="${page}" type="image/svg+xml" style="width:100%;height:1200px"></object></main></body></html>`,
        );
    }
    if (values.silent) await silenceSceneCopy(destination);
    await pinSceneProject(destination);
    if (values['no-audio'])
      for (const name of await readdir(destination))
        if (name.endsWith('.html')) {
          const file = join(destination, name);
          await writeFile(file, setNarrationMode(await readFile(file, 'utf8'), true));
        }
    if (values.audio) await buildNarration(destination);
    console.log(`${destination}\ncd ${destination}\nnpm install\nnpm run build\nnpm run dev`);
  } else if (command === 'audio') {
    await buildNarration(destination);
  } else if (command === 'deliver') {
    const { deliver } = await import('./deliver.mjs');
    await cancellableCommand('Delivery', async (signal) => {
      console.log(
        JSON.stringify(
          await deliver(destination, {
            ...values,
            formats: values.formats.split(','),
            width: Number(values.width),
            height: values.height === undefined ? undefined : Number(values.height),
            fps: Number(values.fps),
            jobs: Number(values.jobs),
            signal,
          }),
          null,
          2,
        ),
      );
    });
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
  } else if (command === 'pack') {
    const output = resolve(values.out ?? 'story.html');
    await cancellableCommand('Packaging', async (signal) => {
      const html = await packDirectory(destination, 'index.html', {
        inline: values.inline,
        theme: values.theme ?? 'auto',
        audio: values.audio,
        signal,
      });
      signal.throwIfAborted();
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, html);
      console.log(output);
    });
  } else throw new Error(`Unknown command: ${command}\n${help}`);
}
