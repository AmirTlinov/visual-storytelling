import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reportTemporalChanges } from './temporal-board.mjs';

export const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

/** Read existing measurements only. Match by observed times, including derivative reports. */
export async function savedChanges(directory, loaded) {
  let report;
  try {
    report = JSON.parse(await readFile(join(directory, 'motion.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { changes: [], unavailable: 'No saved change measurements; frames remain selectable.' };
  }
  if (loaded.session && report.session?.id && loaded.session.id !== report.session.id)
    return { changes: [], unavailable: 'Change measurements belong to another capture.' };
  const frames = loaded.samples;
  const byTime = new Map(frames.map((frame, index) => [frame.time, index]));
  const changes = reportTemporalChanges(report).flatMap((change) => {
    const index = byTime.get(change.endTime);
    const previous = frames[index - 1];
    if (!previous || Math.abs(previous.time - change.startTime) > 1e-8) return [];
    return [
      {
        id: `change:${index}`,
        from: { id: previous.id, index: index - 1, time: previous.time },
        to: { id: frames[index].id, index, time: frames[index].time },
        dtMs: change.dtMs,
        meanDelta: change.meanDelta,
        changedPercent: change.changedPercent,
        changeRate: change.changeRate,
        magnitude: change.magnitude,
        candidate: change.candidate,
      },
    ];
  });
  changes.sort((a, b) => b.meanDelta - a.meanDelta || a.to.time - b.to.time);
  return { changes };
}

export function inspectionPage(items, { offset = 0, limit = 12 } = {}) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('Use an integer offset >= 0 and limit between 1 and 100');
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    ...(offset + limit < items.length ? { nextOffset: offset + limit } : {}),
  };
}

/** Explicit frame anchors keep concurrent agents independent; there is no shared cursor. */
export function inspectionNavigation(command, selection, query) {
  const options = [
    ['view', query.view],
    ['radius', query.radius],
    ['object', query.object],
    ['point', query.point?.join(',')],
    [
      'crop',
      query.crop === 'auto'
        ? 'auto'
        : query.crop && [query.crop.x, query.crop.y, query.crop.width, query.crop.height].join(','),
    ],
    ['max-size', query.maxSize],
    ['limit', query.limit],
  ].filter(([, value]) => value !== undefined);
  const suffix = options.map(([key, value]) => ` --${key} ${shellQuote(value)}`).join('');
  const frameCommand = (frame) => (frame ? `${command} --frame ${frame.index}${suffix}` : null);
  return {
    previous: frameCommand(selection.previous),
    next: frameCommand(selection.next),
    current: frameCommand(selection.current),
  };
}
