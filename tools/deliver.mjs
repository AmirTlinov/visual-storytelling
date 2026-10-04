import { access, cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildOutput } from './build-output.mjs';
import { buildScene } from './build-pages.mjs';
import { prepareNarration } from './narration.mjs';
import { packDirectory } from './standalone.mjs';
import { exportVideo } from './video-export.mjs';
import { captionTrack } from '../dist/story/captions.js';
import { captionSource } from './caption-source.mjs';
import { pinSceneProject, closeSceneDependencies } from './scene-project.mjs';
import { contentDigest, diagnosePackage, sourceDigest } from './build-info.mjs';
const execute = promisify(execFile);

/** Assemble requested deliverables through their owners; publish only a complete release. */
export async function deliver(
  source,
  {
    out,
    formats = ['mp4'],
    silent = false,
    width = 1280,
    height,
    fps = 30,
    jobs = 2,
    theme = 'light',
    signal,
  } = {},
) {
  signal?.throwIfAborted();
  source = resolve(source);
  out = resolve(out ?? join(source, 'artifacts/release'));
  const wanted = new Set(formats);
  if (
    !wanted.size ||
    [...wanted].some((format) => !['mp4', 'html', 'srt', 'vtt', 'source'].includes(format))
  )
    throw new Error('Delivery formats: mp4,html,srt,vtt,source');
  if (!['light', 'dark'].includes(theme))
    throw new Error('Choose light or dark for the video; the HTML follows the viewer’s theme');
  let ownedFiles = [];
  try {
    const previous = JSON.parse(await readFile(join(out, 'delivery.json'), 'utf8'));
    const generated = new Set([
      'story.html',
      'story.mp4',
      'story.srt',
      'story.vtt',
      'source.tar.gz',
    ]);
    if (!Array.isArray(previous.files) || previous.files.some((name) => !generated.has(name)))
      throw new Error('Invalid delivery file ownership');
    ownedFiles = ['delivery.json', ...previous.files];
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error(
        `Output has no valid delivery receipt: ${out}; choose a new output directory`,
        { cause: error },
      );
  }
  if (!silent) await prepareNarration(source, { audible: true, signal });
  const omit = new Set(['node_modules', 'dist', 'site', 'artifacts', 'review', '__pycache__']);
  const include = (path) => {
    const parts = relative(source, path).split(sep);
    return (
      !parts.some((part) => part.startsWith('.') || omit.has(part)) &&
      path !== out &&
      !path.startsWith(out + sep)
    );
  };
  const signature = () => contentDigest(source, ['.'], (name) => !include(join(source, name)));
  const cliRoot = fileURLToPath(new URL('../', import.meta.url));
  const [authored, packages] = await Promise.all([signature(), diagnosePackage(cliRoot, source)]);
  const roots = [...new Set([packages.cli.root, packages.consumer?.root].filter(Boolean))];
  const sources = await Promise.all(roots.map(sourceDigest));
  async function unchanged() {
    signal?.throwIfAborted();
    const [current, report, ...digests] = await Promise.all([
      signature(),
      diagnosePackage(cliRoot, source),
      ...roots.map(sourceDigest),
    ]);
    if (
      current !== authored ||
      report.cli.build !== packages.cli.build ||
      report.consumer?.build !== packages.consumer?.build ||
      digests.some((digest, index) => digest !== sources[index])
    )
      throw new Error('Scene or package changed during delivery; retry after edits finish');
  }
  const built = join(source, 'dist');
  await buildScene(source, built, { silent, exclude: [out] });
  signal?.throwIfAborted();
  const identity = ({ name, version, build, status }) => ({
    package: name,
    version,
    build,
    status,
  });
  const receipt = {
    runtime: identity(packages.consumer ?? packages.cli),
    toolchain: identity(packages.cli),
    formats: [...wanted],
    files: [],
  };
  await buildOutput(
    source,
    out,
    async (staging) => {
      if (wanted.has('html')) {
        await writeFile(
          join(staging, 'story.html'),
          await packDirectory(built, 'index.html', { signal }),
        );
        receipt.files.push('story.html');
      }
      if (wanted.has('srt') || wanted.has('vtt')) {
        const track = captionTrack(await captionSource(built, { signal }));
        for (const format of ['srt', 'vtt'])
          if (wanted.has(format)) {
            await writeFile(join(staging, `story.${format}`), track.serialize(format));
            receipt.files.push(`story.${format}`);
          }
      }
      if (wanted.has('mp4')) {
        const video = await exportVideo({
          directory: built,
          output: join(staging, 'story.mp4'),
          width,
          height,
          fps,
          jobs,
          theme,
          signal,
          silent,
          onProgress: (done, count) => console.log(`${done}/${count} frames`),
        });
        receipt.video = { ...video, output: 'story.mp4' };
        receipt.files.push('story.mp4');
      }
      if (wanted.has('source')) {
        // Include the pinned package, lockfile, narration and editable source; omit derived directories.
        await unchanged();
        const sourceCopy = join(staging, 'source');
        await mkdir(sourceCopy);
        // Copy entries separately: the release can live inside the authoring directory.
        for (const name of await readdir(source)) {
          signal?.throwIfAborted();
          const entry = join(source, name);
          if (include(entry))
            await cp(entry, join(sourceCopy, name), { recursive: true, filter: include });
        }
        if (
          !(await access(join(sourceCopy, 'package.json')).then(
            () => true,
            () => false,
          ))
        ) {
          await pinSceneProject(sourceCopy, { signal, build: false });
        } else await closeSceneDependencies(source, sourceCopy, { signal });
        await execute('tar', ['-czf', join(staging, 'source.tar.gz'), '-C', staging, 'source'], {
          signal,
        });
        await rm(sourceCopy, { recursive: true });
        receipt.files.push('source.tar.gz');
      }
      await unchanged();
      await writeFile(join(staging, 'delivery.json'), JSON.stringify(receipt, null, 2) + '\n');
      signal?.throwIfAborted();
    },
    { ownedFiles, commitFile: 'delivery.json' },
  );
  return { ...receipt, directory: out };
}
