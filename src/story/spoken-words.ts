/** Lexical identity shared by authored cue occurrences and voice-adapter alignment. */
export function spokenText(text: string): string {
  return text.replace(/<\|[a-z]+:[a-z_]+\|>/g, '').trim();
}
export function spokenWords(text: string): string[] {
  return (
    spokenText(text)
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replaceAll('‑', '-')
      .match(/[\p{L}\p{N}]+(?:[-][\p{L}\p{N}]+)*/gu) ?? []
  );
}

/** A cue can use measured word/phrase endpoints, never an invented interior timestamp. */
export function spokenSpan(
  words: readonly { text: string; start: number; end: number }[],
  offset: number,
  length: number,
) {
  let cursor = 0,
    start: number | undefined,
    end: number | undefined;
  for (const word of words) {
    const size = spokenWords(word.text).length;
    if (cursor === offset) start = word.start;
    if (cursor + size === offset + length) end = word.end;
    cursor += size;
  }
  return length > 0 && start !== undefined && end !== undefined ? { start, end } : undefined;
}
