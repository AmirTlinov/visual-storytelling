import { withPreparationLock } from './environment/lock.mjs';
import { readFile, open, mkdir, mkdtemp, rename, rm, chmod, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeJSON, readJSON } from './storage.mjs';
import {
  configureVoiceEnvironment,
  voiceEnvironmentStatus,
  prepareVoiceEnvironment,
  requireVoiceSupport,
} from './environment/voice.mjs';
import { pythonEnvironment, preparePythonEnvironment } from './environment/python.mjs';
import { environmentProfile, requireEnvironmentProfile } from './environment/resources.mjs';
const execute = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const prependPath = (directory) => {
  process.env.PATH = [
    directory,
    ...(process.env.PATH ?? '').split(':').filter((part) => part && part !== directory),
  ].join(':');
};

export async function environmentStatus(data) {
  const resources = environmentProfile()?.resources;
  if (!resources)
    return {
      ...Object.fromEntries(
        ['uv', 'chromium', 'ffmpeg'].map((id) => [id, { ready: false, supported: false }]),
      ),
      higgs: await voiceEnvironmentStatus(data),
    };
  const status = Object.fromEntries(
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
  return { ...status, higgs: await voiceEnvironmentStatus(data) };
}

async function prepareResource(data, id, task) {
  const { signal, progress } = task;
  const resource = requireEnvironmentProfile().resources[id],
    directory = join(data, 'environment', `${id}-${resource.version}`);
  return withPreparationLock(directory + '.lock', task, async () => {
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
    progress(
      `Подготавливаю ${{ chromium: 'движок видео', ffmpeg: 'кодировщик звука и видео', uv: 'установщик Python' }[id]}…`,
    );
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
          : ['-xf', archive, '-C', temporary],
        { signal },
      );
      await rm(archive);
      await chmod(join(temporary, resource.binary), 0o755);
      await execute(
        join(temporary, resource.binary),
        [id === 'ffmpeg' ? '-version' : '--version'],
        {
          signal,
        },
      );
      await writeJSON(join(temporary, 'receipt.json'), {
        version: resource.version,
        source: resource.url,
        digest: resource.digest,
        binary: hash(await readFile(join(temporary, resource.binary))),
        ...(resource.license
          ? {
              license: resource.license,
              licenseURL: resource.licenseURL,
              sourceCode: resource.sourceCode,
              ...(resource.upstreamSource ? { upstreamSource: resource.upstreamSource } : {}),
            }
          : {}),
      });
      await rm(directory, { recursive: true, force: true });
      await rename(temporary, directory);
      return binary;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

/** Bind already prepared resources. Doctor never downloads. */
export async function configureEnvironment(data) {
  await configureVoiceEnvironment(data);
  const resources = environmentProfile()?.resources;
  if (!resources) return;
  const ffmpeg = join(
    data,
    'environment',
    `ffmpeg-${resources.ffmpeg.version}`,
    resources.ffmpeg.binary,
  );
  const receipt = await readJSON(
    join(data, 'environment', `ffmpeg-${resources.ffmpeg.version}`, 'receipt.json'),
  );
  if (
    receipt?.digest === resources.ffmpeg.digest &&
    (await access(ffmpeg).then(
      () => true,
      () => false,
    ))
  )
    prependPath(dirname(ffmpeg));
}

export async function prepareEnvironment(
  data,
  {
    browser = false,
    encoder = false,
    voice = false,
    python = false,
    signal = new AbortController().signal,
    progress = (stage) => console.error(stage),
  },
) {
  const task = { signal, progress };
  if (voice) requireVoiceSupport();
  if (encoder) prependPath(dirname(await prepareResource(data, 'ffmpeg', task)));
  if (encoder) process.env.VISUAL_STORY_VIDEO_ENCODER = requireEnvironmentProfile().encoder;
  if (browser) process.env.VISUAL_STORY_CHROMIUM = await prepareResource(data, 'chromium', task);
  if (voice || python) {
    const uv = (!voice && process.env.VISUAL_STORY_UV) || (await prepareResource(data, 'uv', task));
    if (python) {
      const executable =
        process.env.VISUAL_STORY_PYTHON ?? (await preparePythonEnvironment(data, uv, task));
      Object.assign(process.env, pythonEnvironment(data), {
        VISUAL_STORY_UV: uv,
        VISUAL_STORY_PYTHON: executable,
      });
      prependPath(dirname(executable));
    }
    if (voice) {
      await preparePythonEnvironment(data, uv, task);
      await prepareVoiceEnvironment(data, uv, task);
    }
  }
}
