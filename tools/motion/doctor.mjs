import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { nativeHelper } from './native.mjs';

const run = promisify(execFile);
export const offlineReviewHint =
  'Analyze saved files here: visual-story review frames.json --motion --out REPORT, or recording.mp4 with FFmpeg. HTML, JSON and analysis/*.png remain available when Chromium previews are unavailable.';

/** Retain the startup cause without flooding an agent with process logs. */
export function startupFailureReason(error) {
  const lines = String(error?.message ?? error)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const cause =
    lines.find((line) => /EPERM|EACCES|operation not permitted|permission denied/i.test(line)) ??
    lines.find((line) =>
      /executable doesn't exist|missing dependencies|missing libraries|error while loading shared libraries|timeout \d+ms exceeded/i.test(
        line,
      ),
    ) ??
    lines[0] ??
    'Chromium could not launch';
  const reason = cause.replace(/^browserType\.launch:\s*|^\[pid=\d+\]\[err\]\s*/g, '');
  return reason.length > 300 ? reason.slice(0, 299) + '…' : reason;
}

async function probeBrowser() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: 5000 });
    return { available: true };
  } catch (error) {
    return { available: false, reason: startupFailureReason(error) };
  } finally {
    await browser?.close();
  }
}

async function probeLocalhost() {
  const server = createServer((socket) => socket.destroy());
  const controller = new AbortController();
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Localhost listen timed out after 1500 ms'));
      }, 1500);
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0, signal: controller.signal }, resolve);
    });
    return { available: true };
  } catch (error) {
    return { available: false, reason: error.message };
  } finally {
    clearTimeout(timer);
    controller.abort();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

async function probeWindow() {
  let window = {
    available: false,
    reason: 'Direct capture supports macOS 15+; use video or PNG input on other systems.',
  };
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await run(await nativeHelper(), ['status'], { timeout: 10000 });
      window = JSON.parse(stdout);
    } catch (error) {
      window = { available: false, reason: startupFailureReason(error) };
    }
  }
  return window;
}

export async function doctor() {
  const [browser, localhost, ffmpeg, window] = await Promise.all([
    probeBrowser(),
    probeLocalhost(),
    run('ffmpeg', ['-version'], { timeout: 5000 }).then(
      () => ({ available: true }),
      () => ({
        available: false,
        fix: 'Install FFmpeg to inspect video or native window recordings. PNG analysis works without it.',
      }),
    ),
    probeWindow(),
  ]);
  return {
    node: process.version,
    browser,
    localhost,
    video: ffmpeg,
    window,
    ...(!browser.available || !localhost.available ? { fallback: offlineReviewHint } : {}),
    notes: [
      'Local HTML and scene capture need both browser and localhost. Remote URLs need Chromium and network access to that URL.',
      'Window permission is checked without opening a permission prompt.',
      'Capture reports preserve source timestamps; display FPS needs platform presentation telemetry.',
    ],
  };
}
