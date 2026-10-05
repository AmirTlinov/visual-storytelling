import { OpenAIFileEntrypointInputSchema } from '@openai/mcp-extensions/app';

/** Resolve the actual host resource. An isolated manifest never invents a project path. */
export function fileEntrypoint(app, extensions, { open, error }) {
  app.addEventListener('toolinput', async ({ arguments: args }) => {
    const input = OpenAIFileEntrypointInputSchema.safeParse(args);
    if (!input.success) return;
    try {
      if (!extensions.resources) throw new Error('Codex не предоставил доступ к этому файлу.');
      const resource = await extensions.resources.read({ uri: input.data.file.resourceUri });
      const content = resource.contents.find((item) => typeof item.text === 'string');
      if (!content) throw new Error('Файл проекта не содержит доступного текста.');
      const manifest = JSON.parse(content.text);
      if (manifest.format !== 1 || typeof manifest.id !== 'string')
        throw new Error('Этот формат проекта пока не поддерживается.');
      const uri = new URL(input.data.file.resourceUri);
      let target;
      if (uri.protocol === 'file:' && !uri.hostname && uri.pathname.endsWith('/story.vstory'))
        target = { path: decodeURIComponent(uri.pathname) };
      else {
        const catalog = await app.callServerTool({ name: 'story_help', arguments: {} });
        if (!catalog.structuredContent?.projects.some((p) => p.id === manifest.id))
          throw new Error(
            'Для этой работы нужна папка с исходниками. Откройте её через чат; один story.vstory не содержит рисунок и ресурсы.',
          );
        target = { projectId: manifest.id };
      }
      const result = await app.callServerTool({ name: 'story_open', arguments: target });
      if (result.isError) throw new Error(result.content[0].text);
      await open(result);
    } catch (e) {
      error(e.message);
    }
  });
}
