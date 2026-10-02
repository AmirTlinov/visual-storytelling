# Visual Storytelling

TypeScript-библиотека аккуратных рисованных объяснений: плотные чернила, прозрачный маркер, локальные подписи и рассказ, согласованный с голосом. Визуальный контракт — [PHILOSOPHY.md](PHILOSOPHY.md).

Версия **0.1.1**: SVG/HTML, общие материалы и управление, метки слов, ручное исследование, экспорт SVG/PNG/HTML/MP4. Семь работающих примеров импортируют один пакет: площадь и остаток с голосом, сортировка с проходами и обменами, LC-контур с полями и графиками, матричное преобразование, общая память CPU/GPU и инструменты.

## Запуск

Нужен Node.js ≥ 22.18.

```sh
npm ci
npm run dev             # http://127.0.0.1:8793
npm run build           # dist/ — библиотека; site/ — автономная галерея
npm run check
npm test
npx playwright install chromium
npm run test:browser    # проверяет собранный site/, порт 8794
npm run test:delivery   # пакет в отдельном проекте и HTML без сети
```

## Использование в другом проекте

```sh
npm pack
# В проекте сцены:
npm install --save-exact /path/to/visual-storytelling-core-0.1.1.tgz
```

Пакет пока частный. Он работает с современным браузером и сборщиком ESM, например Vite; серверный рендеринг сцены не требуется. У зависимости и предметного исходника остаются свои владельцы: обновляй пакет, затем пересобирай результат.

```ts
import '@visual-storytelling/core/style.css';
import { notebook, surface, object, lettering, story } from '@visual-storytelling/core';

await Promise.all(
  ['Notebook', 'NotebookFallback'].map((font) => document.fonts.load(`400 24px ${font}`)),
);
const book = notebook(document.querySelector<HTMLElement>('#app')!, { title: 'Нарисуем квадрат' });
const view = surface(book.stage, {
  id: 'square',
  width: 400,
  height: 280,
  title: 'Квадрат',
  description: 'Четыре одинаковые стороны.',
  grid: { step: 50, x: 150, y: 50 },
});
const square = object(view.layer, 'unit', 'blue');
square.at(150, 50);
const shape = view.pen.rect(square.content, 'unit:shape', 0, 0, 100, 100, { fill: 'marker' });
const text = lettering(square.content, '1 см²', { x: 50, y: 57, size: 22 });
const explanation = story({
  script: { duration: 5, cues: { draw: { start: 0.3, end: 2 }, label: { start: 2.5, end: 3.5 } } },
  stateAt: (frame) => ({ draw: frame.reveal('draw'), label: frame.reveal('label') }),
  render: (state) => {
    shape.reveal(state.draw);
    text.write(state.label);
  },
});
book.attach(explanation);
// При удалении сцены: book.dispose(); view.dispose();
```

Для адаптивной геометрии используй `composition`: при изменении ширины она пересоздаёт рисунок, сохраняя часы и состояние рассказа. Полный пример — [площадь](examples/area/index.ts); параметры — [матрица](examples/vector/index.ts).

## Владельцы

| Область               | Источник                                                  | Ответственность                                                                                         |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Почерк и материалы    | [src/ink](src/ink)                                        | Пигменты обеих тем, посев случайности, перо, маркер, штриховка, письмо, сетка. Rough.js строит контуры. |
| Время и состояние     | [src/story](src/story)                                    | Метки слов, один источник времени, переключение рассказа и исследования. GSAP интерполирует значения.   |
| Управление            | [src/controls](src/controls), [notebook](src/notebook.ts) | Кнопки, параметры, одна строка плеера, фокус, освобождение обработчиков.                                |
| Приёмы объяснения     | [src/recipes](src/recipes)                                | Измерение, формула, матрица, вектор, график, доля, группировка, перестановка и передача.                |
| Адаптивная композиция | [composition](src/composition.ts)                         | Геометрия при изменении ширины; модель и часы сохраняются.                                              |
| Доставка              | [src/export](src/export), [tools](tools)                  | Самодостаточный SVG, упаковка HTML, кадры и кодирование видео.                                          |
| Предметное объяснение | [examples](examples)                                      | Математика, данные, смысловые шаги, реплики и уникальная геометрия.                                     |

Входы `./ink`, `./story`, `./controls`, `./recipes`, `./export` доступны отдельно. Формулы, графы и 3D получают дополнительные движки по потребности конкретной сцены; текущий пакет содержит две зависимости исполнения. [Архитектурные решения](docs/architecture.md), [контракт автора](docs/authoring.md), [источники и лицензии](THIRD_PARTY.md).

## Экспорт

После `npm run build`:

```sh
npm run export -- --scene area --format html --out artifacts/area.html
npm run export -- --scene area --format svg --time 48.2 --out artifacts/area.svg
npm run export -- --scene lc --format png --time .75 --theme dark
npm run export -- --scene area --format mp4 --fps 30 --width 960
```

PNG/MP4 используют Chromium; для MP4 также нужен `ffmpeg` в PATH. `--from` и `--to` задают отрезок видео, `--theme light|dark` — фон растрового результата. SVG сохраняет прозрачность. HTML включает шрифты и звук, открывается без сервера и по умолчанию следует теме интерфейса (`--theme auto`). Экспорт вызывает тот же `seek`, который использует плеер; видео получает исходную звуковую дорожку.

## Развитие

Меняй общий компонент у его владельца и сравнивай затронутые примеры с принятым видом в обеих темах и на узкой ширине; проверяй сохранение каждой объясняющей детали. Успешные проверки состояния дополняют просмотр рисунка и проигрывание рассказа. Проверяй смысловые моменты, обратную перемотку и характерные быстрые действия. `npm run profile` измеряет стоимость обновления рисунка и интервалы кадров; измерения сохраняются в `artifacts/performance.json`.

Фиксируй точную версию пакета в созданной сцене. Производные HTML, изображения и видео пересобирай из исходника. Новый общий приём подтверждай несколькими предметными применениями; заменённый код удаляй в том же изменении.

Существующая коллекция `~/.codex/skills/visual-explainer` продолжает работать отдельно. Её перенос на пакет выполняется целыми примерами с удалением прежних общих реализаций после перевода всех потребителей.
