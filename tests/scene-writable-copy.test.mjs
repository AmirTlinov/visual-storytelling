import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScene } from '../tools/create-scene.mjs';
import { buildScene } from '../tools/build-pages.mjs';
import { writeBuildInfo } from '../tools/build-info.mjs';
import { copySceneInput } from '../tools/copy-scene-input.mjs';
import { deliver } from '../tools/deliver.mjs';
import { snapshotProject } from '../plugin/project-files.mjs';

const execute = promisify(execFile);

async function permissions(directory, immutable) {
  await chmod(directory, immutable ? 0o555 : 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await permissions(file, immutable);
    else if (entry.isFile()) {
      const mode = (await lstat(file)).mode;
      await chmod(file, (immutable ? 0o444 : 0o644) | (mode & 0o111));
    }
  }
}

test(
  'immutable templates create editable projects, generator output and portable source archives',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scene-writable-copy-'));
    const library = join(directory, 'library'),
      project = join(directory, 'project');
    try {
      const example = join(library, 'examples/readonly');
      await mkdir(join(example, 'nested'), { recursive: true });
      await mkdir(join(library, 'dist'));
      const files = {
        'package.json': JSON.stringify({
          name: '@visual-storytelling/core',
          version: '0.0.0',
          type: 'module',
          files: ['dist', 'examples'],
        }),
        'dist/index.js': 'export {};\n',
        'dist/api.json': '{"modules":{}}\n',
        'examples/catalog.json':
          '{"readonly":{"title":"Editable copy","source":"scene.js","page":"index.html"}}\n',
        'examples/readonly/index.html':
          '<!doctype html><html><body><p id="value"></p><img src="drawing.svg"><script type="module" src="scene.js"></script></body></html>',
        'examples/readonly/scene.js':
          'document.querySelector("#value").textContent="Before edit";\n',
        'examples/readonly/scene.json': '{"generator":{"runner":"node","file":"generate.mjs"}}\n',
        'examples/readonly/drawing.svg':
          '<svg xmlns="http://www.w3.org/2000/svg"><text>Before build</text></svg>',
        'examples/readonly/nested/message.txt': 'Original',
        'examples/readonly/nested/run.sh': '#!/bin/sh\nprintf "editable"\n',
        'examples/readonly/generate.mjs': `import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';
        const text=await readFile(new URL('./nested/message.txt',import.meta.url),'utf8');
        await writeFile(join(process.env.VISUAL_STORY_OUTPUT,'drawing.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><text>'+text+'</text></svg>');`,
      };
      for (const [path, contents] of Object.entries(files))
        await writeFile(join(library, path), contents);
      await chmod(join(example, 'nested/run.sh'), 0o755);
      await writeBuildInfo(library, join(library, 'dist'));
      await permissions(library, true);

      await createScene(project, { root: library, example: 'readonly', deferAudio: true });
      await writeFile(
        join(project, 'scene.js'),
        'document.querySelector("#value").textContent="Author changed this";\n',
      );
      await writeFile(join(project, 'nested/message.txt'), 'New generated content');
      await writeFile(
        join(project, 'nested/new.txt'),
        'A nested directory accepts new author files',
      );
      assert.equal((await lstat(join(project, 'nested/run.sh'))).mode & 0o111, 0o111);
      await writeFile(join(project, 'nested/run.sh'), '#!/bin/sh\nprintf "edited"\n');

      // A copied SVG can be overwritten by its generator even if the authored asset is protected.
      await chmod(join(project, 'drawing.svg'), 0o444);
      await chmod(join(project, 'package.json'), 0o444);
      await execute('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: project });
      const output = join(project, 'dist');
      await buildScene(project, output);
      assert.match(await readFile(join(output, 'drawing.svg'), 'utf8'), /New generated content/);
      assert.match(await readFile(join(output, 'index.js'), 'utf8'), /Author changed this/);

      const snapshot = join(directory, 'snapshot');
      const receipt = await snapshotProject(project, snapshot);
      assert(receipt.files['drawing.svg']);
      await writeFile(join(snapshot, 'drawing.svg'), 'Preparation owns this copied input');
      assert.match(await readFile(join(project, 'drawing.svg'), 'utf8'), /Before build/);

      const release = await deliver(project, { formats: ['source'], prepareAudio: false });
      const restored = join(directory, 'restored');
      await mkdir(restored);
      await execute('tar', ['-xzf', join(release.directory, 'source.tar.gz'), '-C', restored]);
      await writeFile(join(restored, 'source/drawing.svg'), 'Editable after unpacking');
      await writeFile(join(restored, 'source/nested/newer.txt'), 'Editable nested archive');
      assert.equal((await lstat(join(restored, 'source/nested/run.sh'))).mode & 0o111, 0o111);

      // A link is copied as a link, and never used to chmod the immutable source.
      const link = join(directory, 'link');
      await symlink(join(example, 'scene.js'), link);
      await copySceneInput(link, join(directory, 'link-copy'));
      assert((await lstat(join(directory, 'link-copy'))).isSymbolicLink());
      assert.equal((await lstat(join(example, 'scene.js'))).mode & 0o777, 0o444);
      assert.equal((await lstat(join(example, 'nested'))).mode & 0o777, 0o555);
      assert.equal(await readFile(join(example, 'nested/message.txt'), 'utf8'), 'Original');
    } finally {
      await permissions(library, false).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  },
);
