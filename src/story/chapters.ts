import { SketchControls } from '../controls/fields.js';
import type { Chapter } from './cues.js';

/** Named segments navigate the existing clock and replace the static heading. */
export function chapterHeading(
  heading: HTMLHeadingElement,
  chapters: readonly Chapter[],
  seek: (time: number) => void,
) {
  const named = chapters.filter((chapter) => chapter.title).sort((a, b) => a.start - b.start);
  if (!named.length) return { update(_time: number) {}, dispose() {} };
  const original = heading.textContent;
  const field = SketchControls.field(
    {
      label: 'Глава',
      type: 'select',
      value: 0,
      options: named.map((chapter, i) => ({ value: i, label: chapter.title! })),
    },
    (index) => seek(named[Number(index)]!.start),
  );
  heading.classList.add('ve-chapter-heading');
  heading.replaceChildren(field.element);
  return {
    update(time: number) {
      const index = Math.max(
        0,
        named.findLastIndex((chapter) => chapter.start <= time),
      );
      if (field.value !== index) field.setValue(index);
    },
    dispose() {
      field.dispose();
      heading.classList.remove('ve-chapter-heading');
      heading.textContent = original;
    },
  };
}
