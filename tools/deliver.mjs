import { access, cp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildOutput } from './build-output.mjs';
import { buildScene } from './build-pages.mjs';
import { buildNarration } from './narration.mjs';
import { packDirectory } from './standalone.mjs';
import { exportVideo } from './video-export.mjs';
import { captionTrack } from '../dist/story/captions.js';
import { pinSceneProject } from './scene-project.mjs';
import { diagnosePackage } from './build-info.mjs';
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
  if (
    !silent &&
    (await access(join(source, 'narration.json')).then(
      () => true,
      () => false,
    ))
  )
    await buildNarration(source, { signal });
  const built = join(source, 'dist');
  await buildScene(source, built, { silent, exclude: [out] });
  signal?.throwIfAborted();
  const packages = await diagnosePackage(fileURLToPath(new URL('../', import.meta.url)), source);
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
  await buildOutput(source, out, async (staging) => {
    if (wanted.has('html')) {
      await writeFile(
        join(staging, 'story.html'),
        await packDirectory(built, 'index.html', { signal }),
      );
      receipt.files.push('story.html');
    }
    if (wanted.has('srt') || wanted.has('vtt')) {
      const track = captionTrack(JSON.parse(await readFile(join(built, 'timeline.json'), 'utf8')));
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
      const sourceCopy = join(staging, 'source');
      const omit = new Set(['node_modules', 'dist', 'site', 'artifacts', 'review', '__pycache__']);
      await mkdir(sourceCopy);
      const include = (path) => {
        const parts = relative(source, path).split(sep);
        return (
          !parts.some((part) => part.startsWith('.') || omit.has(part)) &&
          path !== out &&
          !path.startsWith(out + sep)
        );
      };
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
      )
        await pinSceneProject(sourceCopy, { signal });
      await execute('tar', ['-czf', join(staging, 'source.tar.gz'), '-C', staging, 'source'], {
        signal,
      });
      await rm(sourceCopy, { recursive: true });
      receipt.files.push('source.tar.gz');
    }
    await writeFile(join(staging, 'delivery.json'), JSON.stringify(receipt, null, 2) + '\n');
    signal?.throwIfAborted();
  });
  return { ...receipt, directory: out };
}
