import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { reviewMotion } from './review.mjs';
import { parseCrop } from './frames.mjs';
import { parseSlice } from './photometry.mjs';
import { startupFailureReason, offlineReviewHint } from './doctor.mjs';

const help = `Visual review — one session, full interval, inspect, compare

visual-story review SOURCE --out SESSION
visual-story review scene-dir --cue ACTION --out SESSION
visual-story review URL --click '#open' --out SESSION
visual-story review page.html --capture --scenario flow.json --out SESSION
visual-story review recording.mp4 --from 1 --seconds 30 --out SESSION
visual-story review --windows
visual-story review --window ID --seconds 30 --out SESSION
visual-story review record URL --cdp ENDPOINT --out SESSION
visual-story review record --window ID --out SESSION
visual-story review stop SESSION
visual-story review status SESSION
visual-story review inspect SESSION
visual-story review inspect SESSION --episode ID
visual-story review inspect SESSION --at 2.1 --radius .3 --object ID
visual-story review inspect SESSION --at 2.1 --point 120,80
visual-story review inspect SESSION --episode ID --out DETAIL
visual-story review SESSION/replay.json --baseline SESSION --out AFTER

SOURCE: scene, URL, local HTML (--capture), video, frame manifest or saved session.
A cue selects its entire action with context before/after; --frames controls detail density.
Start with session and index.html: complete episode map, playback, objects and observations.
image is the overview PNG; framesImage and photometryImage contain detailed measurements.
inspect returns existing evidence without repeating an interaction. --search filters episode text; --offset/--limit page the index.
Use --out on inspect to render a focused report; raw capture is reused.
Capture commands print a compact JSON receipt; --verbose includes detailed measurements.
The saved report and inspect always retain the complete evidence.

Capture: --scenario FILE, --click SELECTOR (repeatable), --target CSS (repeatable),
  --seconds 2 (time after actions), --ready SELECTOR, --width 960 --height 720,
  --theme light|dark, --reduced, --headed, --cdp ENDPOINT (existing authenticated tab).
Analysis: --from SECONDS --seconds N (full interval), --episode ID, --at T --radius .3,
  --object ID, --frames 12 (2–32), --crop x,y,w,h, --max-size 960 (0 = native pixels),
  --threshold 8, --loop, --baseline SESSION.
  --slice x,Y,THICKNESS or y,X,THICKNESS selects a kymograph strip in source pixels.
Scene checkpoints describe model states; video retains PTS; sparse CDP is not display FPS.
--doctor checks dependencies. Reports retain evidence if preview rendering is unavailable.

Scenario: {"actions":[{"type":"click","selector":"#open"}],"seconds":2}
Actions: click, dblclick, hover, fill (value or env), press, scroll, drag, wait.
Select by selector or role + name. Repeated click: repeat:2, intervalMs:120.
`;

export async function runMotionCLI(args) {
  const started = performance.now();
  try {
    const { values: v, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
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
        slice: { type: 'string' },
        'max-size': { type: 'string' },
        threshold: { type: 'string' },
        loop: { type: 'boolean' },
        baseline: { type: 'string' },
        cue: { type: 'string' },
        fps: { type: 'string' },
        episode: { type: 'string' },
        at: { type: 'string' },
        radius: { type: 'string' },
        object: { type: 'string' },
        point: { type: 'string' },
        search: { type: 'string' },
        offset: { type: 'string' },
        limit: { type: 'string' },
        windows: { type: 'boolean' },
        window: { type: 'string' },
        doctor: { type: 'boolean' },
        verbose: { type: 'boolean' },
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
    if (['stop', 'status'].includes(positionals[0])) {
      if (positionals.length !== 2) throw new Error('Provide one recording directory');
      const { recordingStatus } = await import('./record.mjs');
      console.log(
        JSON.stringify(await recordingStatus(positionals[1], positionals[0] === 'stop'), null, 2),
      );
      return 0;
    }
    const recording = positionals[0] === 'record';
    if (recording) positionals.shift();
    let scenario;
    if (v.scenario) {
      scenario = JSON.parse(await readFile(v.scenario, 'utf8'));
      if (scenario.url && !/^https?:\/\//.test(scenario.url))
        scenario.url = resolve(dirname(resolve(v.scenario)), scenario.url);
    }
    const inspecting = positionals[0] === 'inspect';
    if (inspecting) positionals.shift();
    const input = positionals[0] ?? scenario?.url;
    if (!input && !v.window)
      throw new Error('Provide a URL, scene, HTML, recording or frame manifest');
    if (positionals.length > 1) throw new Error('Use one input per report');
    if (v.theme && !['light', 'dark'].includes(v.theme))
      throw new Error('--theme must be light or dark');
    const numeric = (key) => (v[key] === undefined ? undefined : Number(v[key]));
    const point = v.point?.split(',').map(Number);
    if (point && (point.length !== 2 || point.some((n) => !Number.isFinite(n))))
      throw new Error('--point needs x,y in source pixels');
    if (inspecting && !v.out) {
      const { inspectSession } = await import('./inspect.mjs');
      console.log(
        JSON.stringify(
          await inspectSession(input, {
            episode: v.episode ?? v.cue,
            at: numeric('at'),
            radius: numeric('radius'),
            object: v.object,
            point,
            from: numeric('from'),
            to: v.seconds === undefined ? undefined : (numeric('from') ?? 0) + numeric('seconds'),
            search: v.search,
            offset: numeric('offset'),
            limit: numeric('limit'),
          }),
          null,
          2,
        ),
      );
      return 0;
    }
    let replayInput = false;
    if (/\.json$/i.test(input ?? '') && !/^https?:\/\//i.test(input) && !v.scenario) {
      const parsed = JSON.parse(await readFile(input, 'utf8'));
      replayInput = parsed.kind === 'motion-capture';
    }
    const captureRequested =
      !inspecting &&
      (replayInput ||
        /^https?:\/\//i.test(input ?? '') ||
        v.ready ||
        v.capture ||
        v.scenario ||
        v.click ||
        v.target ||
        v.cdp ||
        v.headed ||
        v.window);
    const browserFlags =
      v.capture || v.scenario || v.click || v.target || v.cdp || v.headed || v.ready;
    if (!v.window && browserFlags && /\.(mp4|mov|mkv|webm|avi|gif)$/i.test(input ?? ''))
      throw new Error(
        'Browser actions need a URL or HTML. For this recording use --from/--seconds.',
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
          ...(positionals[0] && scenario ? { url: positionals[0] } : {}),
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
    if (recording) {
      if (!captureRequested)
        throw new Error('record needs a browser URL, local HTML with --capture, or --window ID');
      const { startRecording } = await import('./record.mjs');
      console.log(
        JSON.stringify(
          await startRecording(input, out, { ...capture, url: input, seconds: numeric('seconds') }),
          null,
          2,
        ),
      );
      return 0;
    }
    const result = await reviewMotion({
      input: input ?? '.',
      out,
      capture,
      from: numeric('from'),
      frames: numeric('frames'),
      fps: numeric('fps'),
      episode: v.episode,
      at: numeric('at'),
      radius: numeric('radius'),
      target: v.object,
      point,
      crop: parseCrop(v.crop),
      slice: parseSlice(v.slice),
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
    console.log(JSON.stringify(v.verbose ? result : compactReview(result), null, 2));
    return result.insights?.some((entry) => entry.kind === 'action-error') ? 2 : 0;
  } catch (error) {
    const browserFailure = /^browserType\.launch:/.test(error.message);
    const listenDenied =
      (error.syscall === 'listen' && ['EPERM', 'EACCES'].includes(error.code)) ||
      /listen (?:EPERM|EACCES)\b/.test(error.message);
    console.error(
      JSON.stringify(
        {
          error: browserFailure
            ? `Chromium unavailable: ${startupFailureReason(error)}`
            : error.message,
          ...(browserFailure || listenDenied ? { hint: offlineReviewHint } : {}),
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

/** Keep the next action and evidence paths in context; detailed measurements stay in the report. */
function compactReview(result) {
  const { assets, ...source } = result.source ?? {};
  const paths = Object.fromEntries(
    [
      'path',
      'data',
      'session',
      'image',
      'framesImage',
      'photometryImage',
      'framesDirectory',
      'captureManifest',
      'replay',
      'inspect',
      'preview',
    ]
      .filter((key) => result[key] !== undefined)
      .map((key) => [key, result[key]]),
  );
  return {
    ...paths,
    source: { ...source, ...(assets ? { assetCount: assets.length } : {}) },
    focus: result.focus,
    comparison: result.comparison,
    previews: result.previews,
    coverage: result.coverage,
    recording: result.recording,
    episodeCount: result.episodeCount,
    observations: (result.episodes ?? [])
      .flatMap((episode) =>
        (episode.observations ?? []).map((detail) => ({ episode: episode.id, detail })),
      )
      .slice(0, 5),
    insights: (result.insights ?? []).map(({ kind, time, target, detail, count, durationMs }) => ({
      kind,
      time,
      target,
      detail,
      count,
      durationMs,
    })),
    timingMs: result.timingMs,
    details:
      'Full evidence is saved in data/session. Use inspect for an episode or object; --verbose prints all measurements.',
  };
}
