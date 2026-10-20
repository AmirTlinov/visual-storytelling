import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, lstat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { voiceDigest, voiceBytesDigest as hash } from './receipt.mjs';
import { spokenWords as tokens } from '../../dist/story/spoken-words.js';
import { adapterInput, adapterSelection } from './adapter-input.mjs';
export function readWav(bytes) {
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

export function wav(pieces, sampleRate) {
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

export function markers(value, text, duration, sampleRate) {
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

const takeKey = (adapter, settings, text) =>
  voiceDigest({
    version: 1,
    adapter,
    settings: adapterSelection(settings),
    text,
  });

async function cacheTake(cache, key, bytes, receipt, signal) {
  await mkdir(cache, { recursive: true });
  const prepared = await mkdtemp(join(cache, '.adapter-cache-'));
  try {
    await writeFile(join(prepared, 'take.wav'), bytes);
    await writeFile(join(prepared, 'take.json'), JSON.stringify(receipt));
    signal?.throwIfAborted();
    const target = join(cache, `adapter-${key}`);
    await rm(target, { recursive: true, force: true });
    await rename(prepared, target);
  } finally {
    await rm(prepared, { recursive: true, force: true });
  }
}

/** A missing cache can recover one complete accepted performance; no words are cut or regenerated. */
function acceptedTake({ wave, unit, gainDB, alignment: method, recordingSHA }, text) {
  const first = Math.round(unit.audio_start * wave.sampleRate),
    last = Math.round(unit.audio_end * wave.sampleRate);
  if (
    !Number.isFinite(gainDB) ||
    !Number.isInteger(first) ||
    !Number.isInteger(last) ||
    first < 0 ||
    last <= first ||
    last > wave.frames
  )
    throw new Error('Accepted whole take has invalid recovery bounds or mastering gain.');
  const pcm = Buffer.from(wave.pcm.subarray(first * 2, last * 2)),
    gain = 10 ** (-gainDB / 20);
  for (let i = 0; i < pcm.length; i += 2) {
    const value = Math.round(pcm.readInt16LE(i) * gain);
    const quantization = Math.ceil((gain + 1) / 2);
    if (!Number.isFinite(value) || value < -32768 - quantization || value > 32767 + quantization)
      throw new Error('Accepted mastering cannot be inverted without clipping.');
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i);
  }
  const bytes = wav([pcm], wave.sampleRate),
    audio = readWav(bytes);
  return {
    bytes,
    words: markers(
      unit.words.map((word) => ({
        ...word,
        start: word.start - unit.audio_start,
        end: word.end - unit.audio_start,
      })),
      text,
      audio.duration,
      wave.sampleRate,
    ),
    alignment: alignment(method),
    origin: { recording_sha256: recordingSHA, unit: unit.id },
  };
}

/** Migration transfers verified cache metadata; original performance bytes remain intact. */
export async function rebindCachedTake(cache, previous, current, settings, text, signal) {
  const oldKey = takeKey(previous, settings, text),
    key = takeKey(current, settings, text);
  if (oldKey === key) return;
  const old = join(cache, `adapter-${oldKey}`),
    target = join(cache, `adapter-${key}`);
  const accepted = await Promise.all([
    readFile(join(old, 'take.json'), 'utf8'),
    readFile(join(old, 'take.wav')),
  ]).catch((error) => {
    if (error.code === 'ENOENT') return;
    throw error;
  });
  // Collected caches are optional; the verified complete recording remains durable.
  if (!accepted) return;
  const receipt = JSON.parse(accepted[0]);
  const bytes = accepted[1];
  if (receipt.key !== oldKey || receipt.audio_sha256 !== hash(bytes))
    throw new Error('Accepted take cache changed; migration cannot synthesize a replacement.');
  const wave = readWav(bytes);
  markers(receipt.words, text, wave.duration, wave.sampleRate);
  alignment(receipt.alignment);
  signal?.throwIfAborted();
  const staging = await mkdtemp(join(cache, '.adapter-binding-'));
  try {
    await writeFile(join(staging, 'take.wav'), bytes);
    await writeFile(join(staging, 'take.json'), JSON.stringify({ ...receipt, key }));
    signal?.throwIfAborted();
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function take(
  directory,
  backend,
  settings,
  text,
  cache,
  signal,
  managedProcessGroup,
  reuseOnly = false,
  recovery,
) {
  const key = takeKey(backend.identity, settings, text);
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
    if (reuseOnly && recovery) {
      const recovered = acceptedTake(recovery, text),
        receipt = {
          key,
          audio_sha256: hash(recovered.bytes),
          words: recovered.words,
          alignment: recovered.alignment,
          origin: recovered.origin,
        };
      signal?.throwIfAborted();
      await cacheTake(cache, key, recovered.bytes, receipt, signal);
      return { ...validate(recovered.bytes, receipt), cached: true };
    }
    if (reuseOnly)
      throw new Error(
        'An unchanged accepted take is unavailable or corrupt in its cache; restore it before preparing changed speech.',
        { cause: error },
      );
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
    await cacheTake(cache, key, bytes, receipt, signal);
    return { ...audio, cached: false };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
