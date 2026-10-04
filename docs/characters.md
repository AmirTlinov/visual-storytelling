# Персонажи и постановка

`@visual-storytelling/core/characters` — готовые риги, SVG-облики, декорации и предметы.
Начальная семья **Chibi** сохраняет принятый рисунок Теслы: 44 родные кости,
ограничения, сетки и порядок деталей. Доступны Tesla/Mira, 24 родных клипа и 14 подготовленных действий.
Три плоских фона и три семейства декораций с общей перспективой переиспользуют тот же риг. [Каталог возможностей](../src/assets/characters/chibi/pack.json)
и `visual-story characters --json` дают точные имена.

```sh
node tools/scene.mjs new /absolute/my-story --example chibi-tesla
cd /absolute/my-story
npm install
npm run dev
```

Меняй `cast`, `set` и `beats` в одном `scene.js`.
[Тесла](../examples/chibi-tesla/scene.js), [Мира](../examples/chibi-garden/scene.js)
и [два героя](../examples/chibi-transfer/scene.js) используют один исполнитель.

```js
import { CharacterStory, chibi, laboratory } from '@visual-storytelling/core/characters';

window.galleryReady = CharacterStory.mount(root, {
  title: 'Нашлось решение',
  description: 'Учёный размышляет, находит решение и радуется.',
  pack: chibi,
  set: laboratory(),
  cast: { scientist: { skin: 'tesla', at: 'center' } },
  beats: [
    { id: 'question', seconds: 3, text: 'Ищет решение.', actors: { scientist: 'think' } },
    {
      id: 'answer',
      seconds: 3,
      text: 'Лампа загорается.',
      actors: { scientist: 'idea' },
      props: { lamp: { values: { light: 1 } } },
    },
    { id: 'joy', seconds: 2, text: 'Радуется.', actors: { scientist: 'celebrate' } },
  ],
});
```

Эпизод задаёт смысл и длительность. Из него получается обычный `Script`;
`SceneShell` ведёт плеер, главы, перемотку, reduced motion и экспорт.
Для озвучки передай `audio` и выровненный `script` с теми же ID меток:
его время заменит `seconds`. Пропущенный герой продолжает действие,
пропущенный предмет сохраняет состояние. `remember` включает сохранение позиции.
У изменения предмета `delay` и `over` задают задержку и длительность внутри метки:
`{delay: .35, over: .25, values: {light: 1}}` быстро зажигает лампу и удерживает результат.

## Размещение и действия

Для новой истории с движением начни с `new --example chibi-reading`,
`chibi-partners` или `chibi-adventure`. `visual-story characters --json` возвращает
точные имена, предметы, точки и аргументы действий из общего `stagingCatalog`.

```js
import { CharacterStory, chibi, readingRoom } from '@visual-storytelling/core/characters';
await CharacterStory.mount(root, {
  title: 'Тихая глава',
  pack: chibi,
  set: readingRoom({ theme: 'library', seat: 'chair' }),
  cast: { reader: { skin: 'tesla', at: 'entry', scale: 0.8 } },
  beats: [
    {
      id: 'take',
      seconds: 5,
      text: 'Берёт книгу.',
      perform: [{ action: 'take', actor: 'reader', object: 'book' }],
    },
    {
      id: 'sit',
      seconds: 4,
      text: 'Устраивается поудобнее.',
      perform: [{ action: 'sit', actor: 'reader', seat: 'seat' }],
    },
    {
      id: 'read',
      seconds: 7,
      text: 'Листает страницы.',
      actors: { reader: 'think' },
      perform: [{ action: 'read', actor: 'reader', book: 'book', pages: 3 }],
    },
    {
      id: 'put',
      seconds: 5,
      text: 'Возвращает книгу.',
      perform: [{ action: 'put', actor: 'reader', onto: 'sideTable' }],
    },
  ],
});
```

| Намерение                    | `perform`                                                                |
| ---------------------------- | ------------------------------------------------------------------------ |
| Идти, бежать, убегать        | `action: 'walk' / 'run' / 'flee', actor, to`                             |
| Сесть / встать               | `action: 'sit', actor, seat` / `action: 'stand', actor`                  |
| Взять, читать, вернуть книгу | `take: actor, object` / `read: actor, book, pages?` / `put: actor, onto` |
| Открыть дверь                | `action: 'openDoor', actor, door`                                        |
| Подняться по лестнице        | `action: 'climb', actor, stairs`                                         |
| Указать / нажать             | `action: 'point' / 'press', actor, target`                               |
| Дать пять / идти за руки     | `action: 'highFive', actors: ['a','b']` / `walkTogether: actors, to`     |

`actors` задаёт выражение вместе с движением: `scared` — страх, `cry` — отчаяние,
`think`, `idea`, `celebrate` и остальные имена есть в каталоге. Свободный герой
исполняет весь родной клип; при контакте движение сохраняет опору и захват, а эмоция
управляет лицом. На эпизод у героя один владелец `perform`.

`readingRoom` принимает `theme: library | laboratory | classroom`, `seat: chair | bench`,
`furnitureScale`, `depth`; `street` — `theme: town | park`, `depth`; `courtyard`
содержит дверь и лестницу. [Одна цепочка для двух разных героев](../examples/chibi-reading/scene.js)
выбирает Миру через `?variant=mira`, меняя только облик, рост и декорацию.

Готовые декорации задают `staging`: `projection`, именованные `spots`, `objects`.
`ground(x,z,height)` использует метры: x вправо, z в глубину, height над землёй.
`prepareSet(svg, projection, spots, objects)` собирает собственную площадку 960×650;
`project(projection, ground(...))` даёт координаты для её фонового рисунка.
Одни размеры предметов определяют контуры, сиденье, ручку, ступени и точки контакта.
Руки находят предмет, стопы ставятся на опору, перекрытия следуют глубине.

Называй места в декорации и используй их в `cast.at` и `to`. Книгу нужно взять или
сразу объявить через `cast.reader.holding`; после `put` она остаётся на столе.
Два владельца одной книги/сиденья, неизвестные точки и конфликтующие действия
отклоняются при подготовке. Новый предмет с собственным действием получает общую
геометрию и контакты в библиотеке один раз.

`shot: {focus: ['reader', 'book'], framing: 'medium'}` вписывает действительные
границы выбранных объектов; без `shot` камера сохраняет всю площадку и расширяет
кадр для вышедших за него героев. Плеер учитывает доступную высоту окна.
`scene.presentation()` сообщает обрезание и непроверенные canvas, `scene.snapshot()`
содержит положения, контакты рук и стоп. Проверяй также видимые переходы: геометрические
границы не оценивают выразительность позы.

Фронт, два поворота в три четверти и спина принадлежат одному Chibi-ригу.
Для спины компилятор применяет `character.json.views.back`; одежда сохраняет
задний рисунок. Сильно другое телосложение или новый ракурс требуют подготовки семьи
рига. Эти изменения затем переиспользуются всеми сценами.

## Новый облик

```sh
npx visual-story characters new scientist --from mira --out art/scientist
# Измени SVG или palette в art/scientist/character.json.
npx visual-story characters build art/scientist --out assets/scientist.json
```

В каталоге находятся редактируемые части и `sheet.svg` с их рабочими рамками.
`--from tesla` включает усы во всех 13 вариантах рта; `--from mira` даёт основу
без усов. Палитра заменяет цвета сразу в деталях. Для нескольких новых героев
передай несколько каталогов в `build`: они получат общий атлас.
Импортируй результат как JSON и передай его в `pack`; `skin` — ID из `character.json`.

Сохраняй размеры холста сетчатой детали: они являются её UV-рамкой.
Рисуй голову, причёску и одежду внутри этих рамок; компилятор отклоняет
несовместимые размеры до запуска. Риг уже владеет суставами и перекрытиями.
Для нового типа телосложения подготовь собственный совместимый пакет Spine,
его действия и якоря. Замена картинки сохраняет существующее движение и ракурс.

Исходники встроенных обликов — `src/assets/characters/chibi/{tesla,mira}`.
`npm run build` автоматически собирает их тем же компилятором, которым пользуется
`characters build`; `npm run build:characters` пересобирает только этот набор.

## Окружение и предметы

`StageSet` содержит размеры, фон и именованные точки. Везде x направлен вправо,
y вниз. `actor.at: 'center'` ставит стопы на точку декорации. `scale` масштабирует
весь риг, `flip` зеркалит его вместе с якорями. Герои упорядочены по глубине стоп.

`PropArt` — SVG с контактной точкой `(0,0)` и необязательным `paint` для числовых
каналов. Например, `bulb` имеет `light`, `seedling` — `growth`.
Имена градиентов используют `$id`: сцена сама делает их уникальными.
Предмет задаётся один раз, затем эпизоды меняют его каналы, прозрачность или место:

```js
props: { token: { art: spark, at: { actor: 'alice', anchor: 'hand-left' } } }
// В нужном эпизоде:
props: { token: { at: { actor: 'bob', anchor: 'hand-right' }, arc: 100 } }
```

Руки вычисляются после родных ограничений скелета; обратная перемотка возвращает
и позу, и контакт. `arc` задаёт высоту перелёта между движущимися якорями.
`layer: 'back' | 'front'` определяет перекрытие предмета всем составом героев.
Внутренним перекрытием пальцев вокруг предмета владеет специально подготовленный
слот рига; внешний SVG-предмет не заменяет такую анимацию захвата.

Добавляй новый предмет или декорацию в общий набор, когда ими пользуются разные
истории. Предметный механизм остаётся у своей модели; числовые каналы связывают
его с рисунком. Для изменения окружения не требуется новый исполнитель персонажей.

## Персонажи внутри существующего фильма

`CharacterStage` использует тот же исполнитель без плеера. Хост владеет временем:
рабочий пример — [персонажи и приближение модели](../examples/chibi-stage/scene.js).

```js
const actors = await CharacterStage.mount(host, {
  pack: chibi,
  set: workshop(),
  background: false,
  cast: { narrator: { skin: 'tesla', at: 'left' } },
  beats: [
    {
      id: 'intro',
      seconds: 15,
      text: 'Учёный приветствует зрителя.',
      actors: { narrator: 'wave' },
    },
  ],
});
shell.onDispose(actors.dispose);
// В существующем render(state, frame):
actors.show(frame.time < 15);
actors.render(frame.time, frame.reduced);
```

`canvas` содержит прозрачный слой героев. Его можно передать в `THREE.CanvasTexture`:
после `actors.render(time)` выставить `texture.needsUpdate = true` перед отрисовкой
основной 3D-сцены. Для плоскости задать прозрачный материал; размеры текстуры
следуют размерам `StageSet`. `show(false)` скрывает DOM, сохраняя возможность
рисовать текстуру. Хост освобождает свою текстуру и материал вместе с фильмом.
`background: false` исключает декорации, тени и внешние SVG-предметы из показа;
они остаются у сценографии фильма. У `CharacterStage` нет своего RAF и часов.

## Владельцы и проверка

`score.ts` связывает эпизоды с существующими метками, `performance.ts` сэмплирует
родные клипы по абсолютному времени, `stage.ts` рисует весь состав одним WebGL-контекстом,
`story.ts` подключает общую оболочку. `staging/blocking.ts` планирует действия,
`motion.ts` вычисляет их по времени, `pose.ts` решает контакты, `world.ts` рисует
предметы и героев в общем порядке. Сборщик обликов — `tools/characters/compile.mjs`.

Проверь характерные позы и переходы вперёд/назад, контакт с предметом и узкую ширину.
Новый облик проходит те же движения: подумать, озарение, радость, поднятая рука.
Принятый ориентир — [кадр Tesla](../examples/chibi-tesla/preview.png).

Spine runtime и остаточные изображения Chibi имеют собственные условия использования;
они сохранены в [THIRD_PARTY](../THIRD_PARTY.md). Встроенный пример содержит изображения
с запретом коммерческого использования. Замена всего рисунка и лицензия runtime
учитываются при подготовке коммерческого пакета.
