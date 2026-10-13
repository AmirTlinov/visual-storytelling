/** Lexical identity shared by authored cue occurrences and voice-adapter alignment. */
export function spokenWords(text: string): string[] {
  return (
    text
      .replace(/<\|[a-z]+:[a-z_]+\|>/g, '')
      .toLowerCase()
      .replaceAll('ё', 'е')
      .replaceAll('‑', '-')
      .match(/[\p{L}\p{N}]+(?:[-][\p{L}\p{N}]+)*/gu) ?? []
  );
}
