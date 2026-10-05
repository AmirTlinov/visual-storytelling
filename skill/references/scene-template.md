# Рассказ с исследованием

Для морфингов и собственных моделей `MathMorph.model` используй [MorphStory](../../docs/morph-stories.md).
Задай `presenter: MathMorph` или `InkMorph`, параметры и операции глав: общая оболочка
свяжет их с метками, полями, камерой и перемоткой. [Числа и тела](../../examples/morph-story/scene.js),
[слова](../../examples/ink-story/scene.js), [связанная 2D/3D-модель](../../examples/gradient-descent/scene.js).

Начни с ближайшего готового рисунка; общая оболочка уже подключена:

```sh
node ../tools/scene.mjs new /absolute/output/story --example explorer-svg --no-audio
# Кубик → ряд → слой → объём: --example explorer-3d
# Согласованный морф форм, надписей и текста: --example written-morph
cd /absolute/output/story
npm install
npm run dev -- --port 0  # свободный порт; CLI печатает URL
```

`dev` пересобирает исходник при правке и возвращает страницу к текущему времени на паузе.
При ошибке остаётся последняя рабочая сборка с сообщением. `?cue=move_x` или `?t=8`
открывает конкретное место. `npm run build` создаёт `dist/`; `npm run preview` показывает
готовую сборку. `npm run pack` сохраняет автономный `artifacts/story.html`.

Точные сигнатуры установленной версии: `npx visual-story api SceneShell StoryOptions`,
`npx visual-story api Viewport3D`, `npx visual-story api lettering`.
Без имени команда перечисляет публичный API; `api ./three` — один модуль.
Ответ берётся из поставленных деклараций и указывает их настоящий путь.

Меняй `narration.json` (реплики и действия), `scene.js` (модель и рисунок).
`npm run audio` создаёт голос и `timeline.json`, затем убирает тихий режим.
[Формат реплик и меток](narration.md) нужен при подготовке озвучки.

Для постоянного тихого рассказа убери `<audio>` из HTML и параметр `audio` из `attachStory`;
задай `timeline.json` прямо в секундах, например:

```json
{
  "duration": 6,
  "cues": { "move_x": { "start": 1, "end": 4, "action": "Предмет проходит сто единиц вправо" } }
}
```

Общие часы, плеер, перемотка и отчёт работают так же. `segments` нужны только для реплик
и глав; их формат — `{id, start, end, text, title?}`. Паузы обозначай метками с `hold`.

## Один путь от времени к рисунку

```js
import { SceneShell, surface, node, ViewportSVG } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import timing from './timeline.json' with { type: 'json' };

window.galleryReady = (async () => {
  await SceneShell.ready(); // Запрашивает шрифты до измерения пустой сцены.
  const root = document.querySelector('.ve-scene');
  const shell = SceneShell.mount(root, {
    title: 'Заголовок',
    paper: false,
    parameters: [{ key: 'x', label: 'Положение', min: 0, max: 100, value: 0 }],
  });
  const drawing = surface(shell.stage, {
    id: 'path',
    width: 360,
    height: 320,
    title: 'Движение предмета',
    description: 'Предмет перемещается вправо по измерительной сетке.',
  });
  const mark = node(drawing, 'moving', 0, { shape: 'rect', width: 48, size: 20 });
  const camera = ViewportSVG.mount(drawing.element);
  shell.attachView(camera);
  const overview = { target: { x: 0, y: 0, w: 360, h: 320 }, padding: 20 };
  const controller = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt: (frame) => ({ x: 100 * frame.progress('move_x') }),
    render(state) {
      mark.at(70 + state.x, 150);
      mark.value(Math.round(state.x));
      camera.shot(overview);
    },
  });
  shell.onDispose(drawing.dispose);
  // Дополнительное предметное действие использует controller.explore({...controller.values, x: 50}).
  // root.scene уже содержит play, seek, pause, review, snapshot, currentTime и dispose.
})();
```

Поля автоматически читают одноимённые ключи `stateAt` и меняют их через `story.explore`.
Ключ параметра должен существовать в состоянии. Голос останавливается при изменении
модели; «Рассказ» восстанавливает пример текущего времени. Тот же `render(state, frame, mode)`
обслуживает оба режима. `frame.progress(id)` — действие, `reveal(id)` — декоративное письмо,
`finished(id)` — момент получения результата. Вычисляй весь кадр, включая скрываемые части.
Оболочка сама повторяет кадр при изменении размера сцены; отдельный `ResizeObserver`
для вызова `controller.update()` не требуется.
Зависимые числа задавай в `derive(values, frame)`, например
`derive: p => ({...p, z: p.x * p.weight + p.bias})`: он вызывается и при рассказе,
и при вводе. `render` и `root.scene.snapshot()` получают этот вычисленный кадр;
`controller.values` содержит только исходные параметры. Так ползунки автоматически
пересчитывают связанные подписи и рисунок.

Для нескольких допустимых значений вместо диапазона задай
`{key:'count', label:'Количество', type:'choice', value:2, options:[{value:2,label:'Два'}, {value:4,label:'Четыре'}]}`.
`type:'select'` сворачивает тот же выбор в меню; тип `value` сохраняется.
Фабрики SVG возвращают объект с `element`; `object.at(x,y)` задаёт размещение,
`move(dx,dy)` — относительное движение, `show(bool)` — общую видимость предмета и подписи.
Высоту SVG в оболочке задаёт соотношение `surface.resize(width, height)`; она следует композиции при изменении ширины.
`pen` возвращает `reveal(p)` и `dispose()`, `lettering` — `text(value)` и `write(p)`.
Передавай текущее состояние в каждом кадре: `surface.resize`, `reveal`, `text` и `write` сами пропускают неизменившиеся значения.
Параметры расширений доступны тем же `api`: `SketchControls`, `pen`, `StoryOptions`.

Для заголовка с выбором главы добавь короткое `title` нужным сегментам `narration.json`.
Оболочка использует их готовое время; при самостоятельном опыте показывает название всей
сцены, при возврате — текущую главу. Отдельный словарь глав и обработчики плеера не нужны.
Пигменты `ink/blue/orange/purple/green/red/yellow` совпадают в рисующих API и CSS; цветные `*-wash` и `*-soft` доступны также в `view.ink`.
`root.scene.snapshot` можно заменить предметным снимком для отчёта. `shell.dispose()`
освобождает рассказ, камеру и callbacks `shell.onDispose`: добавляй туда наблюдатели,
подписки и движение предмета. `controller.subscribe((mode, values) => …)` сразу сообщает
состояние и возвращает функцию отписки; `controller.onSeek(time => …)` сообщает целевое время до рендера.
`notebook.attach(controller)` возвращает тот же `SceneHandle`, опубликованный в `root.scene`; `notebook.onDispose` регистрирует очистку у оболочки — см. [вектор](../../examples/vector/index.ts).

## Превращение предметов

Вместо собственной хореографии создай `Morph.merge([Morph.box([1,1,1], 1), Morph.sphere(.5, 2)], Morph.capsule(.5, 2, 3))` и передай в `Morph3D.mount(view, operation)` или `Morph2D.mount(stage, operation, {id})`. В `render` достаточно `body.render(frame, 'merge')`; надпись, контакт и грани принадлежат телу. Для самостоятельных слов и абзацев — `await InkMorph.mount(stage, {sources, targets})` с тем же прогрессом. Для вычисления величин — `MathMorph`. [Рабочий исходник](../../examples/written-morph/scene.js), [контракт и примеры](../../docs/morphing.md).

## Рассказ → самостоятельный опыт → восстановление

[Полный SVG-пример](../../examples/explorer-svg/scene.js) уже содержит этот цикл.
При завершении голос останавливается на последнем кадре; «Исследовать» открывает поля.
Ручной поворот и масштаб доступны при голосе. Изменение входа переводит **модель** в опыт.
«Рассказ» и перемотка восстанавливают исходные значения выбранного времени.

Для сохранения используй `widgetState(id, restore)`: `read()` возвращает исходный снимок,
`save({modelContent?, privateContent?})` сохраняет его в хосте или локально,
`dispose()` снимает обработчик. Значения сцены остаются внутри `privateContent` любого JSON-типа.
Проверяй версию и диапазоны в `restore`; сохраняй из `onInput`, чтобы восстановление
не порождало новую запись. Пример сохраняет параметры и место рассказа, тихо восстанавливает
их через `seek` → `explore`, затем регистрирует `saved.dispose` в `shell.onDispose`.

Для скрипта Node, который проверяет модель и метки, импортируй `@visual-storytelling/core/story`;
корневой импорт также включает браузерные шрифты. Проверка синтаксиса и сборка — `npm run build`;
при ошибке CLI показывает файл и строку.

## Сценарная камера и ручной осмотр

В `render` передай камере **объект или группу, контекст и ход перехода**:

```js
camera.shot({ target: [mark], padding: 36, from: overview, progress: frame.progress('focus') });
```

SVG-камера измеряет предметы вместе с подписями. Для сравнения величин сохраняй общую
шкалу: используй неизменные границы `overview`, чтобы увеличение данных не вызывало
автоматическое отдаление. Камера прибывает до объясняемого действия, удерживает его
результат и возвращает деталь в целое. Направление композиции определяется механизмом.
При смене ракурса сохраняй геометрию: предмет выходит из кадра вслед за камерой.
Для разреза или изоляции детали покажи сам переход и обозначь, что скрывается.

`attachView` возвращает ракурс выбранного режима при каждом нажатии «Рассказ» или «Исследовать»,
включая повторное, и сценарную камеру при перемотке; повторное нажатие сохраняет время и воспроизведение.
Свободный ракурс сохраняй в пределах исследуемого пространства; смену пространства
показывай с понятным ориентиром и читаемым исходным видом (`view.reset()` возвращает сценарную камеру).
Камера получает время от рассказа, своих таймеров не заводит.
Для самостоятельно реализованного ракурса доступен `exploration: 'view'` с `onMode`.

## 3D

```js
import { Viewport3D, ThreeKit as T } from '@visual-storytelling/core/three';
const view = Viewport3D.mount(shell.stage, { label: 'Объём и его размеры' });
shell.attachView(view);
const cube = new T.Mesh(
  new T.BoxGeometry(1, 1, 1),
  view.ink(new T.MeshBasicMaterial(), 'blue-wash'),
);
view.setObject(cube);
view.label(() => '3.14', cube, { face: ['front', 'back'], tone: 'blue' });
view.label('Объём', () => cube.localToWorld(new T.Vector3(0, 1, 0)), {
  frame: { padding: [13, 6] },
});
// В render: view.shot({target: cube, direction: [0,0,1], padding: 36, from: overview3d, progress: frame.progress('focus')});
```

`shot` имеет тот же смысл, `direction` — направление от цели к камере; целью также может
быть группа объектов или неизменный `T.Box3`. Для объектов камера сама учитывает видимые подписи на дочерних якорях; при явном `T.Box3` или якорях-функциях дополнительные мировые точки задаются через
`anchors: [{position, padding: [halfWidth, halfHeight]}]`, занятое управление —
`insets: {top, right, bottom, left}` в пикселях.

`view.label(textOrFunction, anchor, options)` задаёт две пространственные роли: внешнее пояснение следует за постоянным якорем и обращено к зрителю, надпись на предмете участвует в его перспективе и перекрытиях.
Сводный итог всего опыта размещай в устойчивой области чтения, как в `explorer-3d`; локальные размеры остаются у измеряемых рёбер.
Числам на Mesh задавай `face: 'front'` или явные грани `['front', 'back']`; для надписи в плоскости фигуры используй её дочерний `Object3D` с `space: 'world', height: 0.3` (мировые единицы).
Текст внутри геометрической фигуры и её обводка имеют общего владельца; рамку внешнего пояснения создавай через `frame`, чтобы она оставалась целой с текстом.
При вращении сохраняй привязки: числа остаются на поверхности, пересортировка подписей и автоматические выноски создают скачки и визуальный шум; читаемость обеспечивают композиция, ракурс и масштаб.
Пояснение закрепляй в локальной точке предмета через дочерний `Object3D` или `localToWorld`, как выше: экранная граница меняется с ракурсом и не служит пространственным якорем.
`size` задаёт экранный размер, `labelInsets: () => ({top, bottom})` оставляет место интерфейсу; контроллер обновляет надпись через `set/show/opacity/remove`.
Если цвет обозначает величину, задай `view.ink(material, p => p.blue.clone().lerp(p.surface, model.fraction))`.
Функция вычисляет цвет при `invalidate()` и смене темы, включая паузу; ручное обновление того же материала не требуется.
После изменения модели вызывай `view.invalidate()`; `shot` делает это сам, средняя кнопка и Shift+левая переносят камеру.
`view.loadGLB(urlOrBuffer)` загружает самодостаточный GLB, включая Draco: декодер поставляется с библиотекой и работает офлайн. KTX2 требует отдельного настроенного загрузчика текстур; WebP поддерживается браузером.

Арифметикой владеет [MathMorph](../../docs/morphing.md); для перестановки уже существующих ячеек используй `arrangeTensorRows` и `deliverTensorCells`, сохраняя идентичность предметов. `readableFrame` учитывает геометрию, экранные подписи и область заголовка/плеера; контракт и пример вызова находятся в [движении тензоров](../../docs/tensor-motion.md).

## Проверить результат

`npm run review -- --cue move_x` сопоставляет реплику, действие и промежуточные кадры.
Отчёт также указывает подписи, которым не хватило места при минимальном размере. `token` и `matrix`
сжимают запись до читаемого минимума и сообщают о нехватке места: увеличь ширину ячейки
или покажи меньше ячеек; изменение значения повторно проверяет размер.
Проверь паузу, обратную перемотку, ручной ракурс при голосе, изменение модели и возврат;
для нового рисунка — 375 px, обе темы и reduced motion. Открой итоговый автономный HTML.
Принятый визуальный характер — [здесь](motion.md), общие владельцы — в [карте](scene-authoring.md#где-что-находится).

### Пространственный штрих

`InkStroke3D.create(view, points, {color: 'blue', width: 2.4, dashed: false})`
из `/three` возвращает `root`, `points(next)`, `draw(progress)` и `pointAt(progress)`. Добавь `root`
в группу `Viewport3D`; viewport владеет цветом, GPU и освобождением. `points` меняет
траекторию, `draw` ведёт штрих по её длине и сохраняет рамку всей кривой.
`pointAt` возвращает `[x,y,z]` в координатах `root` по той же длине: веди им перо,
сигнал или карточку вместе со штрихом. У пустого пути результат `undefined`.
Пустой след, одна точка, изменение числа точек, пунктир и обратная перемотка
поддерживаются тем же владельцем. Время передавай через `frame.reveal(cue)`.
[Копируемый пример](../../examples/ink-trace/scene.js) меняет число витков живого следа.
