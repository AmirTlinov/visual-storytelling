/** A location in the authored UTF-8 input. Offsets index the decoded JavaScript string. */
export interface SourceSpan {
  file: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  start?: number;
  end?: number;
  hash?: string;
  kind?: 'object' | 'operation' | 'chapter';
}

const origins = new WeakMap<object, SourceSpan>();
const referable = (value: unknown): value is object =>
  value !== null && (typeof value === 'object' || typeof value === 'function');

/** The scene compiler annotates existing values; identity and ownership do not change. */
export function sourceAt<T>(value: T, source: SourceSpan | undefined): T {
  if (referable(value)) {
    if (source) origins.set(value, source);
    else origins.delete(value);
  }
  return value;
}

export function sourceOf(value: unknown): SourceSpan | undefined {
  return referable(value) ? origins.get(value) : undefined;
}

/** An async chapter retains its own origin on its already-owned presentation element. */
export function containingSource(element: Element | null): SourceSpan | undefined {
  for (let node = element; node; node = node.parentElement) {
    const source = sourceOf(node);
    if (source) return source;
  }
}
