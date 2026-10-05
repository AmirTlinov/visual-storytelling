import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { packagePlugin, shippedExamples } from './package.mjs';
import { packageInfo } from '../tools/build-info.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)),
  out = join(root, 'plugin/dist');
await mkdir(out, { recursive: true });
if ((await packageInfo(root)).status !== 'current')
  throw new Error('Build the core before packaging the plugin: npm run build.');
const catalog = JSON.parse(await readFile(join(root, 'examples/catalog.json'), 'utf8'));
await writeFile(
  join(out, 'catalog.json'),
  JSON.stringify(Object.fromEntries(shippedExamples.map((id) => [id, catalog[id]]))),
);
await mkdir(join(out, 'examples'), { recursive: true });
for (const id of shippedExamples) {
  const built = join(out, 'scenes', id);
  await buildScene(join(root, 'examples', id), built, { sourcePackage: true, silent: true });
  const html = await packDirectory(built, 'index.html', { audio: 'original' });
  await writeFile(
    join(out, 'examples', id + '.json'),
    JSON.stringify({
      title: catalog[id].title,
      revision: createHash('sha256')
        .update(JSON.stringify({ id, title: catalog[id].title, html }))
        .digest('hex'),
      html,
    }),
  );
  if (id === 'explorer-svg')
    await writeFile(join(out, 'example.json'), await readFile(join(out, 'examples', id + '.json')));
}
const app = await build({
  entryPoints: [join(root, 'plugin/ui/app.mjs')],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  write: false,
  minify: true,
  metafile: true,
  plugins: [
    {
      name: 'frame-source',
      setup(build) {
        build.onLoad({ filter: /scene-frame\.mjs$/ }, async (args) => ({
          contents: (
            await import('esbuild').then(({ build }) =>
              build({
                entryPoints: [args.path],
                bundle: true,
                platform: 'browser',
                format: 'iife',
                target: 'es2022',
                write: false,
                minify: true,
              }),
            )
          ).outputFiles[0].text,
          loader: 'text',
        }));
      },
    },
  ],
});
const page = await readFile(join(root, 'plugin/ui/app.html'), 'utf8');
const css = await readFile(join(root, 'plugin/ui/app.css'), 'utf8');
await writeFile(
  join(out, 'app.html'),
  page
    .replace('</head>', () => `<style>${css}</style></head>`)
    .replace(
      '</body>',
      () =>
        `<script type="module">${app.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body>`,
    ),
);
const server = await build({
  entryPoints: [join(root, 'plugin/mcp/server.mjs')],
  outfile: join(out, 'server.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  metafile: true,
  banner: {
    js: "import { createRequire } from 'node:module';const require=createRequire(import.meta.url);",
  },
});
await build({
  entryPoints: [join(root, 'plugin/runtime/kernel.mjs')],
  outfile: join(out, 'kernel.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
});
// SDKs are bundled, so their licenses must travel without development node_modules.
const bundled = new Set();
for (const result of [app, server])
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = resolve(input).match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (match) bundled.add(match[1]);
  }
const notices = [];
for (const directory of [...bundled].sort()) {
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  for (const name of (await readdir(directory)).filter((name) =>
    /^(?:licen[sc]e|notice)(?:\.|-|$)/i.test(name),
  ))
    notices.push(
      `${pkg.name} ${pkg.version} · ${name}\n\n${await readFile(join(directory, name), 'utf8')}`,
    );
}
await writeFile(
  join(out, 'THIRD_PARTY_NOTICES.txt'),
  notices.join('\n\n' + '='.repeat(72) + '\n\n'),
);
await writeFile(join(out, 'worker.mjs'), "import '../runtime/worker.mjs';\n");
console.log(`Built plugin: ${out}`);
if (process.argv.includes('--release')) console.log(`Release: ${await packagePlugin(root)}`);
