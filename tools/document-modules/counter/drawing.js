import { surface, notebookDrawing } from '@visual-storytelling/core';
export default {
  title: 'Один шаг',
  controls: [],
  navigation: false,
  parameters: (model) => [
    {
      key: 'count',
      label: 'Число',
      type: 'stepper',
      value: model.inputs.count,
      min: 0,
      max: 99,
      step: 1,
    },
  ],
  create(shell) {
    const view = surface(shell.stage, {
      id: 'counter-view',
      width: shell.layout.width,
      height: shell.layout.height,
      title: 'Один шаг',
      description: 'Меняйте число прямо на рисунке.',
      grid: false,
    });
    let drawing, lastKey;
    return {
      validate() {},
      render(_model, _views, state) {
        const { width, height } = shell.layout;
        const key = JSON.stringify([state.count, shell.layout]);
        if (key === lastKey) return;
        const active = view.element.contains(document.activeElement)
          ? document.activeElement?.dataset.action
          : undefined;
        view.resize(width, height, false);
        drawing?.dispose();
        drawing = notebookDrawing(view, shell.layout);
        const d = drawing,
          x = width / 2,
          y = height / 2;
        d.text(state.count, x, y + d.size / 3, { anchor: 'middle', size: d.size * 1.5 });
        if (state.count > 0)
          d.button('subtract', '−', x - 2 * d.hit, y - d.hit / 2, d.hit, () =>
            shell.input({ count: state.count - 1 }),
          );
        if (state.count < 99)
          d.button('add', '+', x + d.hit, y - d.hit / 2, d.hit, () =>
            shell.input({ count: state.count + 1 }),
          );
        d.settle();
        lastKey = key;
        if (active)
          (
            view.element.querySelector(`[data-action="${active}"]`) ??
            view.element.querySelector('[data-action]')
          )?.focus({ preventScroll: true });
      },
      snapshot: (state) => ({ ...state }),
      dispose() {
        drawing?.dispose();
        view.dispose();
      },
    };
  },
};
