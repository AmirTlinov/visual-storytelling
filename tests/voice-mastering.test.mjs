import test from 'node:test';
import assert from 'node:assert/strict';
import { masterAdapterAudio } from '../tools/voice/mastering.mjs';

function recording(amplitude, seconds = 3, highPeak = false) {
  const sampleRate = 24000,
    frames = Math.round(seconds * sampleRate);
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 100; i < frames - 100; i++)
    bytes.writeInt16LE(
      Math.round(32768 * amplitude * Math.sin((2 * Math.PI * 330 * i) / sampleRate)),
      44 + i * 2,
    );
  if (highPeak) bytes.writeInt16LE(30000, 44 + 500 * 2);
  return { bytes, wave: { pcm: bytes.subarray(44), sampleRate, frames, duration: seconds } };
}

test('adapter PCM mastering is level-invariant, sample-exact and does not alter provider takes', async () => {
  for (const amplitude of [0.008, 0.08, 0.8]) {
    const { bytes, wave } = recording(amplitude),
      original = Buffer.from(bytes);
    const { audio, mastering } = await masterAdapterAudio(bytes, wave);
    assert.deepEqual(bytes, original);
    assert.deepEqual(audio.subarray(0, 44), bytes.subarray(0, 44));
    assert.equal(audio.length, bytes.length);
    assert(Math.abs(mastering.integrated_lufs + 16) < 0.15);
    assert(mastering.true_peak_dbtp <= -1.5);
    const gain = 10 ** (mastering.gain_db / 20);
    for (let i = 0; i < wave.pcm.length; i += 2)
      assert(Math.abs(audio.readInt16LE(44 + i) - wave.pcm.readInt16LE(i) * gain) < 1.1);
  }
});

test('short and high-crest adapter audio use bounded static gain; silence and cancellation fail', async () => {
  const short = recording(0.008, 0.2);
  const tiny = await masterAdapterAudio(short.bytes, short.wave);
  assert.equal(tiny.mastering.method, 'short-rms');
  assert.equal(tiny.mastering.integrated_lufs, null);
  const peaked = recording(0.008, 3, true);
  const limited = await masterAdapterAudio(peaked.bytes, peaked.wave);
  assert.equal(limited.mastering.peak_limited, true);
  assert(limited.mastering.true_peak_dbtp <= -1.5);
  const silent = recording(0);
  await assert.rejects(masterAdapterAudio(silent.bytes, silent.wave), /non-silent/);
  const abort = new AbortController();
  abort.abort(new Error('cancelled'));
  await assert.rejects(
    masterAdapterAudio(short.bytes, short.wave, { signal: abort.signal }),
    /cancelled/,
  );
});
