#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir, cp, access } from 'node:fs/promises';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene } from './build-pages.mjs';
import { packDirectory } from './standalone.mjs';
import { readCatalog, describeExamples } from './catalog.mjs';
import { buildNarration } from './narration.mjs';
import { createScene } from './create-scene.mjs';
import { cancellableCommand } from './cancellable-command.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const hasCharacters = Boolean(pkg.exports?.['./characters']);
if (process.argv[2] === 'characters') {
  if (!hasCharacters) {
    console.error(
      'This runtime does not include ./characters. Use visual-story examples and api to inspect its available capabilities.',
    );
    process.exitCode = 1;
  } else {
    const { runCharacters } = await import('./characters/cli.mjs');
    await runCharacters(process.argv.slice(3));
  }
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
  const outputOption = { out: { type: 'string' } };
  const serverOptions = { port: { type: 'string', default: '8793' } };
  const commandOptions = {
    new: {
      example: { type: 'string' },
      'no-audio': { type: 'boolean', default: false },
      silent: { type: 'boolean', default: false },
      audio: { type: 'boolean', default: false },
    },
    examples: {
      json: { type: 'boolean', default: false },
      group: { type: 'string' },
      recommended: { type: 'boolean', default: false },
    },
    session: {
      view: { type: 'string' },
      revision: { type: 'string' },
      query: { type: 'string' },
      commands: { type: 'string' },
    },
    api: { full: { type: 'boolean', default: false } },
    info: { json: { type: 'boolean', default: false } },
    update: { from: { type: 'string' } },
    build: { ...outputOption, cdn: { type: 'boolean', default: false } },
    dev: serverOptions,
    preview: serverOptions,
    deliver: {
      ...outputOption,
      formats: { type: 'string', default: 'html' },
      silent: { type: 'boolean', default: false },
      width: { type: 'string', default: '1280' },
      height: { type: 'string' },
      fps: { type: 'string', default: '30' },
      jobs: { type: 'string', default: '2' },
      theme: { type: 'string', default: 'light' },
      from: { type: 'string' },
      to: { type: 'string' },
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
  const catalog = ['examples', 'new'].includes(command) ? await readCatalog() : undefined;
  const newUsage = `visual-story new DIRECTORY --example NAME [--no-audio | --silent | --audio]`;
  const help = `${newUsage}
visual-story examples [QUERY] [--json] [--recommended] [--group explanations|techniques]
visual-story info [DIRECTORY] [--json]        actual packages, build identity and stale sources
visual-story update DIRECTORY [--from LIBRARY]  build, pin and install this runtime
visual-story api [NAME.member ... | ./SUBPATH] [--full]       public names or exact shipped declarations
${hasCharacters ? 'visual-story characters --help              prepared actors, actions and editable SVG skin kits\n' : ''}visual-story dev DIRECTORY [--port 8793]       rebuild + restore the selected semantic cue
visual-story session URL [status|inspect|find|control] [--query TEXT] [--commands JSON] [--view ID] [--revision HASH]
visual-story build DIRECTORY [--cdn]          build dist/; CDN mode loads pinned Rapier remotely
visual-story audio DIRECTORY                  voice + aligned cues from story.json or narration.json
visual-story preview DIST [--port 8793]        serve an existing build
visual-story review DIST --out review [--cue ID] [--width 375] [--theme dark] [--reduced]
visual-story review URL --click SELECTOR --target CSS  capture an interaction
visual-story review inspect SESSION                    episode, time or object evidence
visual-story review --help                            capture, replay, comparison and native windows
visual-story deliver DIRECTORY --out artifacts/release --formats mp4,html [--jobs 2]
visual-story export --help                       MP4, stills and subtitle files
visual-story pack DIST --out artifacts/story.html [--inline]

Authoring: ${join(root, 'skills/visual-explainer/SKILL.md')}`;
  if (values.help && command === 'info')
    console.log(`visual-story info [DIRECTORY] [--json]

Identify this CLI and the package actually installed in DIRECTORY (default: current directory).
Compare content even when versions match; detect stale sources or modified runtime files.
--json includes the installed public API names. No dependencies or files are changed.`);
  else if (values.help || command === 'help' || !command)
    console.log(
      command === 'new'
        ? `${newUsage}\n\n--no-audio defers narration while keeping its editable script.\n--silent creates a scene without speech files or audio controls, preserving cues and asset credits.\n--audio synthesizes the template narration immediately using voice.json. Without a provider, local neural Higgs is used through sketch-audio. Missing Higgs stops preparation; system voices require explicit provider: macos. In the plugin, story_voice owns this choice.`
        : command === 'deliver'
          ? `visual-story deliver DIRECTORY [--out artifacts/release] [--formats html,png,svg,mp4,srt,vtt,source]

Runs cached narration, builds, and publishes the requested files together. Default: html.
MP4 exports the whole story; --from SECONDS --to SECONDS selects an interval.
Video: --width 1280 [--height 720] --fps 30 --jobs 2 --theme light|dark
--silent keeps an explicitly silent draft. HTML follows the viewer's theme.
Re-run the same command after changing a line; unchanged voice segments use the cache.`
          : command === 'pack'
            ? 'visual-story pack DIST --out story.html [--inline] [--theme auto|light|dark] [--audio compressed|original]\nStandalone audio is compressed by default; --inline additionally applies the chat fragment limit.'
            : help,
    );
  else if (command === 'session') {
    const { requestSession } = await import('./dev-session.mjs');
    console.log(
      JSON.stringify(
        await requestSession(directory, positionals[2] ?? 'inspect', {
          ...values,
          commands: values.commands ? JSON.parse(values.commands) : undefined,
        }),
        null,
        2,
      ),
    );
  } else if (command === 'info') {
    const { diagnosePackage, formatPackageInfo } = await import('./build-info.mjs');
    const report = await diagnosePackage(root, destination);
    console.log(values.json ? JSON.stringify(report, null, 2) : formatPackageInfo(report));
  } else if (command === 'update') {
    const { updateSceneRuntime } = await import('./runtime-package.mjs');
    await cancellableCommand('Update', async (signal) => {
      console.log(
        JSON.stringify(
          await updateSceneRuntime(destination, {
            root: values.from ? resolve(values.from) : root,
            signal,
          }),
          null,
          2,
        ),
      );
    });
  } else if (command === 'examples') {
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
    await createScene(destination, {
      example: values.example,
      deferAudio: values['no-audio'],
      silent: values.silent,
      audio: values.audio,
    });
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
            video:
              values.from !== undefined || values.to !== undefined
                ? { kind: 'interval', from: Number(values.from), to: Number(values.to) }
                : { kind: 'story' },
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
    const { previewReport } = await import('./motion/preview.mjs');
    const server = await previewReport(destination, Number(values.port));
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
