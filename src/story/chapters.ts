import { selectControl } from '../controls/fields.js';
import type { Chapter } from './cues.js';
const owners = new WeakMap<HTMLHeadingElement, () => void>();

/** The current chapter is the heading and opens its menu on the same story clock. */
export function chapterNavigation(
  heading: HTMLHeadingElement,
  chapters: readonly Chapter[],
  seek: (time: number) => void,
  enabled = !heading.hidden,
  label?: string,
) {
  const named = chapters.filter((chapter) => chapter.title).sort((a, b) => a.start - b.start);
  if (!named.length || !enabled)
    return {
      attach(target: HTMLHeadingElement) {
        owners.get(target)?.();
      },
      update(_id: string | undefined) {},
      dispose() {},
    };
  owners.get(heading)?.();
  let original = [...heading.childNodes],
    originalTitle = heading.title;
  const abort = new AbortController();
  const control = selectControl(
    {
      label: 'Глава',
      type: 'select',
      value: 0,
      options: named.map((chapter, i) => ({ value: i, label: chapter.title! })),
      ...(label && { format: () => label }),
    },
    (index) => seek(named[Number(index)]!.start),
    { signal: abort.signal },
  );
  heading.classList.add('ve-chapter-navigation');
  heading.replaceChildren(control.trigger);
  control.menu.classList.add('ve-chapter-menu');
  heading.after(control.menu);
  let selected = -1;
  const dispose = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    control.menu.remove();
    if (owners.get(heading) === dispose) {
      owners.delete(heading);
      heading.replaceChildren(...original);
      heading.title = originalTitle;
      heading.classList.remove('ve-chapter-navigation');
    }
  };
  owners.set(heading, dispose);
  return {
    /** Publish an already prepared control without recreating its menu or subscriptions. */
    attach(target: HTMLHeadingElement) {
      if (heading === target) return;
      if (heading.contains(control.trigger)) heading.replaceChildren(...original);
      heading.classList.remove('ve-chapter-navigation');
      if (owners.get(heading) === dispose) owners.delete(heading);
      owners.get(target)?.();
      heading = target;
      owners.set(heading, dispose);
      original = [...heading.childNodes];
      originalTitle = heading.title;
      heading.classList.add('ve-chapter-navigation');
      heading.replaceChildren(control.trigger);
      heading.after(control.menu);
      if (selected >= 0) heading.title = named[selected]!.title!;
    },
    update(id: string | undefined) {
      const index = Math.max(
        0,
        named.findIndex((chapter) => chapter.id === id),
      );
      if (selected === index) return;
      selected = index;
      control.setValue(index);
      heading.title = named[index]!.title!;
    },
    dispose,
  };
}
