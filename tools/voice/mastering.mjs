import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import profile from '../audio/mastering.json' with { type: 'json' };

const execute = promisify(execFile);
const profileBytes = JSON.stringify(profile, Object.keys(profile).sort());
export const masteringProfile = profile;
export const masteringProfileHash = createHash('sha256').update(profileBytes).digest('hex');
export const currentMastering = (receipt) =>
  receipt.mix?.mastering?.profile_sha256 === masteringProfileHash && Boolean(receipt.audio_sha256);

async function measure(file, signal) {
  const { integrated_lufs: target, true_peak_dbtp: ceiling } = masteringProfile;
  const { stderr } = await execute(
    'ffmpeg',
    [
      '-nostdin',
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      `loudnorm=I=${target}:TP=${ceiling}:LRA=50:dual_mono=true:print_format=json`,
      '-f',
      'null',
      '-',
    ],
    { signal, maxBuffer: 2_000_000 },
  );
  const start = stderr.lastIndexOf('{'),
    end = stderr.indexOf('}', start);
  if (start < 0 || end < start) throw new Error('FFmpeg did not report narration loudness.');
  const values = JSON.parse(stderr.slice(start, end + 1));
  const number = (key) => (Number.isFinite(Number(values[key])) ? Number(values[key]) : null);
  return { integrated_lufs: number('input_i'), true_peak_dbtp: number('input_tp') };
}

/** Gain-only mastering of an already validated mono PCM16 WAV, including its unchanged header. */
export async function masterAdapterAudio(bytes, wave, { signal } = {}) {
  signal?.throwIfAborted();
  let peak = 0;
  for (let i = 0; i < wave.pcm.length; i += 2)
    peak = Math.max(peak, Math.abs(wave.pcm.readInt16LE(i)) / 32768);
  if (!peak) throw new Error('Narration audio must be non-empty and non-silent.');
  const directory = await mkdtemp(join(tmpdir(), 'voice-master-'));
  try {
    const file = join(directory, 'audio.wav');
    await writeFile(file, bytes);
    const before = await measure(file, signal);
    let squared = 0,
      count = 0;
    for (let i = 0; i < wave.pcm.length; i += 2) {
      const value = wave.pcm.readInt16LE(i) / 32768;
      if (Math.abs(value) > peak * masteringProfile.active_peak_ratio) {
        squared += value * value;
        count++;
      }
    }
    const loudness = before.integrated_lufs;
    const desired =
      loudness === null
        ? masteringProfile.short_rms_dbfs - 20 * Math.log10(Math.sqrt(squared / count))
        : masteringProfile.integrated_lufs - loudness;
    const truePeak = Math.max(before.true_peak_dbtp ?? -999, 20 * Math.log10(peak));
    const gainDB = Math.min(desired, masteringProfile.true_peak_dbtp - 0.02 - truePeak);
    const gain = 10 ** (gainDB / 20);
    if (!Number.isFinite(gain) || gain <= 0)
      throw new Error('Narration mastering gain is invalid.');
    const audio = Buffer.from(bytes),
      offset = wave.pcm.byteOffset - bytes.byteOffset;
    let nonzero = false;
    for (let i = 0; i < wave.pcm.length; i += 2) {
      const value = Math.round(wave.pcm.readInt16LE(i) * gain);
      if (value < -32768 || value > 32767)
        throw new Error('Narration mastering would clip a PCM sample.');
      audio.writeInt16LE(value, offset + i);
      nonzero ||= value !== 0;
    }
    if (!nonzero) throw new Error('Mastered narration is silent.');
    await writeFile(file, audio);
    const after = await measure(file, signal);
    if (
      after.true_peak_dbtp !== null &&
      after.true_peak_dbtp > masteringProfile.true_peak_dbtp + 0.01
    )
      throw new Error('Mastered narration exceeds its true-peak ceiling.');
    return {
      audio,
      mastering: {
        profile_sha256: masteringProfileHash,
        version: masteringProfile.version,
        method: loudness === null ? 'short-rms' : 'integrated-lufs',
        gain_db: Number(gainDB.toFixed(6)),
        peak_limited: gainDB < desired - 0.03,
        ...after,
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
