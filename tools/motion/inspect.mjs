import { loadCapture } from './session.mjs';
import { buildEpisodes } from './episodes.mjs';
import { queryEvidence } from './inspection.mjs';

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
        'inspect SESSION --episode ID | --at SECONDS --radius .3 | --object ID; --out DIRECTORY renders this selection',
    };
  }
  return {
    session: loaded.session?.id,
    source: loaded.source,
    ...queryEvidence(
      { frames: loaded.samples, episodes, telemetry: loaded.telemetry, source: loaded.source },
      query,
    ),
  };
}
