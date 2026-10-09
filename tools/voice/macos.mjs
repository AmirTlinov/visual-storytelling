import { readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const binary = fileURLToPath(new URL('../../dist/voice/macos', import.meta.url));
export const voiceDigest = (value) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, v[k]]),
            )
          : v,
      ),
    )
    .digest('hex');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const tokens = (text) =>
  text
    .toLocaleLowerCase()
    .replaceAll('ё', 'е')
    .match(/[\p{L}\p{N}]+(?:[-‑][\p{L}\p{N}]+)*/gu) ?? [];

export const macosVoice = {
  id: 'macos',
  async doctor({ signal } = {}) {
    if (process.platform !== 'darwin') return { ready: false, voices: [], reason: 'Нужна macOS.' };
    try {
      const { stdout } = await execute(binary, ['--voices'], { signal, timeout: 15000 });
      return {
        ready: true,
        voices: JSON.parse(stdout),
        identity: hash(await readFile(binary)) + ':' + release(),
      };
    } catch (error) {
      signal?.throwIfAborted();
      return { ready: false, voices: [], reason: 'Системная озвучка недоступна: ' + error.message };
    }
  },
  async prepare(settings, task) {
    const status = await this.doctor(task);
    if (!status.ready) throw new Error(status.reason);
    const voice =
      status.voices.find((v) => v.id === settings.voice) ??
      (!settings.voice &&
        status.voices
          .filter((v) => v.language === (settings.language ?? 'ru-RU'))
          .sort((a, b) => b.quality - a.quality)[0]);
    if (!voice)
      throw new Error(
        'Выбранный голос отсутствует. Выберите другой доступный голос в чате.',
      );
    return { ...voice, identity: status.identity, rate: settings.rate ?? 0.5 };
  },
  async synthesize(text, voice, cache, { signal }) {
    const key = voiceDigest({ text, voice }),
      target = join(cache, key);
    try {
      const metadata = JSON.parse(await readFile(join(target, 'take.json'), 'utf8'));
      const pcm = await readFile(join(target, 'audio.raw'));
      if (metadata.digest === hash(pcm)) return { ...metadata, pcm, cached: true };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await mkdir(cache, { recursive: true });
    const staging = await mkdtemp(target + '.preparing-');
    try {
      const output = join(staging, 'audio.raw');
      const metadata = await new Promise((resolve, reject) => {
        const child = execFile(
          binary,
          [],
          { signal, timeout: 180000, maxBuffer: 2_000_000 },
          (error, stdout) => {
            if (error) reject(error);
            else {
              try {
                resolve(JSON.parse(stdout));
              } catch (e) {
                reject(e);
              }
            }
          },
        );
        child.stdin.end(JSON.stringify({ text, voice: voice.id, rate: voice.rate, output }));
      });
      const pcm = await readFile(output);
      if (
        !metadata.markers?.length ||
        metadata.frames * 4 !== pcm.length ||
        metadata.channels !== 1
      )
        throw new Error('Голос не вернул согласованную дорожку и метки слов.');
      metadata.digest = hash(pcm);
      await writeFile(join(staging, 'take.json'), JSON.stringify(metadata));
      signal?.throwIfAborted();
      await rm(target, { force: true, recursive: true });
      await rename(staging, target);
      return { ...metadata, pcm, cached: false };
    } finally {
      await rm(staging, { force: true, recursive: true });
    }
  },
};

function wav(parts, sampleRate) {
  const audio = Buffer.concat(parts),
    header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(audio.length + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(audio.length, 40);
  return Buffer.concat([header, audio]);
}

/** System speech produces the same audio/timeline contract consumed by story, player and export. */
export async function systemNarration(
  directory,
  source,
  settings,
  { signal, progress = () => {}, cache } = {},
) {
  cache ??= join(
    process.env.VISUAL_STORY_DATA_DIR ??
      join(homedir(), 'Library/Application Support/Visual Storytelling'),
    'speech',
  );
  const spec = JSON.parse(await readFile(source, 'utf8'));
  if (!Array.isArray(spec.segments) || !spec.segments.length)
    throw new Error('Нужны реплики в narration.json.');
  if (spec.music)
    throw new Error(
      'Системный голос сейчас поддерживает речь без музыкальной дорожки. Выберите music: null в сценарии.',
    );
  const voice = await macosVoice.prepare(settings, { signal }),
    pieces = [],
    segments = [],
    cues = {},
    ids = new Set();
  let cursor = 0,
    sampleRate,
    cached = 0;
  const silence = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30)
      throw new Error('Паузы должны быть от 0 до 30 секунд.');
    const frames = Math.round(seconds * sampleRate);
    pieces.push(Buffer.alloc(frames * 2));
    cursor += frames;
  };
  for (const [index, segment] of spec.segments.entries()) {
    signal?.throwIfAborted();
    if (
      typeof segment.id !== 'string' ||
      ids.has(segment.id) ||
      typeof segment.text !== 'string' ||
      !segment.text.trim()
    )
      throw new Error('Каждой реплике нужны уникальный id и текст.');
    ids.add(segment.id);
    const text = segment.text.replace(/<\|[a-z]+:[a-z_]+\|>/g, '').trim();
    progress('Озвучиваю: ' + (segment.title ?? segment.id), {
      done: index,
      total: spec.segments.length,
    });
    const take = await macosVoice.synthesize(text, voice, cache, { signal });
    if (!sampleRate) {
      sampleRate = take.sampleRate;
      silence(spec.intro ?? 0.4);
    }
    if (sampleRate !== take.sampleRate)
      throw new Error('Голос изменил формат звука во время подготовки. Повторите озвучку.');
    cached += Number(take.cached);
    const start = cursor / sampleRate,
      duration = take.frames / sampleRate;
    // Equal native offsets describe one spoken group. Preserve that precision
    // for captions and cues; inventing separate word times would desynchronize them.
    const groups = [];
    for (const marker of take.markers) {
      if (!tokens(marker.text).length) continue;
      if (groups.at(-1)?.offset === marker.offset) groups.at(-1).text += ' ' + marker.text.trim();
      else groups.push({ offset: marker.offset, text: marker.text.trim() });
    }
    const words = groups.map((marker, i) => ({
      text: marker.text,
      start: start + marker.offset / (sampleRate * 4),
      end: start + (groups[i + 1]?.offset / (sampleRate * 4) || duration),
    }));
    const lexical = words.flatMap((word, index) =>
      tokens(word.text).map((text) => ({ text, index })),
    );
    if (
      words.some(
        (word) =>
          word.end <= word.start || word.start < start || word.end > start + duration + 0.001,
      )
    )
      throw new Error('Системные метки слов не соответствуют дорожке.');
    segments.push({
      id: segment.id,
      title: segment.title,
      text,
      start: words[0].start,
      end: words.at(-1).end,
      audio_start: start,
      audio_end: start + duration,
      words,
    });
    cues[segment.id] = { text, start: words[0].start, end: words.at(-1).end };
    for (const cue of segment.cues ?? []) {
      if (typeof cue.id !== 'string' || ids.has(cue.id))
        throw new Error('Метки сценария должны иметь уникальные id.');
      ids.add(cue.id);
      const quote = tokens(cue.quote ?? ''),
        matches = lexical.flatMap((_, i) =>
          quote.length && quote.every((word, j) => lexical[i + j]?.text === word) ? [i] : [],
        );
      const at = matches[(cue.occurrence ?? 1) - 1];
      if (at === undefined || (matches.length > 1 && !cue.occurrence))
        throw new Error(`Метка ${cue.id}: уточните quote и occurrence в сценарии.`);
      cues[cue.id] = {
        text: cue.quote,
        start: words[lexical[at].index].start,
        end: words[lexical[at + quote.length - 1].index].end,
        ...(cue.action ? { action: cue.action } : {}),
        ...(cue.hold ? { hold: cue.hold } : {}),
        ...(cue.timing !== undefined ? { timing: structuredClone(cue.timing) } : {}),
      };
    }
    const pcm = Buffer.alloc(take.frames * 2);
    for (let i = 0; i < take.frames; i++)
      pcm.writeInt16LE(
        Math.round(Math.max(-1, Math.min(1, take.pcm.readFloatLE(i * 4))) * 32767),
        i * 2,
      );
    pieces.push(pcm);
    cursor += take.frames;
    silence(segment.pause_after ?? 0);
  }
  silence(spec.outro ?? 0.4);
  const timeline = {
    version: 1,
    sample_rate: sampleRate,
    duration: cursor / sampleRate,
    source_sha256: voiceDigest(spec),
    digest_format: 'canonical-json-v1',
    audio: 'audio.wav',
    voice: 'audio.wav',
    music: null,
    segments,
    cues,
    captionAliases: spec.captionAliases,
    voice_settings: settings,
    synthesis: { provider: 'macos', voice: voice.id, identity: voice.identity },
    alignment: { method: 'native-word-markers' },
  };
  const { cueSheet } = await import('../../dist/story/cues.js');
  cueSheet(timeline);
  signal?.throwIfAborted();
  await writeFile(join(directory, 'audio.wav'), wav(pieces, sampleRate));
  await writeFile(join(directory, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
  return { duration: timeline.duration, cached, segments: segments.length, voice: voice.id };
}
