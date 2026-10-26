# Минимальный авторский модуль

[Исполняемый counter](../../../tools/document-modules/counter/) показывает четыре
согласованных файла. Передай их одним `story_create(title, changes, requestId)`.
Этот рисунок подходит счётчику; для другой предметной формы сохрани manifest,
модель и lifecycle, выбрав построение по [авторскому маршруту](authoring-guide.md).

`story-project.json` — JSON-манифест, который связывает модуль и его исходники:

```json
{
  "version": 1,
  "modules": [{ "id": "counter", "model": "model.js", "subject": "drawing.js" }],
  "resources": []
}
```

`model.js` — проверка входов, чистое состояние и операция:

```js
export default {
  validateInputs(value) {
    if (
      !value ||
      Object.keys(value).some((key) => key !== 'count') ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0 ||
      value.count > 99
    )
      throw new Error('count: choose 0–99');
    return { count: value.count };
  },
  state: (inputs) => ({ ...inputs }),
  operations: { increment: (state) => ({ ...state, count: state.count + 1 }) },
  validateViews(views) {
    if (views.length !== 1 || views[0].kind !== 'counter') throw new Error('counter view required');
  },
  focusTargets: (_model, views) => views.map((view) => view.id),
};

```

`drawing.js` — рисунок и предметное управление на общем viewport:

```js
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

```

`story.json` — условия, представление и действие:

```json
{
  "version": 2,
  "models": [{"id":"items","module":"counter","inputs":{"count":2}}],
  "views": [{"id":"items-view","model":"items","kind":"counter"}],
  "chapters": [{
    "id":"add","title":"Добавим один",
    "beats":[{
      "id":"one","seconds":2,
      "operation":{"model":"items","name":"increment"}
    }]
  }]
}

```

Операция получает абсолютный прогресс: прямой и обратный seek дают один результат.
Рисунок читает переданный `state`; время и ввод принадлежат оболочке. Начни с
состояния 2, действия до 3 и ручного ввода 7. Затем расширяй свою предметную сцену.
Точечные правки существующего кода передавай через `story_edit(changes)` с `edits`,
объединяя связанные файлы в один вызов.

[Контракт модуля](document-modules.md) описывает `frame`, представления и прогноз.
[GPT](../../../examples/gpt-model/story-project.json) показывает вычисления и trace;
[непрерывный заказ](../../../tools/document-modules/continuous-order/story.json)
сохраняет одну модель через несколько эпизодов. Сборка исходников сохраняет
manifest, модули и pin runtime.
