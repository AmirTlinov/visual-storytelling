import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { reviewMotion } from './review.mjs';
import { parseCrop } from './frames.mjs';

const help = `Motion review — capture, inspect, repeat

visual-story review URL --click 'text=Open' --target '#panel' --out REPORT
visual-story review ./page.html --capture --click '#start' --seconds 2 --out REPORT
visual-story review URL --scenario flow.json --out REPORT
visual-story review REPORT/replay.json --motion --baseline REPORT --out AFTER
visual-story review recording.mp4 --motion --from 1.2 --frames 16 --out REPORT
visual-story review recording.mp4 --motion --from 1.2 --seconds 3 --out REPORT
visual-story review scene-dir --motion --cue ACTION --out REPORT
visual-story review frames.json --motion --out REPORT
visual-story review --windows
visual-story review --window ID --seconds 3 --out REPORT

Open the returned image (motion.png). index.html plays saved frames; motion.json
contains observations. Browser reports also save replay.json and capture/frames.json.

Capture: --capture (ordinary HTML), --scenario FILE, --click SELECTOR (repeatable),
  --target CSS (repeatable, up to 12), --seconds 2 (after actions), --ready SELECTOR,
  --width 960 --height 720, --theme light|dark, --reduced, --headed,
  --cdp ENDPOINT (reuse an existing matching tab, preserve browser and login).
Analysis: --from SECONDS, --frames 12 (2–32), --crop x,y,w,h,
  --max-size 960 (0 = original pixels), --threshold 8, --loop, --baseline REPORT.
Scene only: --cue ID, --fps 60. Recordings retain their timestamps.
--doctor reports dependencies. --out defaults to a fresh artifacts/motion-* directory.

Scenario JSON (paths relative to the scenario file):
{"actions":[{"type":"click","selector":"#open"},{"type":"wait","ms":120},
 {"type":"click","selector":"#close"}],"targets":["#panel"],"seconds":2}
Rapid repeat: {"type":"click","selector":"#button","repeat":2,"intervalMs":120}.
  Read actual clickIntervalsMs; wait ms is a pause between completed steps.
Actions: click, dblclick, hover, fill (value or env), press (key), scroll (x/y),
  drag (selector/to), wait (ms). Select an element using selector or role + name.

For a narrated scene overview: visual-story review SCENE --cue ID --out REPORT
`;

export async function runMotionCLI(args) {
  const started = performance.now();
  try {
    const { values: v, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        motion: { type: 'boolean' },
        out: { type: 'string' },
        capture: { type: 'boolean' },
        scenario: { type: 'string' },
        click: { type: 'string', multiple: true },
        target: { type: 'string', multiple: true },
        seconds: { type: 'string' },
        ready: { type: 'string' },
        width: { type: 'string' },
        height: { type: 'string' },
        theme: { type: 'string' },
        reduced: { type: 'boolean' },
        headed: { type: 'boolean' },
        cdp: { type: 'string' },
        from: { type: 'string' },
        frames: { type: 'string' },
        crop: { type: 'string' },
        'max-size': { type: 'string' },
        threshold: { type: 'string' },
        loop: { type: 'boolean' },
        baseline: { type: 'string' },
        cue: { type: 'string' },
        fps: { type: 'string' },
        windows: { type: 'boolean' },
        window: { type: 'string' },
        doctor: { type: 'boolean' },
      },
    });
    if (v.help) {
      console.log(help);
      return 0;
    }
    if (v.doctor) {
      const { doctor } = await import('./doctor.mjs');
      console.log(JSON.stringify(await doctor(), null, 2));
      return 0;
    }
    if (v.windows) {
      const { listWindows } = await import('./native.mjs');
      console.log(JSON.stringify(await listWindows(), null, 2));
      return 0;
    }
    let scenario;
    if (v.scenario) {
      scenario = JSON.parse(await readFile(v.scenario, 'utf8'));
      if (scenario.url && !/^https?:\/\//.test(scenario.url))
        scenario.url = resolve(dirname(resolve(v.scenario)), scenario.url);
    }
    const input = positionals[0] ?? scenario?.url;
    if (!input && !v.window)
      throw new Error('Provide a URL, scene, HTML, recording or frame manifest');
    if (positionals.length > 1) throw new Error('Use one input per report');
    if (v.theme && !['light', 'dark'].includes(v.theme))
      throw new Error('--theme must be light or dark');
    const numeric = (key) => (v[key] === undefined ? undefined : Number(v[key]));
    let replayInput = false;
    if (input?.endsWith('.json') && !v.scenario) {
      const parsed = JSON.parse(await readFile(input, 'utf8'));
      replayInput = parsed.kind === 'motion-capture';
    }
    const captureRequested =
      replayInput ||
      /^https?:\/\//i.test(input ?? '') ||
      v.ready ||
      v.capture ||
      v.scenario ||
      v.click ||
      v.target ||
      v.cdp ||
      v.headed ||
      v.window;
    const browserFlags =
      v.capture || v.scenario || v.click || v.target || v.cdp || v.headed || v.ready;
    if (!v.window && browserFlags && /\.(mp4|mov|mkv|webm|avi|gif)$/i.test(input ?? ''))
      throw new Error(
        'Browser actions need a URL or HTML. For this recording use --motion --seconds N or --from/--frames.',
      );
    if (v.window && (input || browserFlags))
      throw new Error(
        '--window records one native window; use a separate command for browser actions',
      );
    const overrides = Object.fromEntries(
      Object.entries({
        seconds: numeric('seconds'),
        width: numeric('width'),
        height: numeric('height'),
        theme: v.theme,
        reduced: v.reduced,
        headed: v.headed,
        cdp: v.cdp,
        ready: v.ready,
        targets: v.target,
        window: v.window,
      }).filter(([, value]) => value !== undefined),
    );
    const capture = captureRequested
      ? {
          ...scenario,
          ...overrides,
          ...(v.click
            ? {
                actions: [
                  ...(scenario?.actions ?? []),
                  ...v.click.map((selector) => ({ type: 'click', selector })),
                ],
              }
            : {}),
        }
      : undefined;
    const out = resolve(
      v.out ?? join('artifacts', `motion-${new Date().toISOString().replace(/[:.]/g, '-')}`),
    );
    const result = await reviewMotion({
      input: input ?? '.',
      out,
      capture,
      from: numeric('from'),
      frames: numeric('frames'),
      fps: numeric('fps'),
      crop: parseCrop(v.crop),
      threshold: numeric('threshold'),
      maxSize: numeric('max-size'),
      cue: v.cue,
      width: numeric('width'),
      theme: v.theme,
      reduced: v.reduced,
      baseline: v.baseline,
      loop: v.loop,
      seconds: captureRequested ? undefined : numeric('seconds'),
    });
    console.log(JSON.stringify(result, null, 2));
    return result.insights?.some((entry) => entry.kind === 'action-error') ? 2 : 0;
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          error: error.message,
          help: 'visual-story review --help',
          elapsedMs: Math.round(performance.now() - started),
        },
        null,
        2,
      ),
    );
    return 1;
  }
}
