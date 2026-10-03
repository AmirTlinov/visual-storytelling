import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderer } from './render.mjs';

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
export function reviewTimes(cue, duration) {
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

function html(report) {
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
figcaption,summary{font-size:13px}pre{white-space:pre-wrap;font-size:12px}li{margin:5px 0}a{color:LinkText}code{overflow-wrap:anywhere}
</style></head><body><h1>Разбор переходов</h1>
<p>Реплика → видимое действие → результат. Откройте кадр для деталей; сравните промежуточные числа и сохранность объектов.
Стоп-кадры дополняют просмотр со звуком: они не проверяют интонацию, плавность или понятность зрителю.</p>
<p>${escape(report.theme)} · ${report.width}px · метки: ${report.cues.length} · ${report.reduced ? 'уменьшенное' : 'обычное'} движение</p>
${warnings ? `<ul>${warnings}</ul>` : '<p>Пропущенных описаний и непрочитанных меток в выбранных переходах не обнаружено.</p>'}
${report.cues
  .map(
    (
      cue,
    ) => `<section><h2><code>${escape(cue.id)}</code> · ${cue.start.toFixed(2)}–${cue.end.toFixed(2)} с</h2>
<blockquote>«${escape(cue.text ?? cue.quote ?? cue.context)}»</blockquote>
<p>${cue.kind === 'hold' ? 'Остановка' : 'Действие'}: ${escape(cue.action ?? cue.hold ?? 'описание отсутствует')}</p>
${cue.context ? `<details><summary>Вся реплика</summary><p>${escape(cue.context)}</p></details>` : ''}
<p>Метка ${cue.referenced ? 'прочитана кодом сцены' : 'не прочитана через cueSheet/clock'}${cue.unchanged ? '; все снятые кадры одинаковы' : ''}.</p>
<div class="frames">${cue.frames
      .map(
        (
          frame,
        ) => `<figure><button class="frame" type="button"><img src="${frame.image}" alt="${escape(cue.id)}: ${frame.time.toFixed(3)} с" loading="lazy"></button>
<figcaption>${frame.time.toFixed(3)} с${frame.time < cue.start ? ' · до' : frame.time > cue.end ? ' · после' : ''}</figcaption>
${frame.state !== undefined ? `<details><summary>Состояние модели</summary><pre>${escape(JSON.stringify(frame.state, null, 2))}</pre></details>` : ''}</figure>`,
      )
      .join('')}</div></section>`,
  )
  .join('')}
<dialog aria-labelledby="frame-title"><button type="button" autofocus>Закрыть</button><p id="frame-title"></p><img alt=""></dialog>
<script>
const dialog = document.querySelector('dialog');
document.querySelectorAll('.frame').forEach(button => button.addEventListener('click', () => {
  const image = button.querySelector('img');
  dialog.querySelector('img').src = image.src;
  dialog.querySelector('img').alt = image.alt;
  document.querySelector('#frame-title').textContent = image.alt;
  dialog.showModal();
}));
dialog.querySelector('button').addEventListener('click', () => dialog.close());
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
  const capture = await renderer({ directory, theme, width });
  const errors = [];
  capture.page.on('pageerror', (error) => errors.push(error.message));
  const inspect = () => capture.capture.evaluate((scene) => scene.review());
  try {
    await capture.page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const initial = await inspect();
    for (const id of cues)
      if (!initial.cues.some((cue) => cue.id === id)) throw new Error(`Unknown review cue: ${id}`);
    const selected = initial.cues.filter((cue) =>
      cues.length ? cues.includes(cue.id) : cue.kind !== 'chapter',
    );
    if (!selected.length) throw new Error('No action cues to review');
    await mkdir(output, { recursive: true });
    const sampled = [];
    for (const cue of selected) {
      const frames = [];
      for (const time of reviewTimes(cue, initial.duration)) {
        await capture.seek(time);
        const state = await capture.capture.evaluate((scene) => scene.snapshot());
        const diagnostics = await capture.capture.evaluate((scene) => scene.diagnostics());
        const png = await capture.png();
        frames.push({
          time,
          state,
          diagnostics,
          image: `data:image/png;base64,${png.toString('base64')}`,
          digest: createHash('sha256').update(png).digest('hex'),
        });
      }
      sampled.push({
        id: cue.id,
        frames,
        unchanged: new Set(frames.map((frame) => frame.digest)).size === 1,
      });
    }
    const inspected = await inspect();
    const report = {
      duration: initial.duration,
      width,
      theme,
      reduced,
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
      warnings: errors.map((error) => `Ошибка сцены: ${error}`),
    };
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
    // Images live in the self-contained HTML; the small JSON keeps times and model snapshots.
    await writeFile(join(output, 'index.html'), html(report));
    await writeFile(
      join(output, 'review.json'),
      JSON.stringify(
        {
          ...report,
          cues: report.cues.map((cue) => ({
            ...cue,
            frames: cue.frames.map(({ image, ...frame }) => frame),
          })),
        },
        null,
        2,
      ) + '\n',
    );
    return {
      path: join(output, 'index.html'),
      cues: report.cues.length,
      warnings: report.warnings,
    };
  } finally {
    await capture.close();
  }
}
