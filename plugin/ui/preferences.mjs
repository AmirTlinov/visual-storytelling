/** User preferences are independent of a scene and can open from the host's settings entrypoint. */
export function preferencesUI(app, error) {
  const panel = document.getElementById('preferences'),
    form = panel.querySelector('form');
  const button = document.getElementById('settings');
  let previousFocus;
  async function open(value) {
    previousFocus = document.activeElement;
    if (!value) {
      const response = await app.callServerTool({ name: 'story_preferences', arguments: {} });
      if (response.isError) throw new Error(response.content[0].text);
      value = response.structuredContent;
    }
    for (const name of ['projectsDirectory', 'language', 'cacheLimitMB'])
      form.elements[name].value = value[name];
    panel.hidden = false;
    form.elements.projectsDirectory.focus();
  }
  function close() {
    panel.hidden = true;
    previousFocus?.focus();
  }
  button.onclick = () => void open().catch((e) => error(e.message));
  document.getElementById('preferences-close').onclick = close;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const response = await app.callServerTool({
        name: 'story_preferences',
        arguments: {
          patch: {
            projectsDirectory: form.elements.projectsDirectory.value.trim(),
            language: form.elements.language.value.trim(),
            cacheLimitMB: Number(form.elements.cacheLimitMB.value),
          },
        },
      });
      if (response.isError) throw new Error(response.content[0].text);
      close();
    } catch (e) {
      error(e.message);
    } finally {
      submit.disabled = false;
    }
  };
  panel.onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  return { open };
}
