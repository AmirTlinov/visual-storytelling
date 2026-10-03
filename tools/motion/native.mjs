import { access, mkdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { videoFrames, saveCapture } from './media.mjs';

const run = promisify(execFile);
export async function nativeHelper() {
  if (process.platform !== 'darwin')
    throw new Error(
      'Direct window capture requires macOS 15+. On this system, pass a screen recording or PNG manifest.',
    );
  const source = fileURLToPath(new URL('./capture-window.swift', import.meta.url));
  const hash = createHash('sha256')
    .update(await readFile(source))
    .update(process.arch)
    .digest('hex')
    .slice(0, 16);
  const folder = join(tmpdir(), 'visual-story-motion-native');
  const binary = join(folder, `capture-${hash}`);
  try {
    await access(binary);
  } catch {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    try {
      await run('xcrun', ['swiftc', '-parse-as-library', '-O', source, '-o', binary], {
        timeout: 60000,
      });
    } catch (error) {
      throw new Error(
        `Cannot build the window recorder. Install Xcode Command Line Tools, or supply a recording. ${error.stderr ?? error.message}`,
      );
    }
  }
  return binary;
}

export async function listWindows() {
  const { stdout } = await run(await nativeHelper(), ['list'], { timeout: 10000 });
  return JSON.parse(stdout);
}

export async function captureWindow({ window: id, seconds = 2 }, out) {
  if (!/^\d+$/.test(String(id)) || !Number.isFinite(seconds) || seconds < 0.1 || seconds > 15)
    throw new Error('Choose --window ID from --windows, and --seconds between 0.1 and 15');
  await mkdir(out, { recursive: true });
  const video = join(out, 'recording.mp4');
  const { stdout } = await run(await nativeHelper(), [String(id), String(seconds), video], {
    timeout: (seconds + 15) * 1000,
  });
  const recording = JSON.parse(stdout);
  const samples = await videoFrames(video, 0, 600);
  const source = {
    kind: 'window-capture',
    path: video,
    app: recording.app,
    windowID: Number(id),
    viewport: { width: recording.width, height: recording.height },
    clock: 'ScreenCaptureKit recording PTS',
    ...(samples.length === 600
      ? { warning: 'The analysis reached 600 frames; use a shorter recording for full coverage.' }
      : {}),
  };
  const captureManifest = await saveCapture(samples, source, out);
  return { samples, source, captureManifest };
}
