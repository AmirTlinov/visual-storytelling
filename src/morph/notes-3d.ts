import { Object3D } from 'three';
import type { Viewport3D } from '../viewport/three.js';
import type { MathNote, MathPart, MathMorphFrame } from './types.js';

/** Inscriptions follow real mathematical parts; the viewport owns their lettering. */
export function mathNotes3D(view: ReturnType<typeof Viewport3D.mount>, parent: Object3D) {
  const labels = new Map<string, { anchor: Object3D; label: ReturnType<typeof view.label> }>();
  const clear = () => {
    for (const { anchor, label } of labels.values()) {
      label.remove();
      anchor.removeFromParent();
    }
    labels.clear();
  };
  return {
    clear,
    render(
      frame: MathMorphFrame,
      options: {
        visible: boolean;
        notes?: boolean | 'operators';
        inputNames?: (part: MathPart) => string | undefined;
      },
    ) {
      const input: MathNote[] = (options.inputNames ? frame.sources : []).flatMap((part) => {
        const text = options.inputNames!(part);
        return text && part.id
          ? [
              {
                id: `input:${part.id}`,
                text,
                position: [
                  part.position[0],
                  part.position[1] + part.size[1] / 2 + 0.5,
                  part.position[2],
                ] as const,
                size: [2.4, 0.58] as const,
                opacity: frame.morph <= 0.15 ? 1 : 0,
              },
            ]
          : [];
      });
      const notes = [...(frame.notes ?? []), ...input],
        ids = new Set(notes.map((note) => note.id));
      for (const [id, entry] of labels)
        if (!ids.has(id)) {
          entry.label.remove();
          entry.anchor.removeFromParent();
          labels.delete(id);
        }
      for (const note of notes) {
        if (!labels.has(note.id)) {
          const anchor = new Object3D();
          parent.add(anchor);
          labels.set(note.id, {
            anchor,
            label: view.label('', anchor, {
              space: 'world',
              height: note.size[1],
              maxWidth: note.size[0],
              ...(note.id.startsWith('input:') ? { tone: 'ink' } : {}),
            }),
          });
        }
        const entry = labels.get(note.id)!;
        entry.anchor.position.set(...note.position);
        entry.label.set(note.text);
        entry.label.opacity(note.opacity);
        entry.label.show(
          options.visible &&
            note.opacity > 0 &&
            (note.id.startsWith('input:') ||
              (options.notes !== false &&
                (options.notes !== 'operators' || note.id.startsWith('operator:')))),
        );
      }
    },
  };
}
