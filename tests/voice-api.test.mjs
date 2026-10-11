import test from 'node:test';
import assert from 'node:assert/strict';
import {
  synthesizeElevenLabs,
  elevenLabsWords,
} from '../skills/visual-explainer/references/elevenlabs-voice-adapter.mjs';

const text = 'Да, вот.';
// Deliberately uneven measured timestamps from a protocol fixture, not generated speech.
const alignment = {
  characters: [...text],
  character_start_times_seconds: [0.1, 0.18, 0.3, 0.35, 0.42, 0.55, 0.68, 0.83],
  character_end_times_seconds: [0.18, 0.3, 0.34, 0.4, 0.55, 0.68, 0.83, 0.9],
};
const request = {
  version: 1,
  provider: 'api',
  text,
  voice: 'selectedVoice',
  model: 'eleven_multilingual_v2',
  language: 'ru-RU',
};
const key = 'test-only-credential';
const pcm = Buffer.alloc(24000 * 2, 1);
const response = () => ({
  ok: true,
  json: async () => ({ audio_base64: pcm.toString('base64'), alignment }),
});

test('reference API adapter preserves provider timestamps and selected voice/model in a real PCM WAV', async () => {
  const calls = [];
  const result = await synthesizeElevenLabs(request, {
    apiKey: key,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response();
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://api.elevenlabs.io/v1/text-to-speech/selectedVoice/with-timestamps?output_format=pcm_24000',
  );
  assert.equal(calls[0].options.headers['xi-api-key'], key);
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].options.body), { text, model_id: request.model });
  assert.deepEqual(result.words, [
    { text: 'Да,', start: 0.1, end: 0.34 },
    { text: 'вот.', start: 0.42, end: 0.9 },
  ]);
  assert.equal(result.wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(result.wav.readUInt32LE(4), result.wav.length - 8);
  assert.equal(result.wav.readUInt16LE(20), 1);
  assert.equal(result.wav.readUInt16LE(22), 1);
  assert.equal(result.wav.readUInt32LE(24), 24000);
  assert.equal(result.wav.readUInt16LE(34), 16);
  assert.deepEqual(result.wav.subarray(44), pcm);
  assert.equal(result.alignment.method, 'elevenlabs-character-timestamps');
  await synthesizeElevenLabs(
    { ...request, model: 'eleven_flash_v2_5' },
    {
      apiKey: key,
      fetchImpl: async (_, options) => {
        assert.equal(JSON.parse(options.body).language_code, 'ru');
        return response();
      },
    },
  );
});

test('API connection never invents alignment, retries a paid request, or prints provider error contents', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error(key + ' ' + text);
  };
  await assert.rejects(synthesizeElevenLabs(request, { apiKey: '', fetchImpl }), /API_KEY_MISSING/);
  assert.equal(calls, 0);
  await assert.rejects(synthesizeElevenLabs(request, { apiKey: key, fetchImpl }), (error) => {
    assert.equal(error.message, 'ELEVENLABS_REQUEST_FAILED_OR_CANCELLED');
    return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(
    synthesizeElevenLabs(request, {
      apiKey: key,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: () => {
          throw new Error(key);
        },
      }),
    }),
    /ELEVENLABS_HTTP_401/,
  );
  for (const invalid of [
    undefined,
    { ...alignment, characters: [...'Нет.'] },
    { ...alignment, character_end_times_seconds: [0.18, 0.3, 0.34, 0.4, 0.55, 0.68, 0.83, 2] },
    { ...alignment, character_start_times_seconds: [0.1, 0.18, 0.3, 0.35, 0.2, 0.55, 0.68, 0.83] },
  ])
    assert.throws(() => elevenLabsWords(text, invalid, 1), /ALIGNMENT|TIMING/);
  await assert.rejects(
    synthesizeElevenLabs(request, {
      apiKey: key,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ audio_base64: 'corrupt', alignment }),
      }),
    }),
    /PCM_INVALID/,
  );
});
