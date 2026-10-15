import type { AuthoredBeat, AuthoredChapter } from './document-schema.js';
export const spoken = (beat: AuthoredBeat) => (beat.say ?? beat.text ?? '').trim();
export const intention = (beat: AuthoredBeat) => ({
  ...(beat.awaitInput ? { awaitInput: true } : {}),
  ...(beat.action !== undefined
    ? { action: beat.action }
    : beat.hold === undefined && beat.text?.trim()
      ? { action: beat.text }
      : {}),
  ...(beat.hold !== undefined ? { hold: beat.hold } : {}),
});
export function duration(beat: AuthoredBeat, id: string) {
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
export function occupied(beat: AuthoredBeat, id: string) {
  return Math.max(
    duration(beat, id),
    beat.timing && 'duration' in beat.timing ? (beat.timing.delay ?? 0) + beat.timing.duration! : 0,
  );
}
export function timingFor(chapter: AuthoredChapter, beat: AuthoredBeat) {
  const timing = beat.timing;
  return typeof timing?.until === 'string' && chapter.beats.some((b) => b.id === timing.until)
    ? { ...timing, until: `${chapter.id}.${timing.until}` }
    : timing;
}
