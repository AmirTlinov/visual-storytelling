import { loadCapture } from './session.mjs';
import { buildEpisodes } from './episodes.mjs';
import { queryEvidence } from './inspection.mjs';
import { mkdir, open, rm, stat, realpath, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  savedChanges,
  inspectionPage,
  inspectionNavigation,
  shellQuote,
} from './inspection-navigation.mjs';
import { renderInspectionImage } from './inspection-image.mjs';
import { focusCrop } from './inspection-crop.mjs';

export function inspectionCommand(input) {
  return `${shellQuote(process.execPath)} ${shellQuote(fileURLToPath(new URL('../scene.mjs', import.meta.url)))} review inspect ${shellQuote(input)}`;
}

export async function inspectSession(input, query = {}) {
  if (query.crop === 'auto' && !query.object && !query.point)
    throw new Error('--crop auto needs --object ID or --point x,y');
  if (query.view !== undefined && !['pair', 'frame', 'onion', 'changes'].includes(query.view))
    throw new Error('--view must be pair, frame, onion or changes');
  if (
    query.list !== undefined &&
    !['changes', 'frames', 'episodes', 'objects'].includes(query.list)
  )
    throw new Error('--list must be changes, frames, episodes or objects');
  if (['at', 'frame', 'change'].filter((key) => query[key] !== undefined).length > 1)
    throw new Error('Choose one of --at, --frame or --change');
  if (
    query.list &&
    query.list !== 'objects' &&
    ['at', 'frame', 'change', 'episode', 'step', 'view', 'object', 'point'].some(
      (key) => query[key] !== undefined,
    )
  )
    throw new Error(
      '--list cannot be combined with a frame, change, episode, object or view selection',
    );
  if (query.list && ['view', 'crop', 'object', 'point'].some((key) => query[key] !== undefined))
    throw new Error('--list reads metadata; omit --view, --crop, --object and --point');
  for (const key of ['from', 'to'])
    if (query[key] !== undefined && !Number.isFinite(query[key]))
      throw new Error(`${key} must be finite`);
  if (query.to < query.from) throw new Error('The interval end must follow its start');
  if (query.maxSize !== undefined && (!Number.isInteger(query.maxSize) || query.maxSize < 0))
    throw new Error('--max-size must be a non-negative integer');
  const loaded = await loadCapture(input);
  const path = await realpath(input);
  const directory = (await stat(path)).isDirectory() ? path : dirname(path);
  const command = inspectionCommand(path);
  const allEpisodes = loaded.session?.episodes ?? buildEpisodes(loaded.samples, loaded);
  const episodes = allEpisodes.filter(
    (e) =>
      (query.list === 'objects' ||
        !query.search ||
        [e.id, e.title, e.text, e.cue]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
          .includes(query.search.toLocaleLowerCase())) &&
      (query.list !== 'episodes' ||
        ((query.from === undefined || e.end >= query.from) &&
          (query.to === undefined || e.start <= query.to))),
  );
  const index =
    query.list === undefined &&
    !['episode', 'at', 'frame', 'change', 'step', 'object', 'point', 'from', 'view'].some(
      (key) => query[key] !== undefined,
    );
  const measured =
    index || query.list === 'changes' || query.change !== undefined || query.view === 'changes'
      ? await savedChanges(directory, loaded)
      : { changes: [] };
  const changes = measured.changes.filter(
    (entry) =>
      (query.from === undefined || entry.to.time >= query.from) &&
      (query.to === undefined || entry.from.time <= query.to),
  );
  const changeEntry = (entry) => ({
    ...entry,
    inspect: `${command} --change ${shellQuote(entry.id)}`,
  });
  const source = loaded.source;
  if (query.list && query.list !== 'objects') {
    const items =
      query.list === 'changes'
        ? changes.map(changeEntry)
        : query.list === 'episodes'
          ? episodes
          : loaded.samples
              .map(({ id, time, file }, index) => ({
                id,
                index,
                time,
                file,
                inspect: `${command} --frame ${index}`,
              }))
              .filter(
                (frame) =>
                  (query.from === undefined || frame.time >= query.from) &&
                  (query.to === undefined || frame.time <= query.to),
              );
    return {
      session: loaded.session?.id,
      source,
      list: query.list,
      ...inspectionPage(items, query),
      ...(query.list === 'changes'
        ? {
            order: 'meanDelta descending; IDs identify captured intervals, not ranks',
            unavailable: measured.unavailable,
          }
        : {}),
      inspect: command,
    };
  }
  if (index) {
    const page = inspectionPage(episodes, query);
    return {
      session: loaded.session?.id,
      source,
      coverage: loaded.session?.coverage,
      episodes: page.items,
      total: page.total,
      ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
      changes: changes
        .filter((change) => change.meanDelta > 0)
        .slice(0, 5)
        .map(changeEntry),
      ...(measured.unavailable ? { changesUnavailable: measured.unavailable } : {}),
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
        'Select --change ID|largest, --frame ID|INDEX|first|last or --at SECONDS. --step N moves from that anchor. --view pair|frame|onion|changes renders only that view. --list objects --search TEXT finds details; --object ID --crop auto --max-size 0 enlarges them. --out DIRECTORY makes a full report.',
      commands: {
        changes: `${command} --list changes`,
        frames: `${command} --list frames`,
        objects: `${command} --list objects`,
      },
      inspect: command,
    };
  }
  if (query.change !== undefined) {
    const change =
      query.change === 'largest'
        ? changes.find((entry) => entry.meanDelta > 0)
        : changes.find((entry) => entry.id === query.change);
    if (!change)
      throw new Error(
        measured.unavailable ?? `Unknown or absent change ${query.change}; use --list changes`,
      );
    query = { ...query, at: change.to.time };
  }
  const evidence = queryEvidence(
    { frames: loaded.samples, episodes, telemetry: loaded.telemetry, source: loaded.source },
    query.list === 'objects' ? { ...query, limit: 1, objectLimit: Infinity } : query,
  );
  if (query.list === 'objects') {
    const items = evidence.objects
      .filter(
        (object) =>
          !query.search ||
          [object.id, object.text]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase()
            .includes(query.search.toLocaleLowerCase()),
      )
      .map(({ id, text, x, y, width, height }) => ({
        id,
        text,
        bounds: { x, y, width, height },
        inspect: `${command} --frame ${evidence.selection.current.index} --object ${shellQuote(id)} --crop auto --max-size 0`,
      }));
    return {
      session: loaded.session?.id,
      source,
      list: 'objects',
      frame: evidence.selection.current,
      ...inspectionPage(items, query),
    };
  }
  if (query.object && !evidence.objects.length && !evidence.trajectorySamples) {
    // A known object may disappear from the selected state. Its earlier geometry still
    // belongs in a comparison; only reject identities absent from the entire capture.
    const history = queryEvidence(
      { frames: loaded.samples, telemetry: loaded.telemetry, source },
      {
        object: query.object,
        from: loaded.samples[0].time,
        to: loaded.samples.at(-1).time,
        limit: 1,
      },
    );
    if (!history.objects.length && !history.trajectorySamples)
      throw new Error(`Object ${query.object} is not observed in this capture; use --list objects`);
  }
  const navigation = inspectionNavigation(command, evidence.selection, query);
  if (evidence.objects.length)
    navigation.objects = `${command} --frame ${evidence.selection.current.index} --list objects`;
  const focus =
    query.crop === 'auto' && query.render !== false
      ? await focusCrop(loaded, evidence.selection, query)
      : {};
  const crop = focus.crop ?? query.crop;
  if (query.render === false)
    return { session: loaded.session?.id, source, ...evidence, navigation, crop, ...focus };
  const folder = join(directory, 'analysis');
  // Full analysis and browser previews belong to --out; each inspection decodes only its view.
  const image = join(folder, `selection-${randomUUID()}.png`);
  let preview;
  let handle;
  try {
    await mkdir(folder, { recursive: true });
    if ((await lstat(folder)).isSymbolicLink())
      throw new Error('Inspection image directory is a symbolic link');
    const { png, ...viewData } = await renderInspectionImage(
      loaded.samples,
      evidence.selection,
      measured.changes,
      { ...query, crop, theme: source?.theme },
    );
    // A source may itself live in analysis, or alias one of its PNGs. Never replace a file.
    handle = await open(image, 'wx');
    await handle.writeFile(png);
    const field = {
      pair: 'comparisonImage',
      frame: 'frameImage',
      onion: 'onionImage',
      changes: 'changesImage',
    }[query.view ?? 'pair'];
    preview = { image, [field]: image, ...viewData };
  } catch (error) {
    preview = {
      imageUnavailable: error.message,
      ...(!query.view || query.view === 'pair' ? { comparisonUnavailable: error.message } : {}),
    };
    if (handle) await rm(image, { force: true }).catch(() => {});
  } finally {
    await handle?.close();
  }
  return {
    session: loaded.session?.id,
    source,
    view: query.view ?? 'pair',
    ...(crop ? { crop } : {}),
    ...focus,
    ...preview,
    ...evidence,
    navigation,
  };
}
