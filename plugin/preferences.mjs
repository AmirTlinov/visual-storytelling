import { isAbsolute, join } from 'node:path';
import { readJSON, writeJSON } from '../tools/storage.mjs';

/** User defaults. Project content and transient viewing state have their own owners. */
export class Preferences {
  constructor(data) {
    this.data = data;
  }
  async read() {
    const saved = await readJSON(join(this.data, 'preferences.json'));
    const preferences = {
      projectsDirectory: join(this.data, 'projects'),
      language: 'ru-RU',
      cacheLimitMB: 2048,
    };
    for (const key of Object.keys(preferences))
      if (saved && Object.hasOwn(saved, key)) preferences[key] = saved[key];
    return preferences;
  }
  async update(patch) {
    this.writes = (this.writes ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (patch.projectsDirectory && !isAbsolute(patch.projectsDirectory))
          throw new Error('Choose an absolute directory for new projects.');
        const current = await this.read();
        if (Object.keys(patch).some((key) => !Object.hasOwn(current, key)))
          throw new Error('Unknown plugin preference.');
        const next = { ...current, ...patch };
        await writeJSON(join(this.data, 'preferences.json'), next);
        return next;
      });
    return this.writes;
  }
}
