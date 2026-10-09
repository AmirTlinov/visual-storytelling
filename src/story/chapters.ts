import { SketchControls } from '../controls/fields.js';
import type { Chapter } from './cues.js';

/** Compact chapter navigation shares the story clock and keeps the lesson heading intact. */
export function chapterNavigation(
  heading: HTMLHeadingElement,
  chapters: readonly Chapter[],
  seek: (time: number) => void,
  toolbar?: HTMLElement,
) {
  const named = chapters.filter((chapter) => chapter.title).sort((a, b) => a.start - b.start);
  if (!named.length || heading.hidden) return { update(_id: string | undefined) {}, dispose() {} };
  const navigation = document.createElement('nav');
  navigation.className = 've-chapter-navigation';
  navigation.setAttribute('aria-label', 'Главы рассказа');
  const field = SketchControls.field(
    {
      label: 'Глава',
      type: 'select',
      value: 0,
      options: named.map((chapter, i) => ({ value: i, label: chapter.title! })),
    },
    (index) => seek(named[Number(index)]!.start),
  );
  navigation.append(field.element);
  if (toolbar) toolbar.prepend(navigation);
  else heading.after(navigation);
  return {
    update(id: string | undefined) {
      const index = Math.max(
        0,
        named.findIndex((chapter) => chapter.id === id),
      );
      if (field.value !== index) field.setValue(index);
    },
    dispose() {
      field.dispose();
      navigation.remove();
    },
  };
}
