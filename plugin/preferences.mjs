import { isAbsolute, join } from 'node:path';
import { readJSON, writeJSON } from '../tools/storage.mjs';

/** User defaults. Project content and transient viewing state have their own owners. */
export class Preferences {
  constructor(data) {
    this.data = data;
  }
  async read() {
    return {
      projectsDirectory: join(this.data, 'projects'),
      language: 'ru-RU',
      voice: null,
      cacheLimitMB: 2048,
      ...(await readJSON(join(this.data, 'preferences.json'))),
    };
  }
  async update(patch) {
    this.writes = (this.writes ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (patch.projectsDirectory && !isAbsolute(patch.projectsDirectory))
          throw new Error('Choose an absolute directory for new projects.');
        const next = { ...(await this.read()), ...patch };
        await writeJSON(join(this.data, 'preferences.json'), next);
        return next;
      });
    return this.writes;
  }
}
