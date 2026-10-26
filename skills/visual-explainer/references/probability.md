# Вероятности и выборка

Для относительных оценок используй `probability`. Для погрешности доли успехов —
отдельный опыт `sampling`. У обоих один Story, история условий и набор ресурсов.

```json
{ "recipe": "probability", "inputs": { "scoreA": 0, "scoreB": 1, "scoreC": 2, "temperature": 1 } }
```

`scoreA/B/C` находятся в пределах −1000…1000, температура — 0,1…10. Рисунок
показывает оценки, затем веса `exp((s − max)/T)`, затем доли с общим масштабом
0…1. Меняй одну оценку: все три доли зависят от общего знаменателя. Softmax
выражает относительное предпочтение модели; он не доказывает истинность ответа.

```json
{ "recipe": "sampling", "inputs": { "percent": 50, "count": 20, "seed": 42 } }
```

`percent` — известная вероятность учебной модели, `count` — 1…1000 наблюдений,
`seed` — uint32, включая 0. Рассказ постепенно открывает накопленную долю,
затем двусторонний 95% интервал Уилсона без поправки на непрерывность. До первого
наблюдения оценки и интервала нет. Ноль успехов сохраняет ненулевую верхнюю
границу. Новый seed задаёт другую воспроизводимую выборку; увеличение count
сохраняет прежний префикс при тех же p и seed.

95% описывает приблизительную частоту покрытия при повторных независимых
выборках. Не называй это вероятностью нахождения фиксированной p внутри уже
полученного интервала. LCG32 — раскрытый учебный псевдослучайный генератор;
симуляция не является наблюдением реальных людей или событий.

Операции вероятностей: `scores`, `weights`, `normalize`; выборки: `setup`,
`sample`, `interval`. Каждая выполняется один раз в этом порядке. Без своих
глав приём даёт 6 секунд, `chapters:[]` создаёт статический опыт. ID модели по
умолчанию совпадает с recipe; окончательные ID представлений и глав бери из
нормализованного документа. Автоматические имена обходят авторские ID.

Источники и границы находятся в `StoryDocument.resources`, ссылки модели —
в `model.resources`. Ресурс содержит `id/title/kind/description`, необязательные
`limits` и публичный HTTP(S) `url`; kind: simulation/model/data/method. Подробности
раскрываются в «Условия → Источники и границы». `set-resources` заменяет список
одной транзакцией; удаление используемой ссылки отклоняется. В компактных
приёмах дополнительные resources дополняют обязательное описание метода и
симуляции. Для собственных данных используй канонический документ с явными refs.

Для реальных logits в JS/TS:

```js
import { normalizeLogits, probabilityRows, probabilityBar } from '@visual-storytelling/core';
const trace = normalizeLogits(logits, temperature);
const rows = probabilityRows(trace, vocabulary, 6);
for (const [i, row] of rows.entries()) {
  probabilityBar(view, `candidate-${i}`, row.probability, {
    x: 240,
    y: 40 + 60 * i,
    width: 320,
    height: 24,
    size: 24,
    meaning: { label: row.label, value: () => row.probability, interactive: false },
  });
}
```

`normalizeLogits` выдаёт единый Float64 trace: scores, masked, shifted, weights,
probabilities, maximum, temperature и суммы. −Infinity задаёт явную маску;
JSON-safe trace сохраняет её отдельно от численного underflow. `softmax` —
однопараметровая форма для `matrix.map(softmax)`. `rankProbabilities` стабильно
упорядочивает индексы; `probabilityRows` объединяет непоказанный хвост в
«Остальные». Полоса занимает действительную долю общего масштаба; нулевое
значение не получает искусственную минимальную ширину. GPT-эталон использует
те же расчёт, порядок и рисунок полос.

Исходные числа выборки возвращают `sampleBernoulli(p,n,seed)` и
`binomialPrefix(sample,count)`: draws, успехи, оценку и интервал. График читает
эти значения; он не генерирует другую выборку и не пересчитывает статистику.

Проверенные источники метода: [SciPy softmax](https://docs.scipy.org/doc/scipy/reference/generated/scipy.special.softmax.html),
[SciPy Wilson](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats._result_classes.BinomTestResult.proportion_ci.html).
Рабочие проекты: `tools/document-modules/probability/` и `sampling/`.
