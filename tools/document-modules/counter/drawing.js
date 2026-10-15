import { surface, node } from '@visual-storytelling/core';
export default {
  title: 'Один шаг',
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
  create(shell, model) {
    const view = surface(shell.stage, {
      id: 'counter-view',
      width: shell.layout.width,
      height: shell.layout.height,
      title: 'Один шаг',
      description: 'Прибавляем один.',
      grid: false,
    });
    const mark = node(view, model.id, 0, {
      pigment: 'ink',
      size: 44,
      minSize: 44,
      width: 100,
      height: 80,
    });
    return {
      validate() {},
      render(_model, _views, state) {
        mark.value(state.count);
        mark.at(shell.layout.width / 2, shell.layout.height / 2);
      },
      snapshot: (state) => ({ ...state }),
      dispose() {
        mark.dispose();
        view.dispose();
      },
    };
  },
};
