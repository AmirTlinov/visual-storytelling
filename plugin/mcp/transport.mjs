import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/** Publish app identity at the protocol boundary: SDK v1 registration omits tool icons. */
export class AppStdioTransport extends StdioServerTransport {
  constructor(toolIcons) {
    super();
    this.toolIcons = toolIcons;
  }

  send(message) {
    if (Array.isArray(message.result?.tools)) {
      message = {
        ...message,
        result: {
          ...message.result,
          tools: message.result.tools.map((tool) =>
            this.toolIcons[tool.name] ? { ...tool, icons: this.toolIcons[tool.name] } : tool,
          ),
        },
      };
    }
    return super.send(message);
  }
}
