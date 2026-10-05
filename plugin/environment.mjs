import { readFile, open, mkdir, mkdtemp, rename, rm, chmod, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeJSON, readJSON } from './runtime/storage.mjs';
const execute = promisify(execFile);

// Immutable upstream artifacts for the supported macOS ARM64 release.
const resources = {
  chromium: {
    version: '153.0.8010.12',
    url: 'https://cdn.playwright.dev/builds/cft/153.0.8010.12/mac-arm64/chrome-headless-shell-mac-arm64.zip',
    algorithm: 'sha256',
    digest: '89d80a6d26ccd0ccfd51e22d9e1297283862af2b0cd91dce07459b35ca0059f2',
    binary: 'chrome-headless-shell-mac-arm64/chrome-headless-shell',
    archive: 'zip',
  },
  ffmpeg: {
    version: '8.0.3-build4',
    url: 'https://github.com/AtlasYang/ffmpeg-static-builds/releases/download/ffmpeg-8.0.3-build4/ffmpeg-8.0.3-macos-arm64.tar.gz',
    algorithm: 'sha256',
    digest: '26f6269b117a51c5fdfd3a870c4e0a62b99f0575740a3933fc3d852f0a3f80b1',
    binary: 'ffmpeg',
    archive: 'tgz',
  },
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function environmentStatus(data) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(resources).map(async ([id, resource]) => {
        const directory = join(data, 'environment', `${id}-${resource.version}`);
        const receipt = await readJSON(join(directory, 'receipt.json'));
        const ready =
          receipt?.digest === resource.digest &&
          (await access(join(directory, resource.binary)).then(
            () => true,
            () => false,
          ));
        return [id, { version: resource.version, ready: Boolean(ready) }];
      }),
    ),
  );
}

async function prepareResource(data, id, { signal, progress }) {
  const resource = resources[id],
    directory = join(data, 'environment', `${id}-${resource.version}`);
  const binary = join(directory, resource.binary);
  const receipt = await readJSON(join(directory, 'receipt.json'));
  if (
    receipt?.digest === resource.digest &&
    (await readFile(binary).then(
      (bytes) => hash(bytes) === receipt.binary,
      () => false,
    ))
  )
    return binary;
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('Automatic export preparation supports macOS Apple Silicon.');
  progress(`Подготавливаю ${id === 'chromium' ? 'движок видео' : 'кодировщик звука и видео'}…`);
  await mkdir(dirname(directory), { recursive: true });
  const temporary = await mkdtemp(directory + '.preparing-');
  try {
    const response = await fetch(resource.url, { signal });
    if (!response.ok) throw new Error(`Resource download failed: HTTP ${response.status}`);
    const digest = createHash(resource.algorithm),
      archive = join(temporary, 'download');
    const file = await open(archive, 'wx');
    let received = 0,
      lastProgress = 0;
    const total = Number(response.headers.get('content-length'));
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        digest.update(chunk);
        await file.write(chunk);
        received += chunk.length;
        if (total && Date.now() - lastProgress > 500) {
          progress(`Загружаю ${id} · МБ`, {
            done: Math.round(received / 1048576),
            total: Math.ceil(total / 1048576),
          });
          lastProgress = Date.now();
        }
      }
    } finally {
      await file.close();
    }
    if (digest.digest(resource.encoding ?? 'hex') !== resource.digest)
      throw new Error('Downloaded export tool failed its integrity check. Retry preparation.');
    await execute(
      resource.archive === 'zip' ? '/usr/bin/unzip' : '/usr/bin/tar',
      resource.archive === 'zip'
        ? ['-q', archive, '-d', temporary]
        : ['-xzf', archive, '-C', temporary],
      { signal },
    );
    await rm(archive);
    await chmod(join(temporary, resource.binary), 0o755);
    await execute(join(temporary, resource.binary), [id === 'ffmpeg' ? '-version' : '--version'], {
      signal,
    });
    await writeJSON(join(temporary, 'receipt.json'), {
      version: resource.version,
      source: resource.url,
      digest: resource.digest,
      binary: hash(await readFile(join(temporary, resource.binary))),
    });
    await rm(directory, { recursive: true, force: true });
    await rename(temporary, directory);
    return binary;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Called only by the serial JobRunner worker, on demand. Doctor never downloads. */
export async function prepareEnvironment(data, { browser = false, encoder = false, ...task }) {
  if (encoder)
    process.env.PATH =
      dirname(await prepareResource(data, 'ffmpeg', task)) + ':' + process.env.PATH;
  if (encoder) process.env.VISUAL_STORY_VIDEO_ENCODER = 'h264_videotoolbox';
  if (browser) process.env.VISUAL_STORY_CHROMIUM = await prepareResource(data, 'chromium', task);
}
