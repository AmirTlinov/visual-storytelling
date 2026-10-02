import type { ExplorerTarget } from './types.js';
export interface PathEntry<N> {
  node: N;
  via?: string;
}
/** The subject supplies identity; cross-links return to an existing ancestor. */
export class ScenePath<N> {
  private trail: PathEntry<N>[];
  constructor(
    private root: N,
    private identity: (node: N) => string,
  ) {
    this.trail = [{ node: root }];
  }
  get entries(): readonly PathEntry<N>[] {
    return this.trail;
  }
  get current() {
    return this.trail.at(-1)!.node;
  }
  get length() {
    return this.trail.length;
  }
  get keys() {
    return this.trail.slice(1).map((entry) => entry.via!);
  }
  destination(hit: Pick<ExplorerTarget<N>, 'key' | 'node'>) {
    const key = this.identity(hit.node);
    const ancestor = this.trail.findIndex((entry) => this.identity(entry.node) === key);
    return ancestor < 0 ? this.trail.length : ancestor;
  }
  enter(hit: Pick<ExplorerTarget<N>, 'key' | 'node'>) {
    const depth = this.destination(hit);
    if (depth < this.length) this.jump(depth);
    else this.trail.push({ node: hit.node, via: hit.key });
  }
  jump(depth: number) {
    if (!Number.isInteger(depth)) return;
    this.trail.length = Math.max(1, Math.min(this.length, Math.floor(depth) + 1));
  }
  pop() {
    if (this.length > 1) return this.trail.pop();
  }
  reset() {
    this.trail = [{ node: this.root }];
  }
  restore(keys: unknown, children: (node: N) => readonly ExplorerTarget<N>[]) {
    this.reset();
    if (!Array.isArray(keys)) return;
    for (const key of keys.slice(0, 32)) {
      const hit = children(this.current).find((hit) => hit.key === key);
      if (!hit) break;
      this.enter(hit);
    }
  }
}
