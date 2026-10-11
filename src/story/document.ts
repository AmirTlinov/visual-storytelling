import { cueSheet, type CueTiming, type Script } from './cues.js';

/** One authored beat owns its visual action and optional spoken words. */
export interface AuthoredBeat {
  id: string;
  /** Optional visible wording; an action can be entirely visual. */
  text?: string;
  title?: string;
  seconds?: number;
  /** Spoken wording defaults to text. An empty string explicitly keeps a beat silent. */
  say?: string;
  /** Review descriptions do not become visible text or narration. */
  action?: string;
  hold?: string;
  /** Action window; until accepts a local beat ID or a fully qualified chapter.beat ID. */
  timing?: CueTiming;
}
export interface StoryDocument {
  title: string;
  chapters: readonly {
    id: string;
    title: string;
    beats: readonly AuthoredBeat[];
  }[];
  narration?: {
    voice?: Record<string, unknown>;
    intro?: number;
    outro?: number;
    pause?: number;
    music?: unknown;
    captionAliases?: Record<string, string>;
  };
}
type AuthoredChapter = StoryDocument['chapters'][number];
const timeTolerance = 1e-6;
const spoken = (beat: AuthoredBeat) => (beat.say ?? beat.text ?? '').trim();
const intention = (beat: AuthoredBeat) => ({
  ...(beat.action !== undefined
    ? { action: beat.action }
    : beat.hold === undefined && beat.text?.trim()
      ? { action: beat.text }
      : {}),
  ...(beat.hold !== undefined ? { hold: beat.hold } : {}),
});
function duration(beat: AuthoredBeat, id: string) {
  if (beat.timing && typeof beat.timing !== 'object')
    throw new Error(`Beat ${id}: timing needs duration or until`);
  const text = spoken(beat);
  const seconds =
    beat.seconds ??
    (text
      ? Math.max(2.5, text.split(/\s+/).length / 2.5 + 0.6)
      : beat.timing && 'duration' in beat.timing
        ? (beat.timing.delay ?? 0) + beat.timing.duration!
        : 2.5);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid duration for ${id}`);
  return seconds;
}
function occupied(beat: AuthoredBeat, id: string) {
  return Math.max(
    duration(beat, id),
    beat.timing && 'duration' in beat.timing ? (beat.timing.delay ?? 0) + beat.timing.duration! : 0,
  );
}
function timingFor(chapter: AuthoredChapter, beat: AuthoredBeat) {
  const timing = beat.timing;
  return typeof timing?.until === 'string' && chapter.beats.some((b) => b.id === timing.until)
    ? { ...timing, until: `${chapter.id}.${timing.until}` }
    : timing;
}
function validate(document: StoryDocument) {
  if (!document.title?.trim() || !document.chapters?.length)
    throw new Error('Story document needs a title and chapters');
  const ids = new Set<string>();
  for (const chapter of document.chapters) {
    if (
      !/^[a-z][a-z0-9_-]*$/.test(chapter.id) ||
      ids.has(chapter.id) ||
      !chapter.title?.trim() ||
      !chapter.beats.length
    )
      throw new Error(`Invalid chapter: ${chapter.id}`);
    ids.add(chapter.id);
    for (const beat of chapter.beats) {
      const id = `${chapter.id}.${beat.id}`;
      if (typeof beat.id !== 'string' || !/^[a-z][a-z0-9_.-]*$/.test(beat.id) || ids.has(id))
        throw new Error(`Beat ${id} needs a unique ID`);
      if (
        [beat.text, beat.say, beat.title].some(
          (value) => value !== undefined && typeof value !== 'string',
        )
      )
        throw new Error(`Beat ${id}: text, say and title must be strings`);
      if (
        (beat.action !== undefined && beat.hold !== undefined) ||
        [beat.action, beat.hold].some(
          (value) => value !== undefined && (typeof value !== 'string' || !value.trim()),
        )
      )
        throw new Error(`Beat ${id}: provide either a non-empty action or hold`);
      duration(beat, id);
      ids.add(id);
    }
  }
  return ids;
}
// Match the speech aligner's Russian word contract, including ё and non-breaking hyphens.
const spokenWords = (text: string) =>
  (text.match(/[А-Яа-яЁё]+(?:[-‑][А-Яа-яЁё]+)*/g) ?? []).map((word) =>
    word.toLowerCase().replaceAll('ё', 'е').replaceAll('‑', '-'),
  );
/** Contiguous spoken runs share synthesis; silent beats use the assembler's existing pauses. */
function spokenRuns(chapter: AuthoredChapter) {
  const runs: AuthoredBeat[][] = [];
  let run: AuthoredBeat[] | undefined;
  for (const beat of chapter.beats) {
    if (!spoken(beat)) run = undefined;
    else {
      if (!run) runs.push((run = []));
      run.push(beat);
    }
  }
  return runs.map((beats, index) => ({
    id: runs.length === 1 ? chapter.id : `${chapter.id}.narration-${index + 1}`,
    beats,
  }));
}
export function authoredChapter(document: StoryDocument, id: string) {
  const chapter = document.chapters.find((c) => c.id === id);
  if (!chapter) throw new Error(`Unknown authored chapter: ${id}`);
  return {
    id: chapter.id,
    title: chapter.title,
    text: chapter.beats.map(spoken).filter(Boolean).join(' '),
    beats: chapter.beats.map(({ say: _say, timing: _timing, ...beat }) => beat),
  };
}
/** Feed the existing cached speech/alignment owner, without empty or invented spoken segments. */
export function documentNarration(document: StoryDocument) {
  const ids = validate(document);
  const spec = document.narration ?? {};
  let intro = spec.intro ?? 0;
  const spokenIds = new Set(
    document.chapters.flatMap((chapter) =>
      chapter.beats.filter((beat) => spoken(beat)).map((beat) => `${chapter.id}.${beat.id}`),
    ),
  );
  const segments: {
    id: string;
    title: string;
    text: string;
    pause_after: number;
    cues: {
      id: string;
      quote: string;
      occurrence: number;
      action?: string;
      hold?: string;
      timing?: CueTiming;
    }[];
  }[] = [];
  let actionReserve = 0;
  const pause = (seconds: number) => {
    const previous = segments.at(-1);
    if (previous) previous.pause_after += seconds;
    else intro += seconds;
  };
  for (const chapter of document.chapters) {
    const runs = spokenRuns(chapter);
    for (const beat of chapter.beats) {
      if (!spoken(beat)) {
        // Speech duration is not known until alignment. Reserving each run's longest
        // action after its clip guarantees that the following silent action fits.
        pause(actionReserve + occupied(beat, `${chapter.id}.${beat.id}`));
        actionReserve = 0;
        continue;
      }
      const run = runs.find((run) => run.beats[0] === beat);
      if (!run) continue;
      if (run.id !== chapter.id && ids.has(run.id))
        throw new Error(`Beat ID is reserved for narration: ${run.id}`);
      const tokens = run.beats.flatMap((beat) => spokenWords(spoken(beat)));
      let wordStart = 0;
      const cues = run.beats.map((beat) => {
        const quote = spokenWords(spoken(beat));
        let occurrence = quote.length ? 0 : 1;
        for (let start = 0; quote.length && start <= wordStart; start++)
          if (quote.every((word, index) => tokens[start + index] === word)) occurrence++;
        wordStart += quote.length;
        const timing = timingFor(chapter, beat);
        // The speech assembler only knows spoken IDs. The document resolves an action
        // ending at a silent beat after its real acoustic anchors have been loaded.
        const acousticTiming = timing?.until && !spokenIds.has(timing.until) ? undefined : timing;
        return {
          id: `${chapter.id}.${beat.id}`,
          quote: spoken(beat),
          occurrence,
          ...intention(beat),
          ...(acousticTiming !== undefined ? { timing: acousticTiming } : {}),
        };
      });
      segments.push({
        id: run.id,
        title: chapter.title,
        text: run.beats.map(spoken).join(' '),
        pause_after: 0,
        cues,
      });
      actionReserve = Math.max(
        0,
        ...run.beats.map((beat) =>
          beat.timing && 'duration' in beat.timing
            ? (beat.timing.delay ?? 0) + beat.timing.duration!
            : 0,
        ),
      );
    }
    if (runs.length) {
      pause(actionReserve + (spec.pause ?? 0.6));
      actionReserve = 0;
    }
  }
  return {
    version: 3,
    voice: { ...(spec.voice ?? { seed: 42 }) },
    intro,
    outro: spec.outro ?? 0.6,
    music: spec.music ? structuredClone(spec.music) : null,
    ...(spec.captionAliases ? { captionAliases: { ...spec.captionAliases } } : {}),
    segments,
  };
}
function resolve(script: Script, silent: ReadonlySet<string>) {
  const result = cueSheet(script).script;
  for (const id of silent) {
    const { speech: _speech, ...cue } = result.cues[id]!;
    result.cues[id] = cue;
  }
  return result;
}
/** Keep real acoustic anchors fixed; authored silent actions occupy the reserved gaps. */
export function documentScript(document: StoryDocument, aligned: Script): Script {
  validate(document);
  const cues = { ...aligned.cues };
  const silent = new Set<string>();
  let previousEnd = 0;
  const chapters = document.chapters.map((chapter) => {
    const runs = spokenRuns(chapter);
    const segments =
      aligned.segments?.filter(
        (segment) => segment.id === chapter.id || runs.some((run) => run.id === segment.id),
      ) ?? [];
    if (runs.length && !segments.length)
      throw new Error(`Aligned narration needs chapter ${chapter.id}`);
    const firstSpoken = chapter.beats.findIndex((beat) => spoken(beat));
    const leading = chapter.beats
      .slice(0, firstSpoken < 0 ? undefined : firstSpoken)
      .reduce((seconds, beat) => seconds + occupied(beat, `${chapter.id}.${beat.id}`), 0);
    const firstCue =
      firstSpoken < 0 ? undefined : cues[`${chapter.id}.${chapter.beats[firstSpoken]!.id}`];
    if (firstSpoken >= 0 && !firstCue)
      throw new Error(`Missing spoken action ${chapter.id}.${chapter.beats[firstSpoken]!.id}`);
    const projectedStart = firstCue
      ? Math.min(
          ...segments.map((segment) => segment.start),
          (firstCue.speech ?? firstCue).start - leading,
        )
      : previousEnd;
    if (projectedStart < previousEnd - timeTolerance || projectedStart < -timeTolerance)
      throw new Error(
        `Narrated chapter ${chapter.id} overlaps the preceding action; reserve time for silent beats`,
      );
    const start = Math.max(0, projectedStart);
    let cursor = start;
    let precedingSilent = false;
    for (const beat of chapter.beats) {
      const id = `${chapter.id}.${beat.id}`;
      const timing = timingFor(chapter, beat);
      if (spoken(beat)) {
        const cue = cues[id];
        if (!cue) throw new Error(`Missing spoken action ${id}`);
        if (precedingSilent && (cue.speech ?? cue).start < cursor - timeTolerance)
          throw new Error(
            `Silent action before ${id} does not fit aligned narration; regenerate narration with its authored pauses`,
          );
        cues[id] = {
          ...cue,
          ...(timing ? { timing } : {}),
          ...(beat.action !== undefined ? { action: beat.action } : {}),
          ...(beat.hold !== undefined ? { hold: beat.hold } : {}),
        };
      } else {
        silent.add(id);
        cues[id] = {
          start: cursor,
          end: cursor + duration(beat, id),
          ...intention(beat),
          ...(timing ? { timing } : {}),
        };
      }
      const cue = cues[id]!;
      const anchor = cue.speech ?? cue;
      cursor = Math.max(
        cursor,
        cue.end,
        timing && 'duration' in timing
          ? anchor.start + (timing.delay ?? 0) + timing.duration!
          : cue.end,
      );
      if (silent.has(id) && cursor > aligned.duration + 0.01)
        throw new Error(`Silent action ${id} does not fit the supplied narration duration`);
      precedingSilent = !spoken(beat);
    }
    previousEnd = Math.max(cursor, ...segments.map((segment) => segment.end));
    return { chapter, start, finish: previousEnd };
  });
  const script = resolve({ ...aligned, cues }, silent);
  // Computed silent durations may exceed an adjacent acoustic boundary by a
  // floating-point residue. Snap only those action ends; keep speech anchors intact.
  const closeEnd = (id: string, boundary: number) => {
    const cue = script.cues[id]!;
    if (boundary >= cue.start && cue.end > boundary && cue.end <= boundary + timeTolerance)
      script.cues[id] = { ...cue, end: boundary };
  };
  previousEnd = 0;
  for (const [chapterIndex, { chapter, start, finish }] of chapters.entries()) {
    if (start < previousEnd - timeTolerance)
      throw new Error(`Narrated chapter ${chapter.id} overlaps the preceding action`);
    const previous = chapters[chapterIndex - 1]?.chapter;
    if (previous && start < previousEnd) {
      closeEnd(previous.id, start);
      for (const beat of previous.beats) closeEnd(`${previous.id}.${beat.id}`, start);
    }
    for (const [index, beat] of chapter.beats.entries()) {
      const next = chapter.beats[index + 1];
      if (next)
        closeEnd(`${chapter.id}.${beat.id}`, script.cues[`${chapter.id}.${next.id}`]!.start);
    }
    const end = Math.max(
      finish,
      ...chapter.beats.map((beat) => script.cues[`${chapter.id}.${beat.id}`]!.end),
      ...(aligned.segments
        ?.filter((segment) => segment.id === chapter.id)
        .map((segment) => segment.end) ?? []),
    );
    const action = chapter.beats
      .map((beat) => beat.action ?? beat.text)
      .filter(Boolean)
      .join(' ');
    script.cues[chapter.id] = { start, end, ...(action ? { action } : {}) };
    previousEnd = end;
    for (const [index, beat] of chapter.beats.entries()) {
      if (spoken(beat)) continue;
      const next = chapter.beats.slice(index + 1).find((beat) => spoken(beat));
      if (!next) continue;
      const cue = script.cues[`${chapter.id}.${beat.id}`]!;
      const spokenCue = script.cues[`${chapter.id}.${next.id}`]!;
      if (cue.end > (spokenCue.speech ?? spokenCue).start + timeTolerance)
        throw new Error(
          `Silent action ${chapter.id}.${beat.id} does not fit aligned narration; regenerate narration with its authored pauses`,
        );
    }
  }
  return cueSheet(script).script;
}

/** Local speech/action clock, also available before any voice has been installed. */
export function documentChapter(document: StoryDocument, id: string, aligned?: Script) {
  validate(document);
  const chapter = document.chapters.find((chapter) => chapter.id === id);
  if (!chapter) throw new Error(`Unknown authored chapter: ${id}`);
  const authored = authoredChapter(document, id);
  const span = aligned?.cues[id];
  if (aligned && !span) throw new Error(`Missing aligned chapter: ${id}`);
  const script: Script = { duration: 0, cues: {}, segments: [] };
  const silent = new Set(chapter.beats.filter((beat) => !spoken(beat)).map((beat) => beat.id));
  if (span) {
    script.duration = span.end - span.start;
    script.captionAliases = aligned!.captionAliases;
    for (const beat of chapter.beats) {
      const cue = aligned!.cues[`${id}.${beat.id}`];
      if (!cue) throw new Error(`Missing authored action ${id}.${beat.id}`);
      script.cues[beat.id] = {
        ...cue,
        start: cue.start - span.start,
        end: cue.end - span.start,
        ...(cue.speech
          ? { speech: { start: cue.speech.start - span.start, end: cue.speech.end - span.start } }
          : {}),
      };
    }
    const runs = spokenRuns(chapter);
    script.segments = aligned!.segments
      ?.filter((segment) => segment.id === id || runs.some((run) => run.id === segment.id))
      .map((segment) => ({
        ...segment,
        start: segment.start - span.start,
        end: segment.end - span.start,
        words: segment.words?.map((word) => ({
          ...word,
          start: word.start - span.start,
          end: word.end - span.start,
        })),
      }));
  } else {
    let time = 0;
    const segments: NonNullable<Script['segments']>[number][] = [];
    for (const beat of chapter.beats) {
      const seconds = duration(beat, `${id}.${beat.id}`);
      const span = { start: time, end: time + seconds };
      const timing =
        typeof beat.timing?.until === 'string' && beat.timing.until.startsWith(`${id}.`)
          ? { ...beat.timing, until: beat.timing.until.slice(id.length + 1) }
          : beat.timing;
      script.cues[beat.id] = { ...span, ...intention(beat), ...(timing ? { timing } : {}) };
      if (spoken(beat))
        segments.push({
          id: beat.id,
          ...span,
          text: spoken(beat),
          ...((beat.title ?? beat.text) ? { title: beat.title ?? beat.text } : {}),
        });
      time += occupied(beat, `${id}.${beat.id}`);
    }
    script.duration = time;
    script.segments = segments;
  }
  return { ...authored, seconds: script.duration, script: resolve(script, silent) };
}
