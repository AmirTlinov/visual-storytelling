import { watch } from 'node:fs';
import { sceneInput } from '../tools/assets.mjs';

/** Observe ordinary editor writes; plugin transactions retain their own undo boundary. */
export class ProjectWatch {
  entries = new Map();
  constructor(changed) {
    this.changed = changed;
  }
  open(project) {
    const previous = this.entries.get(project.id);
    if (previous?.path === project.path) return;
    if (previous) {
      clearTimeout(previous.timer);
      previous.watcher.close();
    }
    const entry = {
      path: project.path,
      timer: undefined,
      watcher: undefined,
      running: false,
      dirty: false,
    };
    const notify = async () => {
      if (this.entries.get(project.id) !== entry || entry.running) return;
      entry.dirty = false;
      entry.running = true;
      try {
        await this.changed(project.id);
      } catch (error) {
        console.error(error.message);
      } finally {
        entry.running = false;
        if (entry.dirty && this.entries.get(project.id) === entry)
          entry.timer = setTimeout(notify, 400);
      }
    };
    entry.watcher = watch(project.path, { recursive: true }, (_, file) => {
      if (file && (!sceneInput(String(file)) || String(file) === 'story.vstory')) return;
      entry.dirty = true;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(notify, 400);
    });
    entry.watcher.on('error', (error) => {
      console.error(`Project watcher: ${error.message}`);
      clearTimeout(entry.timer);
      entry.watcher.close();
      if (this.entries.get(project.id) === entry) this.entries.delete(project.id);
    });
    this.entries.set(project.id, entry);
  }
  close() {
    for (const e of this.entries.values()) {
      clearTimeout(e.timer);
      e.watcher.close();
    }
    this.entries.clear();
  }
}
