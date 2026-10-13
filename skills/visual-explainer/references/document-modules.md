# Авторский модуль в общем документе

`story-project.json` объявляет одного владельца entry:

```json
{
  "version": 1,
  "modules": [
    { "id": "delivery-route", "model": "modules/model.ts", "subject": "modules/drawing.ts" }
  ],
  "resources": ["assets/parcel.svg"]
}
```

`model.ts` экспортирует default `StoryModelModule`: проверку scalar inputs,
чистое состояние и операции, допустимые views и focus targets. Вычисляемый
`ModelState` может содержать trace, граф и другие предметные данные.
`drawing.ts` экспортирует default `StorySubjectRecipe`; рисунок читает модель. `create` получает `DrawingViewport` (`stage`, `layout`); управление, история и время принадлежат внешнему SceneShell.
ID модуля уникален и не заменяет встроенного владельца. В `story.json` укажи
тот же ID в `models[].module`; остальные ссылки и главы имеют общий формат v2.

Создай готовый документный проект, затем одной `story_edit(changes)` запиши
manifest, модули, ресурсы и полный `story.json`. Подготовка исполняет новый код
в браузере и сохраняет прежний исходник при ошибке. После первого рабочего кадра
`story_edit(operations)` использует validator этого модуля; save, undo, reopen
и HTML проходят прежний жизненный цикл. Не добавляй к manifest конкурирующие
`index.html`, `scene.js`, `scene.ts` или `scene.json`. Полный самостоятельный entry
создаётся без manifest через обычный исходный каркас.

Подготовленный 2D runtime предоставляет существующие exports ink/recipes/story,
`SceneShell`, `mountScene`, точную рациональную арифметику, QuantityPart, TensorData, `leverState` и `compareModelSnapshots`. Компилируется авторский JS/TS; imports и ресурсы
остаются внутри immutable snapshot. Используй обычный
`new URL('../assets/parcel.svg', import.meta.url)`: общий asset owner замыкает SVG.
Другие движки подключаются через обычную исходную сцену.

В story операции выполняются один раз от authored baseline. При переходе в
explore сохраняются вычисленные scalar inputs; ручной ввод не повторяет авторское
преобразование. `experimentState(inputs, authoredState, model)` нужен, когда опыт должен
сохранить визуальную фазу эпизода; иначе модель получает обычный state/staticState
новых условий. State/staticState и операции также получают model с актуальным ID; рисунок использует ID переданного model каждого render/validate, включая предварительное создание. Проверяй неидемпотентную операцию, обратный seek и смену режима.

Рабочие исходники: `tools/document-modules/route/` (иная сеть, TS и SVG),
`tools/document-modules/counter/` (операция «прибавить один»). Проверки:
`custom-story-project.test.mjs` и `plugin-custom-modules.test.mjs`.
