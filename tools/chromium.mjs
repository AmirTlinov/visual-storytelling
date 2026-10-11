/** Shared browser environment for rendering, interactive review and acceptance. */
export function chromiumLaunchOptions(options = {}) {
  return {
    executablePath: process.env.VISUAL_STORY_CHROMIUM,
    ...options,
    // Headless Chromium otherwise selects SwiftShader on macOS, even with Metal available.
    args: [
      ...(process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : []),
      ...(options.args ?? []),
    ],
  };
}
