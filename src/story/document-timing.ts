import { cueSheet, type Script } from './cues.js';
import {
  validateStoryDocument,
  type StoryDocument,
  type StoryDocumentOptions,
} from './document-schema.js';
import { spoken, intention, duration, occupied, timingFor } from './document-beat.js';
import { speechUnits } from './document-speech.js';
import { mapRecordedSpeech } from './recorded-speech.js';
import { documentSpeechSpans, documentSpeechDeclared } from './document-audibility.js';
const timeTolerance = 1e-6;
export function authoredChapter(
  document: StoryDocument,
  id: string,
  options: StoryDocumentOptions = {},
) {
  document = validateStoryDocument(document, options);
  const chapter = document.chapters.find((c) => c.id === id);
  if (!chapter) throw new Error(`Unknown authored chapter: ${id}`);
  return {
    id: chapter.id,
    title: chapter.title,
    ...(chapter.views && { views: chapter.views }),
    text: chapter.beats.map(spoken).filter(Boolean).join(' '),
    beats: chapter.beats.map(({ say: _say, speech: _speech, timing: _timing, ...beat }) => beat),
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
export function documentScript(
  document: StoryDocument,
  aligned: Script,
  options: StoryDocumentOptions = {},
): Script {
  document = validateStoryDocument(document, options);
  aligned = cueSheet(aligned).script;
  const authored = new Set(
    document.chapters.flatMap((chapter) => [
      chapter.id,
      ...chapter.beats.map((beat) => `${chapter.id}.${beat.id}`),
      ...speechUnits(chapter).map((unit) => unit.id),
    ]),
  );
  const cues = Object.fromEntries(Object.entries(aligned.cues).filter(([id]) => authored.has(id)));
  for (const unit of aligned.segments ?? []) {
    const spans = documentSpeechSpans(document, unit);
    if (documentSpeechDeclared(document, unit) && !spans)
      throw new Error('Speech actions need measured word boundaries; prepare this narration.');
    for (const { id, ...span } of spans ?? []) {
      const cue = cues[id];
      cues[id] = { ...cue, ...span, ...(cue?.speech && { speech: span }) };
    }
  }
  const silent = new Set<string>();
  let previousEnd = 0;
  const chapters = document.chapters.map((chapter) => {
    const units = speechUnits(chapter);
    const segments =
      aligned.segments?.filter((segment) => units.some((unit) => unit.id === segment.id)) ?? [];
    if (units.length && !segments.length)
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
          ...segments.map((segment) => segment.audio_start ?? segment.start),
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
        const {
          action: _action,
          hold: _hold,
          timing: _timing,
          awaitInput: _await,
          ...anchor
        } = cue;
        cues[id] = {
          ...anchor,
          ...(timing ? { timing } : {}),
          ...intention(beat),
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
    previousEnd = Math.max(cursor, ...segments.map((segment) => segment.audio_end ?? segment.end));
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
        .map((segment) => segment.audio_end ?? segment.end) ?? []),
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
export function documentChapter(
  document: StoryDocument,
  id: string,
  aligned?: Script,
  options: StoryDocumentOptions = {},
) {
  document = validateStoryDocument(document, options);
  const chapter = document.chapters.find((chapter) => chapter.id === id);
  if (!chapter) throw new Error(`Unknown authored chapter: ${id}`);
  const authored = authoredChapter(document, id, options);
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
    const units = speechUnits(chapter);
    script.segments = aligned!.segments
      ?.filter((segment) => units.some((unit) => unit.id === segment.id))
      .map((segment) => mapRecordedSpeech(segment, (time) => time - span.start));
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
          ...(beat.speech && { conditions: beat.speech.when }),
          ...((beat.title ?? (segments.length === 0 ? chapter.title : undefined))
            ? { title: beat.title ?? chapter.title }
            : {}),
        });
      time += occupied(beat, `${id}.${beat.id}`);
    }
    script.duration = time;
    script.segments = segments;
  }
  return {
    ...authored,
    seconds: script.duration,
    script: resolve(script, silent),
  };
}
