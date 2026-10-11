import { loadCapture } from './session.mjs';
import { buildEpisodes } from './episodes.mjs';
import { queryEvidence } from './inspection.mjs';
import { mkdir, open, rm, stat, realpath, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { comparisonFrames, renderFrameComparison } from './frame-comparison.mjs';

export function inspectionCommand(input) {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  return `${quote(process.execPath)} ${quote(fileURLToPath(new URL('../scene.mjs', import.meta.url)))} review inspect ${quote(input)}`;
}

export async function inspectSession(input, query = {}) {
  const loaded = await loadCapture(input);
  const allEpisodes = loaded.session?.episodes ?? buildEpisodes(loaded.samples, loaded);
  const episodes = query.search
    ? allEpisodes.filter((e) =>
        [e.id, e.title, e.text, e.cue]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
          .includes(query.search.toLocaleLowerCase()),
      )
    : allEpisodes;
  if (
    !query.episode &&
    query.at === undefined &&
    !query.object &&
    !query.point &&
    query.from === undefined
  ) {
    const offset = query.offset ?? 0,
      limit = query.limit ?? 12;
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('Use an integer offset >= 0 and limit between 1 and 100');
    return {
      session: loaded.session?.id,
      source: loaded.source,
      coverage: loaded.session?.coverage,
      episodes: episodes.slice(offset, offset + limit),
      total: episodes.length,
      ...(offset + limit < episodes.length ? { nextOffset: offset + limit } : {}),
      objects: [
        ...new Set([
          ...(loaded.telemetry?.elements ?? []).map((e) => e.selector),
          ...loaded.samples.flatMap((f) =>
            (f.objects ?? [])
              .filter((o) => o.width > 0 && o.height > 0 && o.visible !== false)
              .map((o) => o.id),
          ),
          ...(loaded.telemetry?.scene ?? []).flatMap((s) =>
            (s.objects ?? []).filter((o) => o.visible !== false).map((o) => o.id),
          ),
        ]),
      ].slice(0, 40),
      usage:
        'Append --timeline-point X,Y (timelineImage pixels) or --at SECONDS for a clean comparisonImage and selection.previous/current/next. --episode ID selects an episode; --out DIRECTORY makes a full detail report.',
      inspect: inspectionCommand(await realpath(input)),
    };
  }
  const evidence = queryEvidence(
    { frames: loaded.samples, episodes, telemetry: loaded.telemetry, source: loaded.source },
    query,
  );
  const path = await realpath(input);
  const directory = (await stat(path)).isDirectory() ? path : dirname(path);
  const folder = join(directory, 'analysis');
  const pair = comparisonFrames(evidence.selection);
  // Inspection renders only this pair. Full analysis and browser previews belong to --out.
  const image = join(folder, `selection-${randomUUID()}.png`);
  let preview;
  let handle;
  try {
    await mkdir(folder, { recursive: true });
    if ((await lstat(folder)).isSymbolicLink())
      throw new Error('Inspection image directory is a symbolic link');
    const png = await renderFrameComparison(pair, {
      at: evidence.selection.current.time,
      theme: loaded.source?.theme,
    });
    // A source may itself live in analysis, or alias one of its PNGs. Never replace a file.
    handle = await open(image, 'wx');
    await handle.writeFile(png);
    preview = { comparisonImage: image };
  } catch (error) {
    preview = { comparisonUnavailable: error.message };
    if (handle) await rm(image, { force: true }).catch(() => {});
  } finally {
    await handle?.close();
  }
  return {
    session: loaded.session?.id,
    source: loaded.source,
    ...preview,
    ...evidence,
  };
}
