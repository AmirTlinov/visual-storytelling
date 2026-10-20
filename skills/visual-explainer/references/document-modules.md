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
`drawing.ts` экспортирует default `StorySubjectRecipe`; рисунок читает модель. `create` получает `DrawingViewport`: геометрию `stage/layout` и, у интерактивного рисунка, заимствованные `input/attachView`. В сравнении доступны только геометрия и render. Управление, история и время принадлежат внешнему SceneShell.
ID модуля уникален и не заменяет встроенного владельца. В `story.json` укажи
тот же ID в `models[].module`; остальные ссылки и главы имеют общий формат v2.

Создай готовый документный проект, затем одной `story_edit(changes)` запиши
manifest, модули, ресурсы и полный `story.json`. Подготовка исполняет новый код
в браузере и сохраняет прежний исходник при ошибке. После первого рабочего кадра
`story_edit(operations)` использует validator этого модуля; save, undo, reopen
и HTML проходят прежний жизненный цикл. Не добавляй к manifest конкурирующие
`index.html`, `scene.js`, `scene.ts` или `scene.json`. Полный самостоятельный entry
создаётся без manifest через обычный исходный каркас.

Общий runtime предоставляет exports ink/recipes/story и `/three`, `SceneShell`,
`mountScene`, рациональную арифметику, QuantityPart, TensorData, MathMorph и Viewport3D. Компилируется авторский JS/TS; imports и ресурсы
остаются внутри immutable snapshot. Используй обычный
`new URL('../assets/parcel.svg', import.meta.url)`: общий asset owner замыкает SVG.
Классы тензоров и камер остаются теми же экземплярами общего runtime; отдельный пакет или плеер модулю не нужен.

Подготовленная presentation закреплена за runtime и кодом модуля. Семантическая
правка сохраняет компактный документ и переиспользует неизменяемый runtime и
ресурсы; отдельный HTML ей не нужен. Открытие карточки и выпуск собирают HTML из
того же сохранённого build. Не добавляй собственный cache или генератор HTML.

В story операции выполняются один раз от authored baseline. При переходе в
explore сохраняются вычисленные scalar inputs; ручной ввод не повторяет авторское
преобразование. `experimentState(inputs, authoredState, model)` нужен, когда опыт должен
сохранить визуальную фазу эпизода; иначе модель получает обычный state/staticState
новых условий. State/staticState и операции также получают model с актуальным ID; рисунок использует ID переданного model каждого render/validate, включая предварительное создание. Проверяй неидемпотентную операцию, обратный seek и смену режима.

Рабочие исходники: `tools/document-modules/route/` (иная сеть, TS и SVG),
`tools/document-modules/counter/` (операция «прибавить один»). Проверки:
`custom-story-project.test.mjs` и `plugin-custom-modules.test.mjs`.

`render(model, views, state, beat, moment)` получает общий `moment.frame` и режим.
Метку читай через `frame.reveal("chapter.beat")`; ручной опыт может показывать
завершённую форму того же рисунка. `resolveInput(patch, current, document, script, intent)`
возвращает новые scalar values и необязательное время из `script.cues`,
`resolveTime(values, authored, frame)` проецирует сценарные поля при seek.
Для предметного управления задай `controls: []`: параметры остаются доступны
модели и API, действия на рисунке вызывают `shell.input(patch)`. Протяжённое
перетаскивание объединяет `shell.inputGesture()`. Текст и числа редактируются
у своего объекта. Не выводи параметры отдельной формой. `navigation: false`
убирает общую строку режимов и заголовок, когда навигацией владеет рисунок.

Для прогноза beat задаёт `awaitInput:{model:"model-id"}`; модуль экспортирует
`canContinue(state, beat)`. Барьер воспроизведения исполняет общий Story.
Самостоятельное действие использует `viewport.input(patch)`; второй clock,
SceneHandle или store не создаётся. Рабочий полный пример —
[GPT](../../../examples/gpt-model/story-project.json).

`projectViews(state, selectedViews, model)` у model owner проецирует авторское
представление перед `experimentState`. У GPT одна representation на главу;
`calculation` раскрывает Q·K/√4, схема, геометрия и тензоры сохраняют тот же trace.
Отображаемые предметы регистрируются через `describeObject` с model/view IDs.

`intent:"restore"` нормализует полный checkpoint без сбросов нового ввода.
Для валидируемой строки `ControlParameter.commit:"change"` оставляет черновик
до Enter/blur. Пример — ввод собственной фразы GPT.

Если рисунку нужна холодная подготовка, `prepare(..., moment, signal)` готовит
скрытый candidate, не меняя принятые pixels или semantic objects. `ready(signal)`
ждёт существующий renderer; 3D использует `Viewport3D.whenRendered`. Своего RAF
или второго плеера модуль не добавляет.

`beat.focus` использует общий контур сцены. `focusTargets` модели должны совпадать
со стабильными `data-object` рисунка; `describeObject` добавляет предметный смысл.
Выбор зрителя и авторское внимание независимы. Частные рамки и focus API рецепта
для этого не нужны.

Замены документа последовательны. `scene_authoring_busy` означает, что предыдущая
замена ещё заканчивает подготовку или откат после отмены; повтори после её завершения.
При неудачном восстановлении кадра ввод приостановлен до успешной правки или открытия
сцены заново. Рисунок обязан учитывать AbortSignal и завершать свою подготовку.
