import type { Frame } from './cues.js';
import { interpolate } from './cues.js';
import { createStoryPointer } from './pointer.js';

type Target = HTMLElement | SVGElement;
export type StoryAction<K extends string = string> = {
  cue: K;
  target: Target;
} & (
  | {
      /** Edit input/textarea.value or textContent over the cue; from defaults to the preceding text. */
      type: 'type';
      text: string;
      from?: string;
    }
  | {
      /** Set data-story-pressed during the cue; result stays hidden until the cue ends. No click is dispatched. */
      type: 'press';
      result?: Target;
    }
  | {
      /** At cue start set native checked/option.selected, or aria-selected on other elements; true by default. */
      type: 'select';
      selected?: boolean;
    }
  | {
      /** Remove hidden and fade/slide into place over the cue; offset is 12px by default. */
      type: 'reveal';
      offset?: number;
    }
);
export interface StoryActionsOptions {
  /** Opt in to a seekable pointer, illustrated field focus/caret, and deterministic typing cadence.
   * Targets must be inside this container. No DOM focus or input/click events are dispatched. */
  pointer?: HTMLElement;
}

type State = {
  text?: string;
  children?: readonly ChildNode[];
  hidden?: boolean;
  opacity?: string;
  transform?: string;
  pressed?: string | null;
  reduced?: string | null;
  selected?: string | null;
  checked?: boolean;
  optionSelected?: boolean;
};
const input = (node: Target): node is HTMLInputElement | HTMLTextAreaElement =>
  node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement;
const readText = (node: Target) => (input(node) ? node.value : (node.textContent ?? ''));
const letters = (text: string) =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
    (s) => s.segment,
  );
const setAttribute = (node: Target, key: string, value: string | null) => {
  if (value === null) node.removeAttribute(key);
  else if (node.getAttribute(key) !== value) node.setAttribute(key, value);
};
let nextIdentity = 0;

/** Seekable illustrations of input → action → response. No synthetic clicks or extra clock. */
export function storyActions<K extends string>(
  steps: readonly StoryAction<K>[],
  options: StoryActionsOptions = {},
) {
  if (
    options.pointer &&
    steps.some((step) => step.type !== 'reveal' && !options.pointer!.contains(step.target))
  )
    throw new Error('Story pointer container must contain its action targets');
  const original = new Map<Target, State>();
  const initial = new Map<Target, State>();
  const assignedIds = new Map<Target, string>();
  let disposed = false;
  const identity = (target: Target) => {
    const existing = target.getAttribute('data-review-id');
    if (existing) return existing;
    const id = target.id || `story-action:${nextIdentity++}`;
    target.setAttribute('data-review-id', id);
    assignedIds.set(target, id);
    return id;
  };
  function own(target: Target, fields: State, before = fields) {
    original.set(target, { ...fields, ...original.get(target) });
    initial.set(target, { ...before, ...initial.get(target) });
    identity(target);
  }
  const textEnd = new Map<Target, string>();
  const compiled = steps.map((step) => {
    const { target } = step;
    let from = '',
      baseTransform = '',
      baseOpacity = 1;
    if (step.type === 'type') {
      const text = readText(target),
        children = input(target) ? undefined : [...target.childNodes];
      from = step.from ?? textEnd.get(target) ?? text;
      own(
        target,
        { text, children },
        { text: from, children: from === text ? children : undefined },
      );
      textEnd.set(target, step.text);
    } else if (step.type === 'press') {
      own(target, {
        pressed: target.getAttribute('data-story-pressed'),
        reduced: target.getAttribute('data-story-reduced'),
      });
      if (step.result)
        own(step.result, { hidden: step.result.hasAttribute('hidden') }, { hidden: true });
    } else if (step.type === 'select') {
      if (target instanceof HTMLInputElement && ['checkbox', 'radio'].includes(target.type)) {
        const peers =
          target.type === 'radio' && target.name
            ? [
                target,
                ...(target.getRootNode() as ParentNode).querySelectorAll<HTMLInputElement>(
                  'input[type=radio]',
                ),
              ].filter((p) => p.name === target.name && p.form === target.form)
            : [target];
        for (const peer of peers) own(peer, { checked: peer.checked });
      } else if (target instanceof HTMLOptionElement) {
        const select = target.closest('select');
        for (const peer of select?.options ?? [target])
          own(peer, { optionSelected: peer.selected });
      } else own(target, { selected: target.getAttribute('aria-selected') });
    } else {
      const transform = target.style.transform;
      const computed = getComputedStyle(target);
      baseTransform = computed.transform;
      baseOpacity = Number.parseFloat(computed.opacity);
      if (!Number.isFinite(baseOpacity)) baseOpacity = 1;
      if (baseTransform === 'none') baseTransform = '';
      own(
        target,
        { hidden: target.hasAttribute('hidden'), opacity: target.style.opacity, transform },
        { hidden: true, opacity: '0', transform },
      );
    }
    const before = letters(from),
      after = step.type === 'type' ? letters(step.text) : [];
    let common = 0;
    while (common < Math.min(before.length, after.length) && before[common] === after[common])
      common++;
    const edits = before.length - common + after.length - common;
    let total = 0;
    const stops = Array.from({ length: edits }, (_, i) => {
      const previous = after[common + i - (before.length - common) - 1] ?? '';
      total +=
        0.8 +
        ((i * 7) % 5) * 0.13 +
        (i === 0 ? 0.5 : 0) +
        (/\s|[.,;:!?]/u.test(previous) ? 0.75 : 0);
      return total;
    }).map((stop) => stop / total);
    return { step, before, after, common, stops, baseTransform, baseOpacity };
  });
  const pointer = options.pointer ? createStoryPointer(steps, options.pointer) : undefined;
  function apply(states: Map<Target, State>) {
    // Clear peer state before setting the selected radio/option, independent of DOM order.
    for (const [node, state] of states) {
      if (state.checked !== undefined) (node as HTMLInputElement).checked = false;
      if (state.optionSelected !== undefined) (node as HTMLOptionElement).selected = false;
    }
    for (const [node, state] of states) {
      if (state.children) {
        if (
          node.childNodes.length !== state.children.length ||
          state.children.some((child, i) => node.childNodes[i] !== child)
        )
          node.replaceChildren(...state.children);
      } else if (state.text !== undefined && readText(node) !== state.text) {
        if (input(node)) node.value = state.text;
        else node.textContent = state.text;
      }
      if (state.hidden !== undefined) node.toggleAttribute('hidden', state.hidden);
      if (state.opacity !== undefined) node.style.opacity = state.opacity;
      if (state.transform !== undefined) node.style.transform = state.transform;
      if (state.pressed !== undefined) setAttribute(node, 'data-story-pressed', state.pressed);
      if (state.reduced !== undefined) setAttribute(node, 'data-story-reduced', state.reduced);
      if (state.selected !== undefined) setAttribute(node, 'aria-selected', state.selected);
      if (state.checked) (node as HTMLInputElement).checked = true;
      if (state.optionSelected) (node as HTMLOptionElement).selected = true;
    }
  }
  return {
    render(frame: Frame<K>) {
      if (disposed) throw new Error('Story actions have been disposed');
      const states = new Map([...initial].map(([node, state]) => [node, { ...state }]));
      for (const { step, before, after, common, stops, baseTransform, baseOpacity } of compiled) {
        frame.target(step.cue, identity(step.target));
        if (step.type === 'press' && step.result) frame.target(step.cue, identity(step.result));
        const begun = frame.has(step.cue),
          p = frame.progress(step.cue);
        if (!begun) continue;
        const state = states.get(step.target)!;
        if (step.type === 'type') {
          const removed = before.length - common,
            changed = pointer
              ? stops.filter((stop) => stop <= p).length
              : Math.ceil(p * (removed + after.length - common));
          const text =
            changed < removed
              ? before.slice(0, before.length - changed).join('')
              : after.slice(0, common + changed - removed).join('');
          if (state.text !== text) {
            state.children = undefined;
            state.text = text;
          }
        } else if (step.type === 'press') {
          const finished = frame.finished(step.cue);
          state.pressed = finished ? null : 'true';
          state.reduced = frame.reduced ? 'true' : null;
          if (step.result) states.get(step.result)!.hidden = !finished;
        } else if (step.type === 'select') {
          const selected = step.selected ?? true,
            target = step.target;
          if (state.checked !== undefined) {
            if (
              selected &&
              (target as HTMLInputElement).type === 'radio' &&
              (target as HTMLInputElement).name
            )
              for (const [peer, s] of states)
                if (
                  peer instanceof HTMLInputElement &&
                  peer.type === 'radio' &&
                  peer.getRootNode() === target.getRootNode() &&
                  peer.name === (target as HTMLInputElement).name &&
                  peer.form === (target as HTMLInputElement).form
                )
                  s.checked = false;
            state.checked = selected;
          } else if (state.optionSelected !== undefined) {
            const select = (target as HTMLOptionElement).closest('select');
            if (selected && select && !select.multiple)
              for (const [peer, s] of states)
                if (peer instanceof HTMLOptionElement && peer.closest('select') === select)
                  s.optionSelected = false;
            state.optionSelected = selected;
          } else state.selected = String(selected);
        } else {
          const amount = frame.reduced ? 1 : p;
          state.hidden = false;
          const base = original.get(step.target)!;
          state.opacity = amount === 1 ? base.opacity : String(amount * baseOpacity);
          state.transform =
            amount === 1
              ? base.transform
              : `translateY(${interpolate(step.offset ?? 12, 0, amount)}px) ${baseTransform}`.trim();
        }
      }
      apply(states);
      pointer?.render(frame);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      apply(original);
      pointer?.dispose();
      for (const [target, id] of assignedIds)
        if (target.getAttribute('data-review-id') === id) target.removeAttribute('data-review-id');
    },
  };
}
