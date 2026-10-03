# Рассказ с исследованием

Начни с ближайшего готового рисунка; общая оболочка уже подключена:

```sh
node scripts/scene.mjs new /absolute/output/story --example explorer-svg --no-audio
# Для вращаемого объёма: --example explorer-3d
cd /absolute/output/story
npm install
npm run dev
```

`dev` пересобирает исходник при правке и возвращает страницу к текущему времени на паузе.
При ошибке остаётся последняя рабочая сборка с сообщением. `?cue=move_x` или `?t=8`
открывает конкретное место. `npm run build` создаёт `dist/`; `npm run preview` показывает
готовую сборку. `npm run pack` сохраняет автономный `artifacts/story.html`.

Меняй `narration.json` (реплики и действия), `scene.js` (модель и рисунок).
`npm run audio` создаёт голос и `timeline.json`, затем убирает тихий режим.
Сначала закончи один смысловой шаг с настоящим голосом; затем разворачивай рассказ.
[Формат реплик и меток](narration.md) нужен при подготовке озвучки.

## Один путь от времени к рисунку

```js
import { SceneShell, surface, object, lettering, ViewportSVG } from '@visual-storytelling/core';
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
  const mark = object(drawing.layer, 'moving', 'blue');
  drawing.pen.rect(mark.content, 'tile', -20, -20, 40, 40, { fill: 'marker' });
  const value = lettering(mark.content, '0', { y: 7, size: 20, maxWidth: 30 });
  const camera = ViewportSVG.mount(drawing.element);
  shell.attachView(camera);
  const overview = { target: { x: 0, y: 0, w: 360, h: 320 }, padding: 20 };
  const controller = shell.attachStory({
    audio: root.querySelector('[data-audio]'),
    script: timing,
    stateAt: (frame) => ({ x: 100 * frame.progress('move_x') }),
    render(state) {
      mark.at(70 + state.x, 150);
      value.text(Math.round(state.x));
      camera.shot(overview);
    },
  });
  // Дополнительное предметное действие использует controller.explore({...controller.values, x: 50}).
  // root.scene уже содержит seek, pause, review, snapshot, currentTime и dispose.
})();
```

Поля автоматически читают одноимённые ключи `stateAt` и меняют их через `story.explore`.
Ключ параметра должен существовать в состоянии. Голос останавливается при изменении
модели; «Рассказ» восстанавливает пример текущего времени. Тот же `render(state, frame, mode)`
обслуживает оба режима. `frame.progress(id)` — действие, `reveal(id)` — декоративное письмо,
`finished(id)` — момент получения результата. Вычисляй весь кадр, включая скрываемые части.

Для заголовка с выбором главы добавь короткое `title` нужным сегментам `narration.json`.
Оболочка использует их готовое время; отдельный словарь глав и обработчики плеера не нужны.
Пигменты `ink/blue/orange/purple/green/red/yellow` совпадают в рисующих API и CSS.
`root.scene.snapshot` можно заменить предметным снимком для отчёта. При удалении сцены
`shell.dispose()` освобождает прикреплённые рассказ и камеру; свои наблюдатели освобождает сцена.
`notebook` использует ту же оболочку для типизированных примеров; см. [вектор](../examples/vector/index.ts).

## Сценарная камера и ручной осмотр

В `render` передай камере **объект или группу, контекст и ход перехода**:

```js
camera.shot({ target: [mark], padding: 36, from: overview, progress: frame.progress('focus') });
```

SVG-камера измеряет предметы вместе с подписями. Для сравнения величин сохраняй общую
шкалу: используй неизменные границы `overview`, чтобы увеличение данных не вызывало
автоматическое отдаление. Камера прибывает до объясняемого действия, удерживает его
результат и возвращает деталь в целое. Направление композиции определяется механизмом.

`attachView` добавляет «Вернуть ракурс» под переключателями и восстанавливает сценарную
камеру при перемотке. Жесты и клавиатура доступны во время голоса; ручной ракурс сохраняется
до возврата или перемотки. Камера получает время от рассказа, своих таймеров не заводит.
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
быть группа объектов или неизменный `T.Box3`. Дополнительные мировые точки подписей —
`anchors: [{position, padding: [halfWidth, halfHeight]}]`, занятое управление —
`insets: {top, right, bottom, left}` в пикселях.

`view.label(textOrFunction, anchor, options)` задаёт две пространственные роли: внешнее пояснение следует за постоянным якорем и обращено к зрителю, надпись на предмете участвует в его перспективе и перекрытиях.
Числам на Mesh задавай `face: 'front'` или явные грани `['front', 'back']`; для надписи в плоскости фигуры используй её дочерний `Object3D` с `space: 'world', height: 0.3` (мировые единицы).
Текст внутри геометрической фигуры и её обводка имеют общего владельца; рамку внешнего пояснения создавай через `frame`, чтобы она оставалась целой с текстом.
При вращении сохраняй привязки: числа остаются на поверхности, пересортировка подписей и автоматические выноски создают скачки и визуальный шум; читаемость обеспечивают композиция, ракурс и масштаб.
Пояснение закрепляй в локальной точке предмета через дочерний `Object3D` или `localToWorld`, как выше: экранная граница меняется с ракурсом и не служит пространственным якорем.
`size` задаёт экранный размер, `labelInsets: () => ({top, bottom})` оставляет место интерфейсу; контроллер обновляет надпись через `set/show/opacity/remove`.
После изменения модели вызывай `view.invalidate()`; `shot` делает это сам, средняя кнопка и Shift+левая переносят камеру.
`loadGLB(urlOrBuffer)` загружает обычный самодостаточный GLB; Draco/KTX2 требуют декодеров.

Для соединения рядов и арифметики используй общие `arrangeTensorRows`, `calculateTensorColumns` и `deliverTensorCells`: движущийся результат сам становится конечной ячейкой. `readableFrame` учитывает геометрию, экранные подписи и область заголовка/плеера; контракт и пример вызова находятся в [движении тензоров](../../docs/tensor-motion.md).

## Проверить результат

`npm run review -- --cue move_x` сопоставляет реплику, действие и промежуточные кадры.
Отчёт также указывает подписи, которым не хватило места при минимальном размере.
Проверь паузу, обратную перемотку, ручной ракурс при голосе, изменение модели и возврат;
для нового рисунка — 375 px, обе темы и reduced motion. Открой итоговый автономный HTML.
Принятый визуальный характер — [здесь](motion.md), общие владельцы — в [карте](scene-authoring.md#где-что-находится).
