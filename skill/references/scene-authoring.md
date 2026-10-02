# Новая сцена

Из каталога навыка:

```sh
node scripts/scene.mjs new /absolute/output/my-story --example area-story
cd /absolute/output/my-story
npm install
npm run build
npm run dev
```

Каталог должен быть пустым. Выбери пример из `examples/catalog.json` библиотеки: `area-story`, `remainder-story`, `fraction-of-a-set`, `equation-balance`, `threshold-neuron`, `bubble-sort`, `shared-memory`, `explorer-3d`, `explorer-svg`, `controls`, `logic-gates`, `geometric-tensor`, `parameter-cube`, `lc-oscillator`, `vector`, `materials`, `computer-explorer`, `neuron-explorer`.

Сцена получает предметные исходники, готовые данные и версионированный tarball `@visual-storytelling/core`; `npm install` создаёт lockfile. Меняй содержание в этой папке. `npm run build` собирает `dist/`, `npm run dev` открывает HTTP-сервер с перемоткой звука. Библиотека устанавливается зависимостью; её исходники и стили в сцену не копируются.

У примеров с предметным генератором SVG есть `npm run generate`: редактируй скопированный генератор и запускай эту команду перед сборкой страницы; общий стиль он получает из установленного пакета.

Принятые озвученные примеры включают готовый голос. Для новой темы укажи при создании `--no-audio`, отредактируй `narration.json`, затем выполни `npm run audio` и пересобери страницу. Общая оболочка описана в [шаблоне](scene-template.md), акустические метки — в [озвучке](narration.md).

## Где что находится

| Владелец в библиотеке | Ответственность |
| --- | --- |
| `examples/ИМЯ/scene.js` или предметный генератор | Модель, объекты, композиция, сценарий |
| `src/layout/svg.ts` — `SvgLayout` | Измерение, размещение, соединения и реакция на ширину |
| `src/ink/glyphs.ts`, `motion.ts` — `SketchMotion` | Форма букв, письмо и штрихи |
| `src/ink/marks.ts` — `SketchInk` | Устойчивые контуры, заливки и локальные окончания маркера |
| `src/styles/`, `src/assets/` | Одна палитра обеих тем, сетка, шрифты и оформление управления |
| `src/controls/` — `SketchControls`, `PlayerControls`, `SceneHistory` | Поля, кнопки, плеер и история действий |
| `src/story/` | Одни часы; адаптеры аудио, шагов и native SVG time |
| `src/scene.ts`, `src/viewport/` | Рассказ/исследование и трёхмерная поверхность |
| `tools/svg_style.py` | Встраивание тех же стилей и шрифта в автономный SVG |

```js
import '@visual-storytelling/core/style.css';
import { SketchInk, SketchMotion, SketchPlayer, SvgLayout } from '@visual-storytelling/core';
import timing from './timeline.json' with {type: 'json'};
```

Для SVG-генератора импортируй `svgRange` и `fitSvgControls` из `@visual-storytelling/core/controls`, `SketchInk` — из `@visual-storytelling/core/ink`. Генератор встраивает производный код пакета. Общие исправления делай у владельца в библиотеке, пересобирай пакет и его примеры; обновление отдельной сцены выполняется установкой нового tarball и сборкой.

Прозрачный фон и чернила обеих тем заданы общим CSS. Палитра `--ve-blue`, `--ve-orange`, `--ve-purple`, `--ve-green`, `--ve-red`, `--ve-yellow` выбирается по смыслу; `*-wash`/`*-soft` задают заливки. В SVG передавай цвет текста через `color`, рисунка — через `fill`/`stroke`. `.ve-scene` включает сетку; `data-paper="false"` нужен, когда сетка уже внутри SVG или этого требует замысел. После правки осевых букв пересобери WOFF2 через `uv run tools/build_pencil_font.py` из корня библиотеки.

## Компоновка

Дождись `document.fonts.ready`. Размещаемые подписи и предметы должны уже быть в SVG.
`SvgLayout.observe(svg, width => height)` сам ждёт шрифт, вызывает компоновку при
изменении ширины и выставляет `viewBox` и высоту. Возвращает `update()` и `dispose()`.
Узкую композицию перестрой рядами или столбцами, сохранив читаемый размер букв.
В задачах на измерение фигура и сетка используют одну единицу, шаг и начало координат:
для тетрадной клетки 5 мм это 1 см = 2 клетки и 1 см² = 2×2 клетки.
`--ve-grid-step`, `--ve-grid-x`, `--ve-grid-y` задают шаг
и начало фоновой сетки в CSS-пикселях относительно её контейнера. Масштабируй
фон и фигуру вместе; совмещай контуры с линиями, сохраняй сетку под заливкой.
Изменение параметров фигуры сохраняет начало и шаг сетки; пересчитывай их только при изменении размера области или явном масштабировании.
Центрируй изменяемую фигуру привязкой её края к ближайшей линии неподвижной сетки.

```js
const {element, place, row, beside, connect, along, observe} = SvgLayout;
const label = element('text', {}, 'Результат');
svg.append(label);
place(label, 200, 80);                 // центр измеренной надписи
row([a, plus, b], {x: 200, y: 140, gap: 12});
beside(label, object, {side: 'bottom', gap: 10});
const route = connect(leftCircle, rightCircle, {
  fromShape: 'ellipse', toShape: 'ellipse', gap: 2
});
wire.setAttribute('d', route.d);       // концы на границах предметов
along(weight, route, {at: .5, offset: -18});
```

`box(node, space)` измеряет преобразованный объект в координатах `space` (по
умолчанию корневой SVG). `beside`/`along` предполагают подпись в этом пространстве.
`place` и `row` владеют `transform` размещаемого элемента. Для движения внутри
композиции добавь внутреннюю группу; так размещение и анимация не перезаписывают друг друга.
Соединение измеряй по контуру узла, отдельно от его внешних подписей.

## Состояние и движение

Для перехода на новый ввод останови прежнее движение его владельца:

```js
gsap.killTweensOf(pose);
gsap.to(pose, {x: target.x, y: target.y, duration: .35,
  overwrite: true, onUpdate: render});
```

В reduced-motion сразу выстави конечную позу. Для рассказа создай
`gsap.timeline({paused: true})`. В `SketchPlayer.mount(...).render` вызывай
`animation.time(t, false)`: аудио задаёт `t`, GSAP рассчитывает позу.
Метки слов, письмо и восстановление кадра описаны в [озвучке](narration.md#метки-и-js).
`write(text, p)` создаёт штрихи в соседней группе, оставляя исходный `<text>`
для измерения. Для общего скрытия или движения оберни надпись в `<g>` и меняй
эту группу. После изменения текста вызови `SketchMotion.resetText(text)` и
пересчитай размещение.
Для локальных подписей используй `place`/`beside`. Подпись главы `data-caption` по умолчанию
имеет `sr-only`: экранный диктор получает контекст, видимое объяснение живёт в рисунке.

## Показ и проверка

```sh
npm run pack                       # самодостаточный story.html
npm run pack -- --inline            # компактная доставка для чата
npm run export -- --format mp4      # те же сцена и звуковая дорожка
```

Для показа в чате загрузи `$visualize`. Режим `--inline` сжимает звук в Opus и проверяет размер; при превышении лимита открой результат в браузере. Сохраняй атрибуцию звука. Примени [проверки формата](../SKILL.md#сделать-и-проверить) к конечной поверхности.

Галерея навыка собирается из тех же исходников: в корне библиотеки `npm run build && npm run preview`. После правки производных SVG сначала `npm run generate`. Превью пересоздаёт `npm run previews`; обновляй их после визуального просмотра.

Вложенные устройства и изменяемые симуляции: [камера, контуры и навигация](nested-explorer.md).
