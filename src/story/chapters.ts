import { selectControl } from '../controls/fields.js';
import type { Chapter } from './cues.js';

/** The current chapter is the heading and opens its menu on the same story clock. */
export function chapterNavigation(
  heading: HTMLHeadingElement,
  chapters: readonly Chapter[],
  seek: (time: number) => void,
  enabled = !heading.hidden,
  label?: string,
) {
  const named = chapters.filter((chapter) => chapter.title).sort((a, b) => a.start - b.start);
  if (!named.length || !enabled) return { update(_id: string | undefined) {}, dispose() {} };
  const original = [...heading.childNodes],
    originalTitle = heading.title,
    abort = new AbortController();
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
  return {
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
    dispose() {
      abort.abort();
      control.menu.remove();
      heading.replaceChildren(...original);
      heading.title = originalTitle;
      heading.classList.remove('ve-chapter-navigation');
    },
  };
}
