import { readFile, writeFile, mkdir, mkdtemp, lstat, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { dataDirectory } from '../storage.mjs';
import { voiceDigest, voiceBytesDigest as hash } from './receipt.mjs';
import { masterAdapterAudio, currentMastering } from './mastering.mjs';
import {
  spokenWords as tokens,
  spokenText as spoken,
  spokenSpan,
} from '../../dist/story/spoken-words.js';
import { validateAdapterSettings, adapterInput, adapterSelection } from './adapter-input.mjs';
import { readWav, wav, markers, take, rebindCachedTake } from './adapter-take.mjs';
import { validateSpeechConditions } from '../../dist/story/speech-condition.js';
const format = 'voice-adapter-v1';
const maybeJSON = async (file) =>
  readFile(file, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });

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
    if (segment.conditions !== undefined) validateSpeechConditions(segment.conditions);
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
    if (
      segment.delivery !== undefined ||
      segment.seed !== undefined ||
      /<\|[^>]*\|>/.test(segment.text)
    )
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
    const lexical = words.flatMap((word) => tokens(word.text));
    for (const cue of segment.cues ?? []) {
      const { at, length } = quoteIndex(lexical, cue);
      const span = spokenSpan(words, at, length);
      if (!span)
        throw new Error(`Narration cue ${cue.id} needs measured word or phrase endpoints.`);
      cues[cue.id] = {
        text: cue.quote,
        ...span,
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

/** Rebind explicit source units locally, preserving every accepted take and audio byte. */
export async function bindAdapterRecording(
  directory,
  sourceFile,
  settings,
  { signal, cache = join(dataDirectory(), 'speech'), previousAdapter } = {},
) {
  const current = await inputs(directory, sourceFile, validateAdapterSettings(settings));
  const previous = await maybeJSON(join(directory, 'timeline.json'));
  if (
    !previous ||
    previous.digest_format !== format ||
    voiceDigest(previous.voice_settings) !== voiceDigest(adapterSelection(settings)) ||
    previous.synthesis?.adapter_sha256 !==
      (previousAdapter?.accepted ?? current.backend.identity) ||
    (previousAdapter && previousAdapter.current !== current.backend.identity)
  )
    throw new Error(
      'The accepted voice provider or adapter differs; migration cannot synthesize a replacement.',
    );
  const bytes = await readFile(join(directory, 'audio.wav'));
  if (
    hash(bytes) !== previous.audio_sha256 ||
    previous.segments.length !== current.spec.segments.length ||
    previous.segments.some(
      (unit, index) =>
        unit.id !== current.spec.segments[index].id ||
        unit.text !== spoken(current.spec.segments[index].text),
    )
  )
    throw new Error('Migration would change an accepted performance.');
  const next = {
    ...previous,
    source_sha256: current.identity.source,
    authored_source_sha256: current.identity.authored,
    synthesis: { ...previous.synthesis, adapter_sha256: current.backend.identity },
    segments: previous.segments.map((unit, index) => ({
      ...unit,
      conditions: structuredClone(current.spec.segments[index].conditions),
      title: current.spec.segments[index].title,
    })),
    cues: cueRecords(current.spec, previous.segments),
    captionAliases: current.spec.captionAliases,
  };
  if (previousAdapter)
    for (const unit of next.segments)
      await rebindCachedTake(
        cache,
        previousAdapter.accepted,
        current.backend.identity,
        settings,
        unit.text,
        signal,
      );
  await checkAdapterNarration(directory, sourceFile, next, settings);
  signal?.throwIfAborted();
  const staging = await mkdtemp(join(dirname(resolve(directory)), '.voice-binding-'));
  let preserve = false;
  try {
    await writeFile(join(staging, 'audio.wav'), bytes);
    await writeFile(join(staging, 'timeline.json'), JSON.stringify(next, null, 2) + '\n');
    if (
      voiceDigest(await maybeJSON(join(directory, 'timeline.json'))) !== voiceDigest(previous) ||
      hash(await readFile(join(directory, 'audio.wav'))) !== hash(bytes)
    )
      throw new Error('The accepted recording changed during migration.');
    await publish(directory, staging, signal);
  } catch (error) {
    preserve = error.preserveNarrationStaging === true;
    throw error;
  } finally {
    if (!preserve) await rm(staging, { recursive: true, force: true });
  }
  return next;
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
  let acceptedWave;
  const acceptedProvider =
    accepted?.synthesis?.adapter_sha256 === backend.identity &&
    voiceDigest(accepted.voice_settings) === voiceDigest(adapterSelection(config));
  if (acceptedProvider) {
    const bytes = await readFile(join(directory, 'audio.wav'));
    if (hash(bytes) !== accepted.audio_sha256)
      throw new Error('Accepted narration audio differs from its receipt.');
    acceptedWave = readWav(bytes);
    const { cueSheet } = await import('../../dist/story/cues.js');
    cueSheet(accepted);
  }
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
    const previousUnit =
      acceptedProvider &&
      accepted.segments?.find((unit) => unit.id === segment.id && unit.text === text);
    const clip = await take(
      directory,
      backend,
      config,
      text,
      cache,
      signal,
      managedProcessGroup,
      Boolean(previousUnit),
      previousUnit && {
        wave: acceptedWave,
        unit: previousUnit,
        gainDB: accepted.mix?.mastering?.gain_db,
        alignment: accepted.alignment?.segments?.find((unit) => unit.id === segment.id),
        recordingSHA: accepted.audio_sha256,
      },
    );
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
      ...(segment.conditions !== undefined && { conditions: structuredClone(segment.conditions) }),
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
    voice_settings: adapterSelection(config),
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
    voiceDigest(receipt.voice_settings) !== voiceDigest(adapterSelection(config)) ||
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
      voiceDigest(record.conditions ?? null) !== voiceDigest(segment.conditions ?? null) ||
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
