import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  mkdtemp,
  lstat,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { dataDirectory } from '../storage.mjs';
import { voiceDigest } from './receipt.mjs';
import { masterAdapterAudio, currentMastering } from './mastering.mjs';
import { spokenWords as tokens } from '../../dist/story/spoken-words.js';

const format = 'voice-adapter-v1';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const spoken = (text) => text.replace(/<\|[a-z]+:[a-z_]+\|>/g, '').trim();
const ignored = new Set(['node_modules', 'dist', 'site', 'artifacts', 'review', '__pycache__']);
const outputs = new Set([
  'audio.wav',
  'voice.wav',
  'music.wav',
  'timeline.json',
  'narration.txt',
  'voice-preview.html',
  'CREDITS.txt',
  'voice.json',
]);
const maybeJSON = async (file) =>
  readFile(file, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });

/** Public settings contain portable selection only. Secrets belong to the process environment. */
export function validateAdapterSettings(settings) {
  if (!settings || !['local', 'api'].includes(settings.provider))
    throw new Error('Choose provider "local" or "api" for a voice adapter.');
  const allowed = new Set(['provider', 'adapter', 'model', 'voice', 'language', 'enabled']);
  if (Object.keys(settings).some((key) => !allowed.has(key)))
    throw new Error(
      'Voice adapters accept provider, adapter, model, voice, language and enabled. Keep credentials in environment variables.',
    );
  const text = (value, label, maximum = 200) => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > maximum ||
      /[\x00-\x1f]/.test(value)
    )
      throw new Error(`Voice adapter ${label} must be a non-empty plain string.`);
    return value.trim();
  };
  const adapter = text(settings.adapter, 'adapter', 1000);
  if (
    isAbsolute(adapter) ||
    adapter.includes('\\') ||
    !adapter.endsWith('.mjs') ||
    adapter.split('/').some((part) => !part || part.startsWith('.') || ignored.has(part))
  )
    throw new Error(
      'Voice adapter must be a project-relative .mjs file, for example voice/adapter.mjs.',
    );
  if (settings.enabled !== undefined && typeof settings.enabled !== 'boolean')
    throw new Error('Voice adapter enabled must be boolean.');
  return {
    provider: settings.provider,
    adapter,
    model: text(settings.model, 'model'),
    ...(settings.voice !== undefined && { voice: text(settings.voice, 'voice') }),
    language: settings.language === undefined ? 'ru-RU' : text(settings.language, 'language', 35),
    ...(settings.enabled !== undefined && { enabled: settings.enabled }),
  };
}

const selection = (settings) => {
  const { enabled, ...sound } = validateAdapterSettings(settings);
  return sound;
};

/** A small adapter directory and its sibling assets form one verifiable implementation. */
async function adapterInput(directory, settings) {
  const root = await realpath(directory);
  let entry = root;
  for (const part of settings.adapter.split('/')) {
    entry = join(entry, part);
    if ((await lstat(entry)).isSymbolicLink())
      throw new Error('Voice adapter files must stay inside the project without symbolic links.');
  }
  if (!(await lstat(entry)).isFile())
    throw new Error('Voice adapter entry must be a regular file.');
  const folder = dirname(entry),
    files = {};
  async function visit(path, prefix = '') {
    for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (
        item.name.startsWith('.') ||
        ignored.has(item.name) ||
        item.name.endsWith('.pyc') ||
        (path === root && outputs.has(item.name))
      )
        continue;
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      const file = join(path, item.name);
      if (item.isSymbolicLink())
        throw new Error(
          'Voice adapter dependencies must stay inside the project without symbolic links.',
        );
      if (item.isDirectory()) await visit(file, name);
      else if (item.isFile()) files[name] = hash(await readFile(file));
      else throw new Error('Voice adapter dependencies must be regular files.');
    }
  }
  await visit(folder);
  return { entry, identity: voiceDigest({ version: 1, adapter: settings.adapter, files }) };
}

export async function adapterVoiceStatus(directory, settings) {
  try {
    const config = validateAdapterSettings(settings);
    if (!directory) throw new Error('Choose a project containing the voice adapter.');
    await adapterInput(directory, config);
    return {
      supported: true,
      ready: true,
      voices: [{ id: config.voice ?? config.model, name: config.model, language: config.language }],
    };
  } catch {
    return {
      supported: true,
      ready: false,
      voices: [],
      reason:
        'Configure a local or API model and a regular project-relative .mjs voice adapter. Discovery does not run it or contact the provider.',
    };
  }
}

function readWav(bytes) {
  const bad = () => {
    throw new Error('Voice adapter must produce a complete PCM16 mono take.wav.');
  };
  if (
    bytes.length < 44 ||
    bytes.length > 128_000_000 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    bad();
  let pcm,
    sampleRate,
    position = 12;
  while (position < bytes.length) {
    if (position + 8 > bytes.length) bad();
    const kind = bytes.toString('ascii', position, position + 4);
    const size = bytes.readUInt32LE(position + 4),
      start = position + 8,
      end = start + size;
    if (end > bytes.length) bad();
    if (kind === 'fmt ') {
      if (
        sampleRate ||
        size < 16 ||
        bytes.readUInt16LE(start) !== 1 ||
        bytes.readUInt16LE(start + 2) !== 1 ||
        bytes.readUInt16LE(start + 14) !== 16
      )
        bad();
      sampleRate = bytes.readUInt32LE(start + 4);
      if (
        sampleRate < 8000 ||
        sampleRate > 192000 ||
        bytes.readUInt32LE(start + 8) !== sampleRate * 2 ||
        bytes.readUInt16LE(start + 12) !== 2
      )
        bad();
    } else if (kind === 'data') {
      if (pcm || !size || size % 2) bad();
      pcm = bytes.subarray(start, end);
    }
    position = end + (size % 2);
  }
  if (position !== bytes.length || !sampleRate || !pcm) bad();
  return { pcm, sampleRate, frames: pcm.length / 2, duration: pcm.length / (sampleRate * 2) };
}

function wav(pieces, sampleRate) {
  const pcm = Buffer.concat(pieces),
    header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function markers(value, text, duration, sampleRate) {
  if (!Array.isArray(value) || !value.length || value.length > 20000)
    throw new Error('Voice adapter must return actual word or phrase timestamps.');
  let previous = 0;
  const result = value.map((word) => {
    if (
      !word ||
      typeof word.text !== 'string' ||
      !tokens(word.text).length ||
      !Number.isFinite(word.start) ||
      !Number.isFinite(word.end) ||
      word.start < previous ||
      word.end <= word.start ||
      word.end > duration + 1 / sampleRate
    )
      throw new Error('Voice adapter timestamps must be ordered and fit the complete waveform.');
    previous = word.end;
    return { text: word.text, start: word.start, end: word.end };
  });
  if (voiceDigest(result.flatMap((word) => tokens(word.text))) !== voiceDigest(tokens(text)))
    throw new Error(
      'Voice adapter timestamps must cover the complete spoken text without missing or extra words.',
    );
  return result;
}

const alignment = (value) => {
  if (!value || typeof value.method !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(value.method))
    throw new Error('Voice adapter must identify its real alignment method.');
  return { method: value.method };
};

async function invoke(entry, directory, input, signal, managedProcessGroup) {
  signal?.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    // JobRunner retains its group, including adapter descendants. Standalone synthesis
    // owns a separate group so cancelling a local model also stops its Python children.
    const ownGroup = process.platform !== 'win32' && !managedProcessGroup;
    const child = spawn(process.execPath, [entry], {
      cwd: directory,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: ownGroup,
    });
    let output = '',
      size = 0,
      failure,
      timer,
      killTimer,
      exited = false,
      finished = false;
    const send = (name) => {
      try {
        if (ownGroup && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      if (ownGroup) send('SIGKILL');
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (error) reject(error);
      else resolveResult(result);
    };
    const stop = (error) => {
      failure ??= error;
      send('SIGTERM');
      if (exited) return finish(failure);
      killTimer ??= setTimeout(() => {
        send('SIGKILL');
        finish(failure);
      }, 1500);
      killTimer.unref();
    };
    const abort = () => stop(signal.reason ?? new Error('Voice adapter cancelled.'));
    timer = setTimeout(() => stop(new Error('Voice adapter timed out after 180 seconds.')), 180000);
    timer.unref();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) stop(new Error('Voice adapter response exceeded the 1 MB limit.'));
      else output += chunk.toString('utf8');
    });
    // Provider errors and stdout can contain credentials. They never enter jobs or chat errors.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('error', () => finish(new Error('Voice adapter could not be started.')));
    // A killed wrapper can leave inherited stdout open in descendants. The worker
    // must still report failure so JobRunner can release its complete process group.
    child.once('exit', (code) => {
      exited = true;
      if (code !== 0) failure ??= new Error(`Voice adapter failed (exit ${code ?? 'signal'}).`);
      if (failure) finish(failure);
    });
    child.once('close', (code) => {
      if (failure) return finish(failure);
      if (code !== 0) return finish(new Error(`Voice adapter failed (exit ${code ?? 'signal'}).`));
      try {
        finish(null, JSON.parse(output));
      } catch {
        finish(new Error('Voice adapter must return only its JSON timestamp manifest on stdout.'));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

async function take(directory, backend, settings, text, cache, signal, managedProcessGroup) {
  const key = voiceDigest({
    version: 1,
    adapter: backend.identity,
    settings: selection(settings),
    text,
  });
  const target = join(cache, `adapter-${key}`);
  const validate = (bytes, receipt) => {
    const audio = readWav(bytes);
    if (receipt.key !== key || receipt.audio_sha256 !== hash(bytes))
      throw new Error('Stale voice take.');
    if (!audio.pcm.some((value) => value !== 0))
      throw new Error('Voice adapter returned silent audio.');
    return {
      ...audio,
      words: markers(receipt.words, text, audio.duration, audio.sampleRate),
      alignment: alignment(receipt.alignment),
    };
  };
  try {
    const receipt = JSON.parse(await readFile(join(target, 'take.json'), 'utf8'));
    return { ...validate(await readFile(join(target, 'take.wav')), receipt), cached: true };
  } catch (error) {
    signal?.throwIfAborted();
    if (error.code && error.code !== 'ENOENT') throw error;
  }
  await mkdir(cache, { recursive: true });
  const staging = await mkdtemp(join(cache, '.adapter-take-'));
  try {
    const result = await invoke(
      backend.entry,
      directory,
      {
        version: 1,
        provider: settings.provider,
        text,
        model: settings.model,
        ...(settings.voice !== undefined && { voice: settings.voice }),
        language: settings.language,
        outputDirectory: staging,
      },
      signal,
      managedProcessGroup,
    );
    const path = join(staging, 'take.wav');
    const file = await lstat(path);
    if (!file.isFile() || file.size > 128_000_000)
      throw new Error('Voice adapter take.wav must be a bounded regular file.');
    const bytes = await readFile(path);
    const receipt = {
      key,
      audio_sha256: hash(bytes),
      words: result?.words,
      alignment: result?.alignment,
    };
    const audio = validate(bytes, receipt);
    if ((await adapterInput(directory, settings)).identity !== backend.identity)
      throw new Error('Voice adapter changed during synthesis. Its take was not cached.');
    signal?.throwIfAborted();
    // Cache only validated output, not arbitrary files an API client might have written.
    const prepared = await mkdtemp(join(cache, '.adapter-cache-'));
    try {
      await writeFile(join(prepared, 'take.wav'), bytes);
      await writeFile(join(prepared, 'take.json'), JSON.stringify(receipt));
      signal?.throwIfAborted();
      await rm(target, { recursive: true, force: true });
      await rename(prepared, target);
    } finally {
      await rm(prepared, { recursive: true, force: true });
    }
    return { ...audio, cached: false };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function pause(value) {
  if (!Number.isFinite(value) || value < 0 || value > 30)
    throw new Error('Narration pauses must be from 0 to 30 seconds.');
  return value;
}

function scriptSpec(spec) {
  if (!spec || !Array.isArray(spec.segments) || !spec.segments.length)
    throw new Error('Narration needs a non-empty segments array.');
  if (spec.music) throw new Error('Local/API voice adapters currently require music: null.');
  if (spec.voice?.reference_audio || spec.voice?.reference_text || spec.voice?.delivery)
    throw new Error(
      'Local/API adapters accept their selected voice ID; remove Higgs reference and delivery controls from this narration.',
    );
  pause(spec.intro ?? 0.4);
  pause(spec.outro ?? 0.4);
  const ids = new Set();
  for (const segment of spec.segments) {
    for (const item of [segment, ...(segment.cues ?? [])]) {
      if (typeof item?.id !== 'string' || !/^[a-z][a-z0-9_.-]*$/.test(item.id) || ids.has(item.id))
        throw new Error('Narration segments and cues need unique valid IDs.');
      ids.add(item.id);
    }
    if (
      typeof segment.text !== 'string' ||
      segment.text.length > 20000 ||
      !tokens(spoken(segment.text)).length
    )
      throw new Error('Each narration segment needs a bounded non-empty spoken text.');
    if (segment.delivery || /<\|[^>]*\|>/.test(segment.text))
      throw new Error(
        'Higgs delivery controls need to be removed before using a local/API voice adapter.',
      );
    pause(segment.pause_after ?? 0);
  }
  for (const segment of spec.segments)
    for (const cue of segment.cues ?? []) {
      quoteIndex(tokens(spoken(segment.text)), cue);
      if (
        (cue.action !== undefined && cue.hold !== undefined) ||
        [cue.action, cue.hold].some(
          (value) => value !== undefined && (typeof value !== 'string' || !value.trim()),
        )
      )
        throw new Error(`Narration cue ${cue.id} needs either a non-empty action or hold.`);
      const timing = cue.timing;
      if (
        timing !== undefined &&
        (!timing ||
          typeof timing !== 'object' ||
          Array.isArray(timing) ||
          Object.keys(timing).some((key) => !['duration', 'until', 'delay'].includes(key)) ||
          'duration' in timing === 'until' in timing ||
          (timing.delay !== undefined && (!Number.isFinite(timing.delay) || timing.delay < 0)) ||
          ('duration' in timing && (!Number.isFinite(timing.duration) || timing.duration <= 0)) ||
          ('until' in timing && (!ids.has(timing.until) || timing.until === cue.id)))
      )
        throw new Error(`Narration cue ${cue.id} needs a valid duration or following cue.`);
    }
  return spec;
}

function quoteIndex(lexical, cue) {
  const quote = typeof cue.quote === 'string' ? tokens(cue.quote) : [];
  const matches = lexical.flatMap((_, i) =>
    quote.length && quote.every((word, j) => lexical[i + j] === word) ? [i] : [],
  );
  const occurrence = cue.occurrence ?? 1,
    at = matches[occurrence - 1];
  if (
    !Number.isInteger(occurrence) ||
    occurrence < 1 ||
    at === undefined ||
    (matches.length > 1 && cue.occurrence === undefined)
  )
    throw new Error(`Narration cue ${cue.id} needs an unambiguous quote and occurrence.`);
  return { at, length: quote.length };
}

function cueRecords(spec, segments) {
  const cues = {};
  for (const [index, segment] of spec.segments.entries()) {
    const record = segments[index],
      words = record.words;
    cues[segment.id] = { text: record.text, start: words[0].start, end: words.at(-1).end };
    const lexical = words.flatMap((word, at) => tokens(word.text).map((text) => ({ text, at })));
    for (const cue of segment.cues ?? []) {
      const { at, length } = quoteIndex(
        lexical.map((word) => word.text),
        cue,
      );
      cues[cue.id] = {
        text: cue.quote,
        start: words[lexical[at].at].start,
        end: words[lexical[at + length - 1].at].end,
        ...Object.fromEntries(
          ['action', 'hold', 'timing', 'awaitInput']
            .filter((key) => cue[key] !== undefined)
            .map((key) => [key, structuredClone(cue[key])]),
        ),
      };
    }
  }
  return cues;
}

async function inputs(directory, sourceFile, settings) {
  const spec = scriptSpec(JSON.parse(await readFile(sourceFile, 'utf8')));
  const backend = await adapterInput(directory, settings);
  const authored = await maybeJSON(join(directory, 'story.json'));
  return {
    spec,
    backend,
    identity: {
      source: voiceDigest(spec),
      authored: voiceDigest(authored ?? spec),
      adapter: backend.identity,
      voice: voiceDigest(await maybeJSON(join(directory, 'voice.json'))),
    },
  };
}

/** Publish the paired recording/receipt only after validation; restore both on failure/cancellation. */
async function publish(directory, staging, signal) {
  const moved = [],
    installed = [];
  try {
    for (const name of ['audio.wav', 'timeline.json']) {
      const target = join(directory, name);
      const existing = await lstat(target).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (existing && !existing.isFile())
        throw new Error('Narration output must be a regular project file.');
      if (existing) {
        await rename(target, join(staging, 'previous-' + name));
        moved.push(name);
      }
    }
    signal?.throwIfAborted();
    for (const name of ['audio.wav', 'timeline.json']) {
      await rename(join(staging, name), join(directory, name));
      installed.push(name);
    }
    signal?.throwIfAborted();
  } catch (error) {
    const recovery = [];
    for (const name of installed)
      await rm(join(directory, name), { force: true }).catch((failure) => recovery.push(failure));
    for (const name of moved)
      await rename(join(staging, 'previous-' + name), join(directory, name)).catch((failure) =>
        recovery.push(failure),
      );
    if (recovery.length) {
      const failure = new AggregateError(
        [error, ...recovery],
        `Narration could not be restored. Recovery files remain at ${staging}.`,
      );
      failure.preserveNarrationStaging = true;
      throw failure;
    }
    throw error;
  }
}

/** External models provide performances and measured timestamps; this owner assembles the story. */
export async function buildAdapterNarration(
  directory,
  sourceFile,
  settings,
  { signal, progress = () => {}, cache, managedProcessGroup = false } = {},
) {
  const config = validateAdapterSettings(settings);
  signal?.throwIfAborted();
  const initial = await inputs(directory, sourceFile, config),
    { spec, backend } = initial;
  const accepted = await maybeJSON(join(directory, 'timeline.json'));
  if (accepted?.digest_format === format) {
    let reusable = false;
    try {
      await checkAdapterNarration(directory, sourceFile, accepted, config, undefined, {
        requireMastering: false,
      });
      reusable = true;
    } catch (error) {
      // Only changed performance inputs permit another provider call. A corrupt accepted
      // recording or failed remaster must not silently spend a new paid request.
      if (!error.message.includes('Narration, selected model or voice adapter changed'))
        throw error;
    }
    if (reusable) {
      if (!currentMastering(accepted)) {
        const previous = await readFile(join(directory, 'audio.wav'));
        const { audio, mastering } = await masterAdapterAudio(previous, readWav(previous), {
          signal,
        });
        const next = {
          ...accepted,
          audio_sha256: hash(audio),
          mix: { ...accepted.mix, mastering },
        };
        const staging = await mkdtemp(join(dirname(resolve(directory)), '.voice-remaster-'));
        let preserve = false;
        try {
          if (
            hash(await readFile(join(directory, 'audio.wav'))) !== hash(previous) ||
            voiceDigest(await maybeJSON(join(directory, 'timeline.json'))) !==
              voiceDigest(accepted) ||
            voiceDigest((await inputs(directory, sourceFile, config)).identity) !==
              voiceDigest(initial.identity)
          )
            throw new Error(
              'Accepted narration changed during remastering. Retry after edits finish.',
            );
          await writeFile(join(staging, 'audio.wav'), audio);
          await writeFile(join(staging, 'timeline.json'), JSON.stringify(next, null, 2) + '\n');
          await publish(directory, staging, signal);
        } catch (error) {
          preserve = error.preserveNarrationStaging === true;
          throw error;
        } finally {
          if (!preserve) await rm(staging, { recursive: true, force: true });
        }
      }
      return {
        duration: accepted.duration,
        cached: spec.segments.length,
        segments: spec.segments.length,
        voice: config.voice ?? config.model,
      };
    }
  }
  cache ??= join(dataDirectory(), 'speech');
  const pieces = [],
    segments = [],
    alignments = [];
  let cursor = 0,
    sampleRate,
    cached = 0;
  const silence = (seconds) => {
    const frames = Math.round(pause(seconds) * sampleRate);
    pieces.push(Buffer.alloc(frames * 2));
    cursor += frames;
  };
  for (const [index, segment] of spec.segments.entries()) {
    signal?.throwIfAborted();
    progress('Подготавливаю выбранную озвучку', { done: index, total: spec.segments.length });
    const text = spoken(segment.text);
    const clip = await take(directory, backend, config, text, cache, signal, managedProcessGroup);
    if (!sampleRate) {
      sampleRate = clip.sampleRate;
      silence(spec.intro ?? 0.4);
    }
    if (clip.sampleRate !== sampleRate)
      throw new Error('Voice adapter changed sample rate between narration segments.');
    cached += Number(clip.cached);
    const offset = cursor / sampleRate;
    const words = clip.words.map((word) => ({
      ...word,
      start: word.start + offset,
      end: word.end + offset,
    }));
    segments.push({
      id: segment.id,
      ...(segment.title !== undefined && { title: segment.title }),
      text,
      start: words[0].start,
      end: words.at(-1).end,
      audio_start: offset,
      audio_end: (cursor + clip.frames) / sampleRate,
      words,
    });
    alignments.push({ id: segment.id, ...clip.alignment });
    pieces.push(clip.pcm);
    cursor += clip.frames;
    silence(segment.pause_after ?? 0);
  }
  silence(spec.outro ?? 0.4);
  const raw = wav(pieces, sampleRate);
  const { audio: bytes, mastering } = await masterAdapterAudio(raw, readWav(raw), { signal });
  const timeline = {
    version: 1,
    digest_format: format,
    sample_rate: sampleRate,
    duration: cursor / sampleRate,
    source_sha256: initial.identity.source,
    authored_source_sha256: initial.identity.authored,
    audio: 'audio.wav',
    voice: 'audio.wav',
    music: null,
    audio_sha256: hash(bytes),
    mix: { mastering },
    voice_settings: selection(config),
    synthesis: { provider: config.provider, model: config.model, adapter_sha256: backend.identity },
    alignment: { method: 'adapter-timestamps', segments: alignments },
    segments,
    cues: cueRecords(spec, segments),
    ...(spec.captionAliases !== undefined && { captionAliases: spec.captionAliases }),
  };
  const { cueSheet } = await import('../../dist/story/cues.js');
  cueSheet(timeline);
  if (
    voiceDigest((await inputs(directory, sourceFile, config)).identity) !==
    voiceDigest(initial.identity)
  )
    throw new Error(
      'Narration, voice selection or adapter changed during synthesis. Prepare the current source.',
    );
  signal?.throwIfAborted();
  const staging = await mkdtemp(join(dirname(resolve(directory)), '.voice-adapter-'));
  let preserve = false;
  try {
    await writeFile(join(staging, 'audio.wav'), bytes);
    await writeFile(join(staging, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
    await publish(directory, staging, signal);
  } catch (error) {
    preserve = error.preserveNarrationStaging === true;
    throw error;
  } finally {
    if (!preserve) await rm(staging, { recursive: true, force: true });
  }
  return {
    duration: timeline.duration,
    cached,
    segments: segments.length,
    voice: config.voice ?? config.model,
  };
}

/** Receipt verification is local and read-only; it never invokes a model or an API. */
export async function checkAdapterNarration(
  directory,
  script,
  receipt,
  settings,
  audio,
  { requireMastering = true } = {},
) {
  const config = validateAdapterSettings(settings);
  const sourceFile = typeof script === 'string' ? script : script.file;
  const sourceDirectory = typeof script === 'string' ? directory : (script.directory ?? directory);
  const current = await inputs(sourceDirectory, sourceFile, config),
    { spec } = current;
  if (
    receipt.digest_format !== format ||
    receipt.source_sha256 !== current.identity.source ||
    receipt.authored_source_sha256 !== current.identity.authored ||
    voiceDigest(receipt.voice_settings) !== voiceDigest(selection(config)) ||
    receipt.synthesis?.provider !== config.provider ||
    receipt.synthesis?.model !== config.model ||
    receipt.synthesis?.adapter_sha256 !== current.backend.identity
  )
    throw new Error(
      'Narration, selected model or voice adapter changed. Prepare the current narration.',
    );
  const bytes = await readFile(audio ?? join(directory, 'audio.wav'));
  const wave = readWav(bytes);
  if (!wave.pcm.some((value) => value !== 0))
    throw new Error('Accepted narration audio is silent.');
  if (
    receipt.audio_sha256 !== hash(bytes) ||
    receipt.sample_rate !== wave.sampleRate ||
    Math.abs(receipt.duration - wave.duration) > 1 / wave.sampleRate ||
    !Number.isFinite(receipt.duration)
  )
    throw new Error('Narration audio does not match its verified receipt.');
  if (!Array.isArray(receipt.segments) || receipt.segments.length !== spec.segments.length)
    throw new Error('Narration is missing aligned segments.');
  let cursor = Math.round((spec.intro ?? 0.4) * wave.sampleRate);
  for (const [index, segment] of spec.segments.entries()) {
    const record = receipt.segments[index],
      text = spoken(segment.text);
    if (
      !record ||
      record.id !== segment.id ||
      record.text !== text ||
      record.title !== segment.title ||
      !Number.isFinite(record.audio_start) ||
      !Number.isFinite(record.audio_end) ||
      Math.abs(record.audio_start - cursor / wave.sampleRate) > 1 / wave.sampleRate ||
      record.audio_end <= record.audio_start ||
      record.audio_end > wave.duration ||
      !Array.isArray(record.words)
    )
      throw new Error('Narration segment timing differs from its source and waveform.');
    markers(
      record.words.map((word) => ({
        ...word,
        start: word.start - record.audio_start,
        end: word.end - record.audio_start,
      })),
      text,
      record.audio_end - record.audio_start,
      wave.sampleRate,
    );
    if (record.start !== record.words[0].start || record.end !== record.words.at(-1).end)
      throw new Error('Narration segment differs from its aligned words.');
    cursor =
      Math.round(record.audio_end * wave.sampleRate) +
      Math.round((segment.pause_after ?? 0) * wave.sampleRate);
  }
  cursor += Math.round((spec.outro ?? 0.4) * wave.sampleRate);
  const cues = cueRecords(spec, receipt.segments);
  if (
    cursor !== wave.frames ||
    voiceDigest(cues) !== voiceDigest(receipt.cues) ||
    voiceDigest(spec.captionAliases ?? null) !== voiceDigest(receipt.captionAliases ?? null)
  )
    throw new Error('Narration cues or pauses differ from the current source.');
  const { cueSheet } = await import('../../dist/story/cues.js');
  cueSheet(receipt);
  if (requireMastering && !currentMastering(receipt))
    throw new Error('Narration mastering changed. Prepare the current narration.');
}
