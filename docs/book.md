# Рассказ, рисунок и персонажи

Начало: `visual-story new ./story --example tesla-circuit --no-audio`.
Меняй реплики и действия в `story.json`, модель и готовый рисунок — в `scene.js`.
`visual-story audio ./story` создаёт речь и метки из этого документа. Отдельный
`narration.json` для такого рассказа не нужен. Без голоса остаются смысловые подписи
и время для их чтения. Книга Tlinov появляется во вступлении и переходах.

## Готовый авторский вход

`IllustratedStory` из `@visual-storytelling/core/book` соединяет один документ,
подготовленный мир и словарь рисунков. Рабочие исходники:
[цепь](../examples/tesla-circuit/scene.js), [площадь](../examples/area-notebook/scene.js),
[термостат](../examples/thermostat-story/scene.js). `?variant` меняет одежду, рост,
декорацию и перспективу с прежними действиями.

```js
import { IllustratedStory } from '@visual-storytelling/core/book';
import { chibi, teachingRoom } from '@visual-storytelling/core/characters';
import { circuitDiagram } from '@visual-storytelling/core/recipes';
import document from './story.json';

await IllustratedStory.mount(root, {
  document,
  world: {
    pack: chibi,
    set: teachingRoom(),
    cast: { hero: { skin: 'tesla-workshop', at: 'entry', scale: 0.8 } },
  },
  parameters: [{ key: 'closed', label: 'Цепь замкнута', type: 'toggle', value: true }],
  drawings: {
    circuit: {
      title: 'Путь энергии',
      controls: ['closed'],
      size: { width: 640, height: 250 },
      create: circuitDiagram,
      valuesAt: (frame) => ({ closed: frame.beat?.id !== 'open' }),
    },
  },
  script,
  audio, // необязательны; подготовлены visual-story audio
});
```

Документ содержит `title` и `chapters`. У главы — `id`, `title`,
`view: 'cast' | 'paper'`, `drawing`, `beats`; `surface` указывает предмет,
по умолчанию `board`. Каждый beat задаёт `id`, `say`, `text` и обычные `perform`,
`actors`, `shot`. `say` произносится, `text` описывает видимое действие.
Метки образуются как `chapterId.beatId`. `narration` настраивает voice, intro,
outro, pause и music. Пауза между главами оставляет место перелистыванию.

```json
{
  "id": "open",
  "say": "Разомкнём цепь. Лампа погасла.",
  "text": "Герой указывает на разрыв цепи.",
  "perform": [{ "action": "point", "actor": "hero", "target": "board.content" }],
  "shot": { "focus": ["board.content"], "framing": "detail" }
}
```

`seconds` обычно вычисляется из пути, фаз действия и речи. Длинная реплика
удерживает завершённую позу; она сохраняет естественный темп ходьбы.
Слишком короткое речевое окно сообщает требуемую длительность. Явный `seconds`
задаёт намеренный ретайминг. Граница каждого действия остаётся меткой речи.

## Один рисунок в разных местах

`create(view)` возвращает `render(frame, viewport)`, необязательные `snapshot`
и `dispose`. Используются существующие Surface, Ink и recipes. Frame содержит
локальные `time`, `progress`, `beat`, `mode`, `reduced`, `values` и `input(changes)`.
`input` редактирует параметры общей сцены, приостанавливая рассказ.
`valuesAt` принадлежит рассказу; исследование сохраняет пользовательские значения.

Подготовлены `areaDiagram`, `circuitDiagram`, `flowDiagram`, `comparisonDiagram`.
Первый сохраняет общую сетку: 1 см = 2 клетки, 1 см² = 4 клетки. Поток сам размещает
узлы и связи, сравнение использует общую неизменную шкалу. Новая тема добавляет
предметную модель; геометрия рук, камера и управление остаются библиотечными.

`CharacterStageOptions.surfaces` принимает те же рисунки по ID предмета.
У доски плоскость готова; у раскрытой книги она движется со страницей;
переносимое письмо или прибор сохраняет рисунок в руке. Собственная мебель задаёт
`surface.corners` в своих локальных метрах. Глубиной и вводом владеет мир:
рисунок находится под пальцами и закрывающими его предметами.

Без `size` рисунок адаптируется к видимому месту; с `size` сохраняет заданные
логические единицы. `objectId.content` доступен для `point`, `shot.focus` и инспекции.
`capture()` фиксирует весь кадр. При живых DOM-поверхностях отдельный GPU canvas
содержит лишь часть проходов и не является снимком сцены.

## Другие виды глав

`Storybook` принимает готовые главы персонажей и произвольные `SceneChapter`.
`SceneStory` использует те же главы без оформления книги. Время, речь, параметры,
субтитры и экспорт у них общие. `inkChapter` сохраняет живой SVG; `create` может быть
асинхронным. `size` фиксирует логический viewport, иначе размеры приходят в CSS px.

`physicsChapter` из `./physics/2d` принимает `setup(world, ink, view)` и сам подключает
`PhysicsReplay`, обратную перемотку, снимок и освобождение ресурсов.
[Письмо из мастерской](../examples/interaction-studio/scene.js) показывает предметы,
математику и этот физический опыт в одном рассказе.

Собственное представление задаёт `mount → render/capture/snapshot/dispose`, при
необходимости `focus` и `reset`. `capture` фиксирует состояние до первого `await`.
Внешний Script и локальные метки совмещаются по именам; порядок и границы проверяются.
`chapter` и `sceneTime` зарезервированы общей оболочкой.

## Проверка и выпуск

`scene.inspect()` возвращает главу, предметное состояние, параметры и фактическую
читаемость кадра. `visual-story session URL control --commands '[{"type":"cue",
"id":"workshop.open","progress":0.7}]'` показывает выбранное действие в открытом dev.
`visual-story review DIST --width 375 --theme dark` проверяет кадры и движение.
`visual-story deliver DIRECTORY --formats mp4,html,srt,vtt` выпускает одну историю.
