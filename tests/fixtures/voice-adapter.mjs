// Test transport only: deterministic tones mark whole phrases; this does not synthesize speech.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
assert.equal(request.version, 1);
assert.ok(['local', 'api'].includes(request.provider));
assert.equal(typeof request.text, 'string');
assert.equal(typeof request.outputDirectory, 'string');

const phrases = request.text
  .match(/[^.!?]+[.!?]*/gu)
  ?.map((text) => text.trim())
  .filter(Boolean);
assert.ok(phrases?.length);
const sampleRate = 8000;
const phraseFrames = 2 * sampleRate;
const gapFrames = sampleRate / 10;
const frames = phrases.length * (phraseFrames + gapFrames) + gapFrames;
const wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF');
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(wav.length - 44, 40);

const words = phrases.map((text, index) => {
  const startFrame = gapFrames + index * (phraseFrames + gapFrames);
  const frequency = 220 + ([...text].reduce((sum, char) => sum + char.codePointAt(0), 0) % 220);
  for (let frame = 0; frame < phraseFrames; frame++) {
    // The short ramp avoids a click; marker bounds are the exact generated tone interval.
    const envelope = Math.min(1, frame / 80, (phraseFrames - 1 - frame) / 80);
    const sample = Math.round(
      1600 * envelope * Math.sin((2 * Math.PI * frequency * frame) / sampleRate),
    );
    wav.writeInt16LE(sample, 44 + 2 * (startFrame + frame));
  }
  return { text, start: startFrame / sampleRate, end: (startFrame + phraseFrames) / sampleRate };
});
await mkdir(request.outputDirectory, { recursive: true });
await writeFile(join(request.outputDirectory, 'take.wav'), wav);
process.stdout.write(JSON.stringify({ words, alignment: { method: 'test-fixture-phrase-tones' } }));
