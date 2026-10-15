# Владельцы

`@visual-storytelling/core` — исполняемый пакет и авторский комплект. `src/` содержит
библиотеку, `examples/` — предметные сцены, `tools/` — сборку и выпуск, `skills/visual-explainer/` —
инструкции. `dist/` и `site/` пересобираются. Установленный навык ссылается сюда.

## Сцена и управление

`mountScene` в `src/scene-handle.ts` регистрирует единственный `root.scene`.
Он сохраняет живые свойства и методы исходного владельца, добавляет
`inspect/find/control/presentation` и освобождает регистрацию при dispose.
`scene-access.ts` проверяет команды по фактическим возможностям сцены.

`scene/captions.ts` владеет одним элементом подписи, его разбиением и размещением.
Время получает от существующего transport; явный overlay входит в экспортируемый кадр.

`SceneShell` владеет полями, режимами, доступностью и жизнью представлений.
Статическая модель доступна агенту сразу после mount; подключение Story обогащает
тот же handle. UI и команды используют один ввод. `syncParameters` отражает правки
самостоятельной модели; `shell.input` ведёт пользовательскую правку через историю
и `Story.input`. `SceneStory` разрешает переход главы и её исходные условия.

`Story` вычисляет `stateAt → derive → render`; `transport` использует один media clock.
`requested` хранит принятый ввод, `presented` — завершённый кадр. `scene-checkpoint.ts`
сохраняет параметры, место и камеру; вложенные условия приходят от `runtime.subject`.
Для Story его предоставляет `checkpoint.encode/decode`. Тот же снимок передаётся
в widgetState, восстановление и экспорт; схема и проверка остаются у модели.
`SceneHistory` хранит undo/redo зрительских условий в текущем mounted-сеансе.
Checkpoint переносит сами условия; повторное открытие начинает новый стек.
Авторская история ревизий сохраняется отдельно в ProjectStore.
Восстановление отменяет предыдущую подготовку: Story принимает совместимые условия
и позицию вместе; при смене главы сначала получает её описания параметров.
`StepPlayer` переключает дискретные состояния, `SmilPlayer` управляет временем SVG,
`SimulationPlayer` ведёт живую модель. Их команды регистрируются в том же handle;
статическая модель не получает фиктивные секунды или play/seek.

## Представления

`math/` владеет `MathValue` и неизменяемыми `TensorData`: форма, оси и исходные
адреса сохраняются при выборе и перестановке. `viewport/tensor.ts` представляет
тот же снимок; `tensor-slice.ts` связывает выборку с источником и прогрессом Story.
`MathMorph` вычисляет результат и сохраняет адреса в `MathOrigin.source`.
Подписи, камера, доставка и семантика используют существующих владельцев.

| Область                      | Владелец                                                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Палитра, почерк, сетка, поля | `styles/`, `ink/`, `assets/`                                                                                                                                                                                                         |
| SVG и письмо                 | `SketchInk`, `SketchMotion`; измеряемые границы — `pen.contour`                                                                                                                                                                      |
| Слияние чернил               | `ink/fusion/`: штрихи, маски, сопоставление, контактные перемычки                                                                                                                                                                    |
| Морфинг                      | `morph/objects.ts`, `material.ts`, `timing.ts`; `MathMorph` / `InkMorph` ведут представление                                                                                                                                         |
| Морфологический рассказ      | `MorphStory` связывает операции, подготовку, главы и поля с Story                                                                                                                                                                    |
| Композиция объяснения        | `scene-frame.ts`: целый рисунок 16:9 и адаптация к размеру; `scene.ts`: композиция и плеер вне её масштаба                                                                                                                           |
| Размер текста                | `layout/content.ts`, `morph/ink-layout.ts`                                                                                                                                                                                           |
| Объёмные тела                | `viewport/morph/`: поле материала, геометрия и согласованный отклик                                                                                                                                                                  |
| 3D и камера                  | `Viewport3D` владеет GPU и готовностью кадра; `viewport/camera-view.ts` — ракурсом и checkpoint; `shots.ts` — геометрическим кадрированием; `shot-plan.ts` — authored from/to на clock Story. SVG-камера — `ViewportSVG`, `SvgOrbit` |
| Вложенный SVG                | `explorer/`: Surface, Camera, Highlight, Gestures, ScenePath                                                                                                                                                                         |
| Параметры и история          | `SketchControls`, `SceneHistory`; предметные ограничения — в модели                                                                                                                                                                  |
| Физика                       | `physics/`: Rapier; `PhysicsReplay` ведёт перемотку, `PhysicsPlayer` использует SimulationPlayer                                                                                                                                     |
| Состояние хоста              | MCP-оболочка владеет displayMode; `SceneHost.frameSizing` задаёт content/viewport, fit остаётся в sceneFrame; `SceneHost.widgetState` переносит `SceneCheckpoint`; модель владеет `subject`                                          |

`SceneStory` соединяет главы через Story. `SceneChapter.presentation` выбирает
тетрадный разбор (`explanation`) или полноформатную постановку (`stage`);
`SceneShell.setPresentation()` публикует этот вид вместе с готовым рисунком.
Персонажная глава занимает весь кадр без внешней тетрадной сетки. `composition-plan.ts` разрешает метки
и время; `composition-presentations.ts` ограничивает живые главы и освобождает
ресурсы; `composition-previews.ts` фиксирует только выбранную границу перехода.
Story владеет отменой подготовки и `ready()`, transport удерживает общие часы;
SceneHandle, команды и экспорт используют ту же готовность.
`story/document.ts` владеет `StoryDocument`, проекцией речи и тихой разметкой.
`IllustratedStory` соединяет документ с `SceneStory`; адаптер `characterChapter`
принадлежит `characters`. `characters/surfaces.ts` размещает живой SVG в декорации,
сохраняя его модель и интерактивность.

`characters/stage.ts` рисует позу по абсолютному времени. Three.js ведёт скелет glTF,
деформируемые поверхности и смешивание клипов; `score.ts` компилирует эпизоды, `staging/` — пути и контакты.
`CharacterSurface` и `inkChapter` используют один рисунок в декорации и на странице.
Риг и SVG-облики — `assets/characters`; компилятор атласа — `tools/characters/compile.mjs`.
`recipes/area.ts` согласует единицы рисунка и прозрачную сетку.

## Авторство и выпуск

`story/document-schema.ts` владеет единственным `StoryDocument` v2, ссылками и
чистыми операциями `set-inputs`, `set-views`, `set-chapters`. `document-timing.ts`
проецирует главы в существующие cue/composition и речевую разметку;
`document-model.ts` воспроизводит обычные JS-операции от начальных входов.
`IllustratedStory` подключает документ к `SceneShell` + `Story` либо к существующим
фабрикам `SceneStory`. Пустые главы создают статическую сцену. Переход между опытом
и рассказом сохраняет один handle и общие поля; отдельного JSON-executor нет.

`recipes/*-model.ts` владеют входами, чистыми операциями, допустимыми представлениями
и предметными ограничениями. `*-subject.ts` связывают модель с готовым рисунком.
`divisionStory` — авторское сокращение, которое один раз выдаёт тот же документ.
`math/division.ts` вычисляет группы и остаток; рисунок и формула читают одно состояние.

`plugin/projects.mjs` владеет исходником, `sourceRevision`, журналом транзакции,
повтором и отменой. `plugin/runtime/project-authoring.mjs` связывает подготовку,
принятие и доставку. `plugin/authored-candidate.mjs` фиксирует предложение вне
рабочего исходника; `plugin/build-preparation.mjs` проверяет его сборку.
`plugin/live-project.mjs` создаёт build receipt из снимка и готовой страницы runtime.
Kernel соединяет существующих владельцев; `plugin/session-directory.mjs`
меняет показанную сборку только после согласованного ответа кадра.
`shownSourceRevision` отражает наблюдённый показ и может отставать от исходника.
`prepared` и `rendered` различаются: готовность без кадрового подтверждения
не служит измерением задержки до изображения.

Создание, source edit и undo сначала собирают кандидата, затем ProjectStore повторно
проверяет исходник, identity и history cursor перед commit. Отказ подготовки
сохраняет принятую ревизию. Миграция использует свою проверенную сборку;
ошибка доставки после commit возобновляет публикацию этого артефакта.
Создание начинает историю с проверенного исходного проекта и сохраняет отдельный
receipt; первый undo относится к правке после создания. Готовность исходника
возвращается после принятия кандидата. Файловые переходы находятся в
`plugin/project-changes.mjs`, журнал и pin — в ProjectStore.

Карточка MCP принимает валидный частичный `document` как предварительный
показ тем же подготовленным приёмом. До результата создания у него нет
подтверждённой ревизии проекта. Финальный документ связывается с этим же iframe
и SceneHandle. Некорректный частичный ввод сохраняет последний связный кадр.

`tools/runtime-package.mjs` закрепляет физический неизменяемый выпуск в
`scene-runtime.json`; текущая версия плагина не подменяет этот выбор.
`runtime-reference.mjs` читает его идентичность без API/catalog payload; эти большие
файлы загружает явный запрос справки. Проверка доверия и API документа сохранена.
`tools/create-scene.mjs` сохраняет `story.json` и явный `story-project.json`.
Готовый приём не требует npm, esbuild или упаковки runtime на каждый запрос.
`story-project.mjs` проверяет единственное владение entry, ссылки модулей и ресурсов.
`prepare-story-project.mjs` собирает авторские модули с существующим владельцем
ресурсов; их imports связываются с общим подготовленным runtime ink/story/three. Модель исполняется
в Chromium worker, не в MCP/ProjectStore. Горячая проверка и замена требуют
совпадения runtime и module revision; другой код получает обычный candidate.
Самостоятельный JS/HTML entry использует стандартную сборку без документного manifest.
`plugin/build-payload.mjs` хранит тяжёлые части подготовленного HTML один раз по
хешу содержимого. Build содержит ссылки на эти части и собственный документ;
семантическая правка переиспользует presentation по runtime/module revision.
HTML восстанавливается и проверяется при attach, reload или выпуске. Cache
защищает payload и presentation base через существующие build leases. Старую
сохранённую карточку переводит в этот формат её открытие; GC ничего не мигрирует.
Одна ревизия переиспользует прежний проверенный receipt и здоровый input snapshot.
Повреждённые cache inputs восстанавливаются только из проверенного снимка той же
идентичности. Непривязанный receipt с утраченной зависимостью удаляет GC.
Готовый authored candidate передаётся живой сборке без второго копирования;
публикация передаёт ей владение inputs. Непринятые артефакты освобождает общий GC.
`work.payload` в ответе правки описывает работу presentation owner этой операции;
creation work сохранённого build остаётся прежним. Это не полный файловый IO.
`tools/story-html.mjs` находит места вставки по HTML-парсеру: строки внутри JS/CSS
не участвуют в поиске head/body.
`story_produce` и review используют
выбранный снимок через общий workflow. Переносимый исходный архив замыкает
зависимости и убирает машинный pin только в копии для выпуска.

`build-pages.mjs` собирает галерею и отдельные сцены. `assets.sceneInput` определяет
входы для сборки, наблюдения, копирования и доставки. `build-output.mjs` публикует
готовую сборку и сохраняет прежнюю при ошибке. npm определяет состав пакета;
`build-info.mjs` вычисляет его идентичность по фактически поставляемым файлам.
Генераторы, проекция речи и исходный архив используют пакет потребителя сцены.

`tools/audio/` владеет синтезом, выравниванием слов, монтажом и кэшем. Авторские
относительные пути сохраняются; байты голоса и музыки проверяются перед повторным
использованием. `story/spoken-words.ts` задаёт общую лексическую идентичность
для авторских occurrence и local/API adapter alignment. Ограничения языка
проверяет выбранный провайдер. `caption-source.mjs` получает подписи из общей дорожки.

`open-scene.mjs` выбирает одного зарегистрированного владельца для съёмки,
перемотки и команд. Для самостоятельного SVG без runtime используется native SMIL.
Каталог задаёт секунды через `time`, дискретные состояния — через `commands`.
`video-export.mjs` собирает MP4, `standalone.mjs` — HTML; `deliver.mjs` публикует
выбранные форматы. `scene-project.mjs` замыкает локальные зависимости исходного архива.

`tools/motion/` хранит захват в session, индексирует episodes и предоставляет
общую inspection для CLI/HTML. Анализ и сравнение читают сохранённые кадры.
Общие исправления доходят до сцен через сборку; сгенерированный runtime в SVG/HTML
остаётся результатом этого же пути.

## Зависимости и освобождение

`morph/plan.ts` содержит чистый план перехода, `body-geometry.ts` — общую
геометрию. Планирование не импортирует монтируемые представления. Конструкция
разделена по задачам: layout аннотаций, плоский рисунок, объёмная геометрия и их
композиция. `body-presentation.ts` обновляет только выбранную проекцию; при смене
вида сначала рисует актуальное время.

`lifecycle.ts` задаёт одну политику завершения: все освобождения выполняются;
одна ошибка сохраняет исходную идентичность, несколько возвращаются в
`AggregateError` в порядке возникновения. Регистрации и ресурсы остаются у своих
владельцев. Принятый MathMorph публикуется до освобождения прежнего рисунка;
ошибка завершения сохраняет новый результат и сообщает причину.

Kernel — точка композиции. Socket framing и drain принадлежат
`runtime/socket-server.mjs`, checkpoint storage — `session-storage.mjs`, bounded
cache — `cache-maintenance.mjs`, voice adapter — `plugin/voice.mjs`; политика
голоса остаётся в `tools/voice/settings.mjs`. ProjectStore, SessionDirectory и
JobRunner сохраняют свои состояния. `stageEdit` разрешает операцию один раз;
`commitPreparedEdit` повторно проверяет source/path/history fences перед journal.
Journal/recover публикует source, pin, историю, receipt и immutable assets.
Cache читает registry и leases журнала одной операцией той же очереди
ProjectStore; публикация registry не может пересечь этот снимок.
`runtime/project-refresh.mjs` сверяет файловое событие после авторской доставки
в её существующей очереди. Текущая подготовленная ревизия и уже запущенный job
исключают повторную сборку, включая промежуток до подтверждения показа.
ProjectWatch сохраняет dirty paths; rename, неизвестное событие, restart и ошибка
наблюдателя требуют полной сверки содержимого. Наблюдение восстанавливается после
ошибки; события во время callback остаются следующему проходу. Пока эта сверка
хеширует весь набор источников; targeted dependency checks имеют отдельный gate.
MCP `authoring-context.mjs` связывает ссылки в подписанный контекст; состояние
остаётся у существующих владельцев. ProjectStore проверяет source,
SessionDirectory — build/state/generation. Исторический receipt разрешается
до свежести новой операции. Карточка прикрепляет подтверждённый context.

Legacy `ExplanationDocument` и `mountExplanation`, неиспользуемые фасады notebook
и composition, неявный `globalThis.openai` и отдельная сборка prepared explanation
удалены из текущего API. Старые формы принимает только явный конвертер
`tools/migrate-story-document.mjs` на копии. Неизменяемые старые pins остаются
доступны своим проектам до миграции.

## Вероятности и источники

`math/probability.ts` владеет устойчивым softmax, порядком и суммой скрытого хвоста;
`math/binomial.ts` — воспроизводимыми наблюдениями, префиксом и интервалом Уилсона.
Предметные модели готовят trace, рисунки и подписи читают его. `probabilityBar`
задаёт общий масштаб 0…1; GPT переиспользует эти владельцы.

`story/resources.ts` проверяет происхождение и ограничения данных. Модели ссылаются
на ресурсы документа по ID. `scene/conditions.ts` владеет единственным раскрытием,
позиционированием и клавиатурным закрытием условий в обеих областях кадра.

Непрерывный предмет сохраняется в документной модели, а не в chapter-local
рисунках. `composition-state` разрешает позицию, общие input keys и чистую
subject projection до подготовки; `composition-presentations` владеет только
ограниченным набором геометрии. Drawing и snapshot effect одной главы имеют общий lifecycle. Первый render неактивной главы идёт в preparation
под clip/inert, затем публикуется готовый вид. Его ошибка сохраняет accepted
frame/checkpoint. Активный произвольный renderer отвечает за атомарность своего
DOM. `scene-objects` исключает pending/hidden chapters и читает значение принятого
representation при общем ID. `IllustratedStory` передаёт полный документный trace
через `ChapterFrame.subject`; общие model inputs переживают переключение глав
в explore, mode-story восстанавливает авторский replay. `chapter.views` выбирает
объявленные representations, сохраняя model identity.

`composition-view` переносит semantic focus IDs между representations. Camera state
сохраняется и восстанавливается только в собственной главе; numeric restore
не вызывает новый focus-fit. Явный возврат в Story очищает ручной focus intent.

Подготовленные рассказы используют `heading:"navigation"`: тихая кнопка «Главы»
открывает существующее меню, короткая реплика остаётся у действующего предмета.

`session-attachment` сериализует renderer takeover на состоянии SessionDirectory;
нового store нет. Expiry перевзводит ранний timer до прежнего wall-clock deadline,
чтобы незавершённая команда не блокировала смену renderer.

## Пространственная постановка

`viewport/camera-view.ts` хранит authored following, ручной orbit и checkpoint.
`shots.ts` — общий fit/pose solver; `shot-plan.ts` — неподвижные authored envelopes,
предыдущие ракурсы и окна движения/наблюдения по существующим cues. Geography,
подъём региона и раскрытие устройства читают один amount Story. Модель заказа
и точное сечение живут в документе; смена и освобождение GPU-вида их не меняют.
`whenRendered` выполняет необходимый GPU paint даже в concealed iframe через
один cancellable microtask flush прежнего renderer. RAF остаётся владельцем
обычного рисования; первого кадра недостаточно для заявления о показанных пикселях.

Физический `push-block` читает неизменяемые fixed-step записи Rapier через обычный
StoryModelModule. PhysicsReplay рассчитывает их и восстанавливает live world
только при явном handoff/checkpoint. Фабрика вида не перематывает физический мир.
`characters/cast.ts` владеет исполнителями и модельными контактами плоской сцены;
подготовленная декорация сохраняет собственную постановку. `SimulationMode`
передаёт существующий player: Story на паузе, SimulationPlayer активен либо наоборот.
SceneCheckpoint и MCP report сохраняют отдельное состояние forward-only опыта;
его codec проверяется до изменения принятого кадра.

GPT: `story-project.json` объявляет model/subject-модули; `story.json` задаёт главы
и semantic operations. `subject-model.js` сохраняет реальные веса и trace;
`presentation/` разделяет предметные рисунки, `computation.js` связывает выбранные
тензорные адреса с MathMorph. Общие надписи, framing и borrowed view находятся в
`morph/notes-3d.ts`, `morph/scene-framing.ts`, `scene/view-access.ts`.
`StoryModelModule.projectViews` проецирует выбранные authored representations до
`experimentState`; ручной опыт сохраняет свои scalar inputs. `resolveInput` получает
intent input/restore: восстановление не запускает сбросы нового пользовательского ввода.

`StorySubjectDrawing.prepare` подготавливает скрытые ресурсы через существующий
Story.prepare и отменяется его signal. Принятый рисунок остаётся видимым до render.
`ready` и `SceneView.whenRendered` завершают GPU-кадр через существующий viewport;
SceneShell.ready ожидает модель и её активный renderer. Перенос документа, контроллера
и аудио ждёт ready; failed/cancelled candidate восстанавливает принятую композицию.

Авторская подсветка идёт через `SceneHandle.emphasize` и общий contour в
`scene-objects`/`controls/svg-contour`; выбор зрителя сохраняется отдельно. Оба пути
IllustratedStory передают ему `beat.focus`. У division больше нет частного focus API.

`scene/controller-view` готовит UI вне действующей карточки. SceneShell захватывает
playback intent, принимает подготовленные внешние ресурсы, публикует binding и
освобождает прежний controller. Ошибки retirement и уведомления `onMode` сообщаются
через `scene-cleanup-error`/`scene-callback-error`; принятая сцена сохраняет управление.
При правке играющий Story временно останавливается, прежний render теряет право
менять общий рисунок, после принятия или отката восстанавливается playback intent.

Boundary preview ждёт GPU paint каждой стороны. `story/frozen-presentation` сохраняет
принятые пиксели и смысл объектов на время заимствования renderer. Если восстановление
не удалось, fallback живёт до успешной публикации или dispose; обе причины ошибки
сохраняются. Raster registry получает текущий буфер от его Viewport3D без второго
renderer и продвижения времени модели или камеры.
