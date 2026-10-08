/** Project navigation and release choices use the same MCP operations as the agent. */
export function libraryUI(
  app,
  extensions,
  { open, session, error, ensureConnected = async () => {} },
) {
  const $ = (id) => document.getElementById(id);
  let opening = false;
  function closeLibrary() {
    $('library').hidden = true;
    $('browse').setAttribute('aria-expanded', 'false');
    $('browse').focus();
  }
  async function call(name, args = {}) {
    const result = await app.callServerTool({ name, arguments: args });
    if (result.isError)
      throw new Error(result.content?.find((c) => c.type === 'text')?.text ?? 'Operation failed');
    return result;
  }
  function row(title, detail, run) {
    const button = document.createElement('button');
    button.className = 'library-item';
    const label = document.createElement('strong'),
      note = document.createElement('span');
    label.textContent = title;
    note.textContent = detail ?? '';
    button.append(label, note);
    button.onclick = async () => {
      if (opening) return;
      opening = true;
      button.disabled = true;
      try {
        const result = await run();
        if (result) await open(result);
        closeLibrary();
      } catch (e) {
        error(e.message);
      } finally {
        button.disabled = false;
        opening = false;
      }
    };
    return button;
  }
  $('browse').onclick = async () => {
    if (!$('library').hidden) {
      closeLibrary();
      return;
    }
    $('library').hidden = false;
    $('library-content').textContent = 'Открываю библиотеку…';
    $('browse').setAttribute('aria-expanded', 'true');
    $('library-close').focus();
    try {
      const { structuredContent: catalog } = await call('story_help');
      const content = $('library-content');
      content.replaceChildren();
      for (const [label, entries] of [
        ['Мои объяснения', catalog.projects],
        ['Примеры', Object.entries(catalog.examples).map(([id, item]) => ({ ...item, id }))],
      ]) {
        if (!entries.length) continue;
        const heading = document.createElement('h2');
        heading.textContent = label;
        content.append(heading);
        for (const item of entries)
          content.append(
            row(item.title, item.summary ?? item.path, async () => {
              if (session()) await ensureConnected();
              return session()
                ? call('story_navigate', {
                    sessionId: session().sessionId,
                    target: item.path ? { projectId: item.id } : { example: item.id },
                  }).then(() => undefined)
                : call('story_open', item.path ? { projectId: item.id } : { example: item.id });
            }),
          );
      }
    } catch (e) {
      error(e.message);
    }
  };
  $('library-close').onclick = closeLibrary;
  $('release').onclick = () => {
    $('release-options').hidden = !$('release-options').hidden;
    $('release').setAttribute('aria-expanded', String(!$('release-options').hidden));
    if (!$('release-options').hidden) $('release-options').querySelector('button').focus();
  };
  $('release-version').onchange = () => {
    const working = $('release-version').value === 'working';
    $('release-current').disabled = working;
    if (working) $('release-current').checked = false;
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('library').hidden) closeLibrary();
    else if (!$('release-options').hidden) {
      $('release-options').hidden = true;
      $('release').setAttribute('aria-expanded', 'false');
      $('release').focus();
    }
  });
  for (const button of document.querySelectorAll('[data-format]'))
    button.onclick = async () => {
      button.disabled = true;
      try {
        const current = session();
        if (!current.projectId)
          throw new Error(
            'Для собственного выпуска сначала создайте проект из этого примера в чате.',
          );
        let target = {
          kind: 'build',
          projectId: current.projectId,
          buildRevision: current.buildRevision,
        };
        const conditions = $('release-current').checked ? 'current' : 'authored';
        if (conditions === 'current' && !['html', 'png', 'svg'].includes(button.dataset.format))
          throw new Error(
            'Текущие условия сохраняются в HTML, PNG и SVG. Для рассказа или исходников снимите этот флажок.',
          );
        if ($('release-version').value === 'working') {
          const { structuredContent: project } = await call('story_inspect', {
            projectId: current.projectId,
          });
          target = {
            kind: 'working',
            projectId: current.projectId,
            sourceRevision: project.sourceRevision,
          };
        }
        if (conditions === 'current') await ensureConnected();
        await call('story_produce', {
          target,
          requestId: crypto.randomUUID(),
          options: {
            formats: [button.dataset.format],
            conditions,
            ...(conditions === 'current' ? { sessionId: current.sessionId } : {}),
            ...(button.dataset.format === 'mp4' ? { video: { kind: 'story' } } : {}),
          },
        });
        $('release-options').hidden = true;
        $('release').setAttribute('aria-expanded', 'false');
        $('release').focus();
      } catch (e) {
        error(e.message);
      } finally {
        button.disabled = false;
      }
    };
  let artifactsKey;
  return {
    update(current) {
      $('release').hidden = !current?.projectId;
      $('release').disabled = !current?.sourceRevision;
      $('release-options').hidden = true;
      $('release-version').value = 'build';
      $('release-current').checked = false;
      $('release-current').disabled = false;
      artifactsKey = undefined;
    },
    artifacts(files) {
      if (artifactsKey === JSON.stringify(files)) return;
      artifactsKey = JSON.stringify(files);
      const output = $('artifacts');
      output.replaceChildren();
      output.hidden = false;
      const label = document.createElement('span');
      label.textContent = 'Готово: ';
      output.append(label);
      for (const file of files) {
        if (extensions.files) {
          const button = document.createElement('button');
          button.textContent = file.split('/').at(-1);
          button.onclick = () => void extensions.files.open(file).catch((e) => error(e.message));
          output.append(button);
        } else {
          const path = document.createElement('span');
          path.textContent = file;
          output.append(path);
        }
      }
    },
  };
}
