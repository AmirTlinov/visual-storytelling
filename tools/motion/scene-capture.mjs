import { writeFile, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { renderer } from '../render.mjs';
import { captureWriter } from './session.mjs';
import { storyEpisodes, selectEpisode } from './episodes.mjs';
import { sourceReferences } from './sources.mjs';
import { subjectDigests } from './subject-digests.mjs';

/** An adapter over the existing scene clock; this is never a playback performance trace. */
export async function captureScene({
  input,
  directory,
  out,
  cue,
  from,
  seconds,
  frames,
  fps,
  width,
  theme,
  reduced,
}) {
  const capture = await renderer({
    directory: directory ? input : dirname(input),
    entry: directory ? 'index.html' : basename(input),
    width,
    theme,
    reduced,
    controls: true,
  });
  try {
    if (!capture.info.seekable)
      throw new Error('This page has no seekable scene. Use --capture to record the interaction.');
    let review;
    try {
      review = await capture.capture.evaluate((s) => s.review());
    } catch (e) {
      if (!e.message.includes('Attach the story')) throw e;
    }
    const duration = capture.info.duration;
    const episodes = review ? storyEpisodes(review) : [];
    const selected = cue ? selectEpisode(episodes, cue) : undefined;
    const lo = Math.max(0, selected ? selected.start - 0.15 : (from ?? 0));
    const hi = Math.min(
      duration,
      selected ? selected.end + 0.15 : seconds !== undefined ? lo + seconds : duration,
    );
    if (lo >= hi) throw new Error('Selected interval contains fewer than two frames');
    const times = new Set([lo, hi]);
    const addRange = (a, b, n) => {
      for (let i = 0; i < n; i++)
        times.add(Math.min(hi, Math.max(lo, a + ((b - a) * i) / Math.max(1, n - 1))));
    };
    if (selected) {
      addRange(selected.start, selected.end, frames);
    } else if (from !== undefined && seconds === undefined) {
      times.clear();
      addRange(lo, Math.min(hi, lo + (frames - 1) / (fps ?? 60)), frames);
    } else if (episodes.length && from === undefined && seconds === undefined) {
      // Chapter coverage is cheap; every operation retains its exact boundaries.
      for (const e of episodes.filter((e) => e.kind === 'chapter')) addRange(e.start, e.end, 5);
      for (const e of episodes.filter((e) => e.kind !== 'chapter')) {
        times.add(Math.max(lo, e.start));
        times.add(Math.min(hi, e.end));
      }
    } else addRange(lo, hi, frames);
    const writer = await captureWriter(out);
    const source = {
      kind: 'scene-seek',
      path: input,
      duration,
      theme,
      reduced,
      clock: 'scene model time',
      sampling: 'model-checkpoints',
      inspectionLimits: { domObjects: 150, objectsPer3DView: 400 },
      timingNote:
        'Состояния по перемотке. Эти интервалы не измеряют плавность реального воспроизведения.',
      ...(selected
        ? { cue: { id: selected.cue ?? cue, start: selected.start, end: selected.end } }
        : {}),
    };
    const references = await sourceReferences(directory ? input : dirname(input), capture.page);
    source.fingerprint = references.fingerprint;
    source.assets = references.assets;
    const identities = await capture.page.evaluateHandle(() => ({ nodes: new WeakMap(), next: 0 }));
    for (const time of [...times].filter((t) => t >= lo && t <= hi).sort((a, b) => a - b)) {
      await capture.seek(time);
      const state = await capture.capture.evaluate((s) => s.snapshot());
      const cueReads = review
        ? await capture.capture.evaluate((s) => s.review().observed)
        : undefined;
      const diagnostics = await capture.capture.evaluate((s) => s.diagnostics());
      const presentation = await capture.capture.evaluate((s) => s.presentation());
      const objects = await identities.evaluate((cache) => {
        const root = document.querySelector('.ve-scene'),
          origin = root?.getBoundingClientRect() ?? { x: 0, y: 0 };
        const dom = [...document.querySelectorAll('svg text,[data-review-id],[data-layout-error]')]
          .slice(0, 150)
          .map((node) => {
            const b = node.getBoundingClientRect();
            let id = node.getAttribute('data-review-id') || node.id || cache.nodes.get(node);
            if (!id) {
              id = `svg:${cache.next++}`;
              cache.nodes.set(node, id);
            }
            return {
              id,
              text: node.textContent?.trim().slice(0, 160),
              textSource: 'dom-text-content',
              x: b.x - origin.x,
              y: b.y - origin.y,
              width: b.width,
              height: b.height,
              data: node.__visualReview?.(),
              owner: node.getAttribute('data-review-owner') ?? undefined,
              evidence: 'DOM at model checkpoint',
            };
          });
        const views = [...document.querySelectorAll('canvas')].flatMap((node) => {
          const view = node.__visualReview?.();
          return (view?.objects ?? []).map((o) => ({
            ...o,
            x: o.x - origin.x,
            y: o.y - origin.y,
            receipt: view.receipt,
            camera: view.camera,
          }));
        });
        return [...dom, ...views];
      });
      for (const object of objects)
        object.sourceFile = await references.owner(object.source ?? object.owner);
      const png = await capture.png();
      const regions = await capture.page.evaluate(() => {
        const root = document.querySelector('.ve-scene');
        const origin = root?.getBoundingClientRect() ?? { x: 0, y: 0 };
        const box = (node) => {
          const b = node.getBoundingClientRect();
          const hidden = !node.checkVisibility();
          return {
            x: b.x - origin.x,
            y: b.y - origin.y,
            width: hidden ? 0 : b.width,
            height: hidden ? 0 : b.height,
          };
        };
        const subject = root?.querySelector(
          '[data-scene-frame],.ve-stage,svg.canvas,svg.vs-canvas',
        );
        const exclude = [
          ...(root?.querySelectorAll('[data-caption],[data-player],[data-review-ignore]') ?? []),
        ].map(box);
        return [
          ...(subject ? [{ id: '$subject', ...box(subject), exclude }] : []),
          ...[...(root?.querySelectorAll('[data-review-id]') ?? [])].map((node) => ({
            id: node.getAttribute('data-review-id'),
            ...box(node),
            exclude,
          })),
        ];
      });
      const subjects = await subjectDigests(png, regions);
      await writer.append({
        id: `frame:${writer.frames.length}`,
        time,
        state,
        cueReads,
        diagnostics,
        presentation,
        objects,
        digest: createHash('sha256').update(png).digest('hex'),
        subjects,
        png,
      });
    }
    if (review) review = await capture.capture.evaluate((s) => s.review());
    const context = { review, messages: capture.messages };
    if (capture.info.audioURL) {
      try {
        const url = new URL(capture.info.audioURL);
        const destination = join(out, 'narration.audio');
        if (url.origin === new URL(capture.url).origin) {
          const root = resolve(directory ? input : dirname(input));
          const file = resolve(root, '.' + decodeURIComponent(url.pathname));
          if (!file.startsWith(root + sep)) throw new Error('Audio is outside the scene directory');
          // Copy-on-write snapshots share storage where supported, but remain independent
          // when the authored WAV changes. Node falls back to a regular copy elsewhere.
          await copyFile(file, destination, constants.COPYFILE_FICLONE);
          context.audio = 'narration.audio';
        } else {
          const response = await capture.page.request.get(url.href);
          if (!response.ok()) throw new Error(`Audio request failed: ${response.status()}`);
          await writeFile(destination, await response.body());
          context.audio = 'narration.audio';
        }
      } catch (e) {
        context.audioWarning = e.message;
      }
    }
    const captureManifest = await writer.finish(source, undefined, context);
    return { samples: writer.frames, source, context, captureManifest };
  } finally {
    await capture.close();
  }
}
