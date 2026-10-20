# Минимальный авторский модуль

Полный исполняемый пример ([counter](../../../tools/document-modules/counter/)) создаётся одним вызовом `story_create(title, changes, requestId)` без предварительного `story_help`. Передай `story-project.json`, `model.js`, `drawing.js` и `story.json` в одном массиве `changes`:

`story-project.json`:

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

`model.js` (`StoryModelModule` — проверка входов, чистое состояние, операции, представления и цели фокуса):

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

`drawing.js` (`StorySubjectRecipe` — входы модели `parameters` и рисунок `create(shell, model)`):

```js
import { surface, node } from '@visual-storytelling/core';
export default {
  title: 'Один шаг',
  parameters: (model) => [
    { key: 'count', label: 'Число', type: 'stepper', value: model.inputs.count, min: 0, max: 99, step: 1 },
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
    const mark = node(view, model.id, 0, { pigment: 'ink', size: 44, minSize: 44, width: 100, height: 80 });
    return {
      validate() {},
      render(_model, _views, state) {
        view.resize(shell.layout.width, shell.layout.height, false);
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
```

`story.json` (вход, представление и причинное действие):

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

Операция получает состояние и абсолютный прогресс: прямой и обратный seek дают один результат. Значения берутся из переданного `state`; `render` не изменяет документ. Точечные изменения существующего кода передавай через `story_edit` с `changes: [{ path: "drawing.js", edits: [{ oldString, newString }] }]`, собирая связанные правки в один вызов.

[Контракт модуля](document-modules.md) описывает предметный ввод, `frame`, представления и барьер прогноза. [GPT](../../../examples/gpt-model/story-project.json) показывает реальные вычисления, MathMorph и несколько ракурсов одного trace. [Непрерывный заказ](../../../tools/document-modules/continuous-order/story.json) сохраняет одну модель между связанными эпизодами.

Проверь: исходные 2 → операция 3 → ручной ввод 7 остаётся 7 → seek снова 3. Ошибка входа сохраняет прошлый рабочий кадр. Затем проверь редактирование через `story_edit`, undo, reopen и автономный HTML. В каждом случае остаются одни часы, плеер и SceneHandle. Сборка исходников сохраняет manifest, модули и pin runtime.
