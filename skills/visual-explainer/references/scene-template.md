# Минимальный авторский модуль

Полный исполняемый пример: [counter](../../../tools/document-modules/counter/).
Его модель прибавляет один, рисунок использует общий SVG и input. Manifest:

```json
{
  "version": 1,
  "modules": [{"id":"counter","model":"model.js","subject":"drawing.js"}],
  "resources": []
}
```

`story.json` сохраняет вход, представление и причинное действие:

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

Модель экспортирует `validateInputs`, `state`, `operations`, `validateViews` и
`focusTargets`. Операция получает состояние и абсолютный прогресс: прямой и
обратный seek должны давать один результат. Рисунок экспортирует рецепт с
`parameters` и `create`; созданный объект имеет `validate/render/snapshot/dispose`.
Значения берутся из переданного state. `render` не изменяет документ.

[Контракт модуля](document-modules.md) описывает предметный ввод, `frame`,
представления и барьер прогноза. [GPT](../../../examples/gpt-model/story-project.json)
показывает реальные вычисления, MathMorph и несколько ракурсов одного trace.
[Непрерывный заказ](../../../tools/document-modules/continuous-order/story.json)
сохраняет одну модель между связанными эпизодами.

Проверь: исходные2 → операция3 → ручной ввод7 остаётся7 → seek снова3.
Ошибка входа сохраняет прошлый рабочий кадр. Затем проверь редактирование через
`story_edit`, undo, reopen и автономный HTML. В каждом случае остаются одни часы,
плеер и SceneHandle. Сборка исходников сохраняет manifest, модули и pin runtime.
