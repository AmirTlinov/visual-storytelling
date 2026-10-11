// Copy to the project's voice/adapter.mjs. Secrets stay in the runtime environment.
// API: https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sampleRate = 24000;

function fail(code) {
  const error = new Error(code);
  error.adapterCode = code;
  throw error;
}

export function elevenLabsWords(text, alignment, durationSeconds) {
  if (typeof text !== 'string' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    fail('ELEVENLABS_ALIGNMENT_INVALID');
  }
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends) ||
      !chars.length || starts.length !== chars.length || ends.length !== chars.length) {
    fail('ELEVENLABS_ALIGNMENT_MISSING');
  }
  const words = [];
  let word;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i], start = starts[i], end = ends[i];
    if (typeof char !== 'string' || !char.length || /\s\S|\S\s/u.test(char) ||
        !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start ||
        end > durationSeconds || (i && (start < starts[i - 1] || end < ends[i - 1]))) {
      fail('ELEVENLABS_ALIGNMENT_INVALID');
    }
    if (/^\s+$/u.test(char)) {
      if (word) words.push(word);
      word = undefined;
    } else if (word) {
      word.text += char;
      word.end = end;
    } else {
      word = { text: char, start, end };
    }
  }
  if (word) words.push(word);
  const compact = value => value.trim().replace(/\s+/gu, ' ');
  if (compact(chars.join('')) !== compact(text)) fail('ELEVENLABS_ALIGNMENT_TEXT_MISMATCH');
  if (!words.length || words.some((item, i) => item.end <= item.start ||
      (i > 0 && item.start < words[i - 1].end))) fail('ELEVENLABS_WORD_TIMING_INVALID');
  return words;
}

function pcmWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
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

export async function synthesizeElevenLabs(request, {
  apiKey = process.env.ELEVENLABS_API_KEY,
  fetchImpl = globalThis.fetch,
  signal = AbortSignal.timeout(150000),
} = {}) {
  if (request?.version !== 1 || request.provider !== 'api' ||
      typeof request.text !== 'string' || !request.text.trim() ||
      typeof request.model !== 'string' || !request.model.trim() ||
      typeof request.voice !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(request.voice) ||
      typeof request.language !== 'string' || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*$/.test(request.language)) {
    fail('VOICE_ADAPTER_INPUT_INVALID');
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) fail('ELEVENLABS_API_KEY_MISSING');
  const body = { text: request.text, model_id: request.model };
  // Eleven Multilingual v2 does not support language_code (see API documentation).
  if (request.model !== 'eleven_multilingual_v2') body.language_code = request.language.split('-')[0].toLowerCase();
  let response;
  try {
    response = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.voice)}/with-timestamps?output_format=pcm_24000`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      },
    );
  } catch {
    fail('ELEVENLABS_REQUEST_FAILED_OR_CANCELLED');
  }
  if (!response.ok) fail(`ELEVENLABS_HTTP_${Number(response.status) || 'ERROR'}`);
  let data;
  try { data = await response.json(); } catch { fail('ELEVENLABS_RESPONSE_INVALID'); }
  if (typeof data?.audio_base64 !== 'string' || !data.audio_base64.length) fail('ELEVENLABS_AUDIO_MISSING');
  const pcm = Buffer.from(data.audio_base64, 'base64');
  if (!pcm.length || pcm.length % 2 || pcm.toString('base64') !== data.audio_base64) {
    fail('ELEVENLABS_PCM_INVALID');
  }
  const words = elevenLabsWords(request.text, data.alignment, pcm.length / (sampleRate * 2));
  return { wav: pcmWav(pcm), words, alignment: { method: 'elevenlabs-character-timestamps' } };
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 1024 * 1024) fail('VOICE_ADAPTER_INPUT_TOO_LARGE');
  }
  const request = JSON.parse(input);
  if (typeof request.outputDirectory !== 'string' || !isAbsolute(request.outputDirectory)) {
    fail('VOICE_ADAPTER_OUTPUT_INVALID');
  }
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  try {
    const { wav, ...result } = await synthesizeElevenLabs(request, {
      signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(150000)]),
    });
    cancellation.signal.throwIfAborted();
    await writeFile(join(request.outputDirectory, 'take.wav'), wav, { flag: 'wx' });
    cancellation.signal.throwIfAborted();
    process.stdout.write(JSON.stringify(result));
  } finally {
    process.off('SIGTERM', cancel);
    process.off('SIGINT', cancel);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Never forward fetch errors, response bodies, request text or credentials.
    process.stderr.write(`${error.adapterCode ?? 'VOICE_ADAPTER_FAILED'}\n`);
    process.exitCode = 1;
  });
}
