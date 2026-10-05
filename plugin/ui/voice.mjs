export function voiceUI(app, { session, error }) {
  const $ = (id) => document.getElementById(id);
  async function call(args) {
    const result = await app.callServerTool({ name: 'story_voice', arguments: args });
    if (result.isError) throw new Error(result.content[0].text);
    return result.structuredContent;
  }
  function close() {
    $('voice-options').hidden = true;
    $('voice').setAttribute('aria-expanded', 'false');
    $('voice').focus();
  }
  $('voice').onclick = async () => {
    const owner = session();
    if (!$('voice-options').hidden) {
      close();
      return;
    }
    $('voice').disabled = true;
    try {
      const status = await call({ projectId: owner.projectId });
      if (session() !== owner) return;
      const choices = $('voice-choice');
      choices.replaceChildren();
      choices.add(new Option('Без озвучки', ''));
      for (const voice of status.voices) choices.add(new Option(voice.name, voice.id));
      choices.value = status.settings?.enabled
        ? (status.settings.voice ?? status.voices[0]?.id ?? '')
        : '';
      $('voice-status').textContent = status.ready
        ? 'Голос готовится на этом компьютере. Рисунок остаётся доступен.'
        : status.reason;
      $('voice-options').hidden = false;
      $('voice').setAttribute('aria-expanded', 'true');
      choices.focus();
    } catch (e) {
      if (session() === owner) error(e.message);
    } finally {
      $('voice').disabled = false;
    }
  };
  $('voice-close').onclick = close;
  $('voice-form').onsubmit = async (event) => {
    event.preventDefault();
    const owner = session(),
      voice = $('voice-choice').value;
    $('voice-apply').disabled = true;
    try {
      const result = await app.callServerTool({
        name: 'story_inspect',
        arguments: { projectId: owner.projectId },
      });
      if (result.isError) throw new Error(result.content[0].text);
      if (session() !== owner) return;
      await call({
        projectId: owner.projectId,
        sourceRevision: result.structuredContent.sourceRevision,
        requestId: crypto.randomUUID(),
        enabled: Boolean(voice),
        ...(voice ? { voice } : {}),
      });
      if (session() === owner) close();
    } catch (e) {
      if (session() === owner) error(e.message);
    } finally {
      $('voice-apply').disabled = false;
    }
  };
  $('voice-options').onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  return {
    update: () => {
      $('voice').hidden = !session()?.projectId;
      $('voice-options').hidden = true;
      $('voice').setAttribute('aria-expanded', 'false');
    },
  };
}
