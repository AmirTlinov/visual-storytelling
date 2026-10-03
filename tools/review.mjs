import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderer } from './render.mjs';
import { analyzeMotionFrames, motionData } from './motion/frames.mjs';
import { motionMarkup, writeMotionReport } from './motion/report.mjs';
import { packDirectory } from './standalone.mjs';
import { installReviewPlayer } from './review-player.mjs';

const escape = (text) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );

/** Review samples are derived from the actual word intervals, never a second timeline. */
function reviewTimes(cue, duration) {
  const span = cue.end - cue.start;
  return [
    ...new Set([
      Math.max(0, cue.start - 0.08),
      cue.start,
      ...[0.25, 0.5, 0.75].map((p) => cue.start + span * p),
      cue.end,
      Math.min(duration, cue.end + 0.08),
    ]),
  ];
}

/** Show narration that has no authored action/hold; no semantic judgment or second clock. */
export function unmarkedIntervals(review, minimum = 1) {
  const marked = review.cues.filter((cue) => cue.kind === 'action' || cue.kind === 'hold');
  return review.segments.flatMap((segment) => {
    let cursor = segment.start;
    const gaps = [];
    for (const cue of marked
      .filter((cue) => cue.end > segment.start && cue.start < segment.end)
      .sort((a, b) => a.start - b.start)) {
      if (cue.start - cursor >= minimum) gaps.push({ start: cursor, end: cue.start });
      cursor = Math.max(cursor, Math.min(segment.end, cue.end));
    }
    if (segment.end - cursor >= minimum) gaps.push({ start: cursor, end: segment.end });
    return gaps.map((gap) => ({
      ...gap,
      chapter: segment.id,
      title: segment.title,
      text: segment.text,
    }));
  });
}

function framesHTML(frames, label, interval) {
  return `<div class="frames">${frames
    .map(
      (
        frame,
      ) => `<figure><button class="frame" type="button"><img src="${frame.image}" alt="${escape(label)}: ${frame.time.toFixed(3)} с" loading="lazy"></button>
<figcaption>${frame.time.toFixed(3)} с${interval ? (frame.time < interval.start ? ' · до' : frame.time > interval.end ? ' · после' : '') : ''}</figcaption>
${frame.state !== undefined ? `<details><summary>Состояние модели</summary><pre>${escape(JSON.stringify(frame.state, null, 2))}</pre></details>` : ''}</figure>`,
    )
    .join('')}</div>`;
}

function html(report, sceneHTML) {
  const warnings = report.warnings.map((warning) => `<li>${escape(warning)}</li>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Разбор переходов</title>
<style>
:root{color-scheme:light dark;font:16px/1.5 system-ui}body{margin:24px auto;padding:0 20px;max-width:1440px}
h1{font-size:26px}h2{font-size:19px}section{padding:20px 0;border-top:1px solid GrayText}blockquote{margin:8px 0}
.frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px}figure{margin:0}img{display:block;width:100%}
.frame{display:block;padding:0;width:100%;border:0;background:none;cursor:zoom-in}.frame:focus-visible{outline:2px solid LinkText;outline-offset:3px}
dialog{max-width:calc(100vw - 40px);padding:16px;border:1px solid GrayText}dialog img{max-height:80vh;width:auto;max-width:100%;object-fit:contain}dialog::backdrop{background:#0009}
dialog button{float:right;font:inherit;margin-bottom:8px}dialog p{margin:0 80px 12px 0}
#playback{width:${report.width}px;max-height:90vh;overflow:auto}#playback h2{margin:0 80px 12px 0}
#playback iframe{display:block;width:100%;height:calc(90vh - 140px);min-height:280px;border:0}#playback [role=status]{margin:12px 0 0}
[data-play-cue]{font:inherit;padding:8px 12px;cursor:pointer}
figcaption,summary{font-size:13px}pre{white-space:pre-wrap;font-size:12px}li{margin:5px 0}a{color:LinkText}code{overflow-wrap:anywhere}
</style></head><body><h1>Разбор переходов</h1>
<p>Реплика → видимое действие → результат. Откройте кадр для деталей; сравните промежуточные числа и сохранность объектов.
Наложения показывают форму переходов по перемотке; ритм живого воспроизведения проверяйте по записи через <code>review --motion</code>.</p>
<p>${escape(report.theme)} · ${report.width}px · метки: ${report.cues.length} · ${report.reduced ? 'уменьшенное' : 'обычное'} движение</p>
${warnings ? `<ul>${warnings}</ul>` : '<p>Пропущенных описаний и непрочитанных меток в выбранных переходах не обнаружено.</p>'}
${report.unmarked.length ? `<h2>Реплики вне размеченных действий</h2><p>Интервалы от секунды без action/hold. Сверьте появление нового факта со словами; спокойный кадр может быть уместным.</p>${report.unmarked.map((gap) => `<section><h2>${escape(gap.title ?? gap.chapter)} · ${gap.start.toFixed(2)}–${gap.end.toFixed(2)} с</h2><blockquote>${escape(gap.text)}</blockquote>${framesHTML(gap.frames, gap.chapter)}</section>`).join('')}` : ''}
${report.messages.length ? `<details><summary>Сообщения рендера (${report.messages.length})</summary><ul>${report.messages.map((message) => `<li>${message.time.toFixed(2)} с · ${escape(message.type)}: ${escape(message.text)}<br><code>${escape(message.url)}:${(message.lineNumber ?? 0) + 1}</code> · ${message.count} раз</li>`).join('')}</ul></details>` : ''}
${report.cues
  .map(
    (
      cue,
      index,
    ) => `<section><h2><code>${escape(cue.id)}</code> · ${cue.start.toFixed(2)}–${cue.end.toFixed(2)} с</h2>
<blockquote>«${escape(cue.text ?? cue.quote ?? cue.context)}»</blockquote>
<p>${cue.kind === 'hold' ? 'Остановка' : 'Действие'}: ${escape(cue.action ?? cue.hold ?? 'описание отсутствует')}</p>
${sceneHTML ? `<button type="button" data-play-cue data-title="${escape(cue.id)}" data-start="${Math.max(0, cue.start - 0.5)}" data-end="${Math.min(report.duration, cue.end + 0.7)}">Проиграть переход</button>` : ''}
${cue.context ? `<details><summary>Вся реплика</summary><p>${escape(cue.context)}</p></details>` : ''}
<p>Метка ${cue.referenced ? 'прочитана кодом сцены' : 'не прочитана через Frame'}${cue.unchanged ? '; все снятые кадры одинаковы' : ''}.</p>
${cue.motion ? `${motionMarkup(cue.motion, { includeFrames: false, idPrefix: `cue-motion-${index}`, artifactBase: cue.motionImage.slice(0, cue.motionImage.lastIndexOf('/')) })}<p><a href="${cue.motionImage}">Открыть краткий обзор PNG</a></p>` : ''}
${framesHTML(cue.frames, cue.id, cue)}</section>`,
  )
  .join('')}
<dialog id="still" aria-labelledby="frame-title"><button type="button" autofocus>Закрыть</button><p id="frame-title"></p><img alt=""></dialog>
${sceneHTML ? `<template id="review-scene">${escape(sceneHTML)}</template><dialog id="playback" data-reduced="${report.reduced}" aria-labelledby="playback-title"><button type="button" data-close autofocus>Закрыть</button><h2 id="playback-title"></h2><iframe title="Проверяемый переход" allow="autoplay"></iframe><p role="status"></p></dialog>` : ''}
<script>
const dialog = document.querySelector('#still');
document.querySelectorAll('.frame').forEach(button => button.addEventListener('click', () => {
  const image = button.querySelector('img');
  dialog.querySelector('img').src = image.src;
  dialog.querySelector('img').alt = image.alt;
  document.querySelector('#frame-title').textContent = image.alt;
  dialog.showModal();
}));
dialog.querySelector('button').addEventListener('click', () => dialog.close());
(${installReviewPlayer.toString()})();
</script></body></html>`;
}

export async function reviewScene({
  directory,
  out,
  cues = [],
  theme = 'light',
  width = 960,
  reduced = false,
}) {
  const output = resolve(out);
  if (output === resolve(directory))
    throw new Error('Review output must be separate from the scene');
  const capture = await renderer({ directory, theme, width, reduced });
  const inspect = () => capture.capture.evaluate((scene) => scene.review());
  try {
    const initial = await inspect();
    for (const id of cues)
      if (!initial.cues.some((cue) => cue.id === id)) throw new Error(`Unknown review cue: ${id}`);
    const selected = initial.cues.filter((cue) =>
      cues.length ? cues.includes(cue.id) : cue.kind !== 'chapter',
    );
    const unmarked = cues.length ? [] : unmarkedIntervals(initial);
    if (!selected.length && !unmarked.length)
      throw new Error('No action cues or narration to review');
    await mkdir(output, { recursive: true });
    const sampled = [];
    async function sample(time) {
      await capture.seek(time);
      const state = await capture.capture.evaluate((scene) => scene.snapshot());
      const diagnostics = await capture.capture.evaluate((scene) => scene.diagnostics());
      const png = await capture.png();
      return {
        time,
        state,
        diagnostics,
        image: `data:image/png;base64,${png.toString('base64')}`,
        digest: createHash('sha256').update(png).digest('hex'),
      };
    }
    for (const cue of selected) {
      const frames = [];
      for (const time of reviewTimes(cue, initial.duration)) {
        frames.push(await sample(time));
      }
      let motion, motionImage;
      if (frames.length >= 2 && cue.kind === 'action') {
        motion = {
          ...(await analyzeMotionFrames(
            frames.map((frame) => ({
              time: frame.time,
              png: Buffer.from(frame.image.split(',')[1], 'base64'),
            })),
          )),
          title: cue.action ?? cue.id,
          source: { kind: 'scene-seek', path: resolve(directory) },
          sampling: 'cue-checkpoints',
        };
        const folder = `motion-${String(sampled.length + 1).padStart(3, '0')}`;
        await writeMotionReport(motion, join(output, folder), { context: capture.page.context() });
        motionImage = `${folder}/motion.png`;
      }
      sampled.push({
        id: cue.id,
        frames,
        motion,
        motionImage,
        unchanged: new Set(frames.map((frame) => frame.digest)).size === 1,
      });
    }
    for (const gap of unmarked) gap.frames = [await sample(gap.start), await sample(gap.end)];
    const inspected = await inspect();
    let sceneHTML;
    const playable = await capture.page.evaluate(
      () =>
        typeof document.querySelector('.ve-scene')?.scene?.play === 'function' ||
        Boolean(document.querySelector('[data-play]')),
    );
    let playbackWarning;
    if (playable) {
      try {
        sceneHTML = await packDirectory(directory, 'index.html', { theme });
      } catch (error) {
        playbackWarning = `Живой просмотр недоступен: ${error.message}`;
      }
    }
    const report = {
      duration: initial.duration,
      width,
      theme,
      reduced,
      playback: Boolean(sceneHTML),
      unmarked,
      messages: capture.messages,
      cues: sampled.map((sample) => {
        const cue = inspected.cues.find((cue) => cue.id === sample.id);
        return {
          ...cue,
          ...sample,
          context: inspected.segments
            .filter((segment) =>
              cue.start === cue.end
                ? segment.start <= cue.start && segment.end > cue.start
                : segment.start < cue.end && segment.end > cue.start,
            )
            .map((segment) => segment.text)
            .join(' '),
        };
      }),
      warnings: capture.messages
        // Chromium's screenshot readback is reported, but is not a scene defect.
        .filter((message) => !/GL Driver Message.*GPU stall due to ReadPixels/.test(message.text))
        .map((message) => `${message.time.toFixed(2)} с: ${message.text}`),
    };
    if (playbackWarning) report.warnings.push(playbackWarning);
    for (const cue of report.cues) {
      for (const message of new Set(cue.frames.flatMap((frame) => frame.diagnostics)))
        report.warnings.push(`${cue.id}: ${message}`);
      if (cue.kind === 'unassigned')
        report.warnings.push(`${cue.id}: опишите видимое действие или осмысленную остановку.`);
      if (!cue.referenced && cue.kind !== 'hold' && cue.kind !== 'chapter')
        report.warnings.push(`${cue.id}: код не обращался к метке; проверьте привязку действия.`);
      if (cue.kind === 'action' && cue.unchanged)
        report.warnings.push(
          `${cue.id}: кадры одинаковы до, внутри и после действия; проверьте его время и видимость.`,
        );
    }
    for (const gap of report.unmarked)
      for (const message of new Set(gap.frames.flatMap((frame) => frame.diagnostics)))
        report.warnings.push(
          `${gap.chapter} · ${gap.start.toFixed(2)}–${gap.end.toFixed(2)} с: ${message}`,
        );
    // Images live in the self-contained HTML; the small JSON keeps times and model snapshots.
    await writeFile(join(output, 'index.html'), html(report, sceneHTML));
    await writeFile(
      join(output, 'review.json'),
      JSON.stringify(
        {
          ...report,
          cues: report.cues.map((cue) => ({
            ...cue,
            motion: cue.motion ? motionData(cue.motion) : undefined,
            frames: cue.frames.map(({ image, ...frame }) => frame),
          })),
          unmarked: report.unmarked.map((gap) => ({
            ...gap,
            frames: gap.frames.map(({ image, ...frame }) => frame),
          })),
        },
        null,
        2,
      ) + '\n',
    );
    return {
      path: join(output, 'index.html'),
      cues: report.cues.length,
      unmarkedIntervals: report.unmarked.length,
      rendererMessages: report.messages.length,
      warnings: report.warnings,
    };
  } finally {
    await capture.close();
  }
}
