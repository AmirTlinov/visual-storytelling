import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { nativeHelper } from './native.mjs';

const run = promisify(execFile);
export async function doctor() {
  const browser = await access(chromium.executablePath()).then(
    () => ({ available: true }),
    () => ({
      available: false,
      fix: 'Run npx playwright install chromium in the library directory.',
    }),
  );
  const ffmpeg = await run('ffmpeg', ['-version'], { timeout: 5000 }).then(
    () => ({ available: true }),
    () => ({
      available: false,
      fix: 'Install FFmpeg to inspect video or native window recordings. Browser and PNG analysis work without it.',
    }),
  );
  let window = {
    available: false,
    reason: 'Direct capture supports macOS 15+; use video or PNG input on other systems.',
  };
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run(await nativeHelper(), ['status'], { timeout: 10000 });
      window = JSON.parse(stdout);
    } catch (error) {
      window = { available: false, reason: error.message };
    }
  }
  return {
    node: process.version,
    browser,
    video: ffmpeg,
    window,
    notes: [
      'Window permission is checked without opening a permission prompt.',
      'Capture reports preserve source timestamps; display FPS needs platform presentation telemetry.',
    ],
  };
}
