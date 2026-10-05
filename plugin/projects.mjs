import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  realpath,
  readdir,
  stat,
  copyFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJSON, writeJSON } from './runtime/storage.mjs';
import { projectFiles, projectFile, digest } from './project-files.mjs';
import { failure } from './errors.mjs';

const readOptional = (file) =>
  readFile(file).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
const matches = (bytes, text) =>
  text === null ? bytes === null : bytes !== null && bytes.equals(Buffer.from(text));
const conflict = (name) =>
  new Error(`Interrupted edit conflicts with ${name}. Resolve it using .vstory/transaction.json.`);
const validRequest = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(id);
const validCursor = (id) => id === null || validRequest(id);

/** Working documents and undo journals; the renderer owns neither files nor authoring history. */
export class ProjectStore {
  constructor(data) {
    this.data = data;
    this.projects = new Map();
    this.queues = new Map();
  }
  async start() {
    for (const item of (await readJSON(join(this.data, 'projects.json'))) ?? [])
      this.projects.set(item.id, item);
  }
  async remember(item) {
    this.projects.set(item.id, item);
    this.registrySave = (this.registrySave ?? Promise.resolve())
      .catch(() => {})
      .then(() => writeJSON(join(this.data, 'projects.json'), [...this.projects.values()]));
    await this.registrySave;
    return item;
  }
  async create(path, options) {
    await mkdir(path, { recursive: true });
    path = await realpath(path);
    return this.serial('path:' + path, async () => {
      if ((await readdir(path)).length)
        throw new Error(
          'Choose an empty directory for a new project. Open an existing project by its path.',
        );
      return this.registerPath(path, options);
    });
  }
  async register(path, options) {
    path = await realpath(path);
    return this.serial('path:' + path, () => this.registerPath(path, options));
  }
  async registerPath(path, { title, example } = {}) {
    const manifestFile = join(path, 'story.vstory');
    let manifest = await readJSON(manifestFile);
    if (!manifest) {
      manifest = { format: 1, id: randomUUID(), title: title ?? basename(path), example };
      try {
        await writeFile(manifestFile, JSON.stringify(manifest), { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        manifest = await readJSON(manifestFile);
      }
    }
    if (manifest?.format !== 1 || !/^[a-f0-9-]{36}$/.test(manifest.id))
      throw new Error('Unsupported story.vstory manifest.');
    const known = this.projects.get(manifest.id);
    if (known && known.path !== path) {
      const previous = await realpath(known.path).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (previous && previous !== path) {
        manifest.id = randomUUID();
        await writeJSON(manifestFile, manifest);
      }
    }
    const item = await this.remember({
      ...this.projects.get(manifest.id),
      ...manifest,
      path,
      openedAt: new Date().toISOString(),
    });
    return this.serial(item.id, async () => {
      await this.recover(item);
      return this.inspect(item.id);
    });
  }
  get(id) {
    const p = this.projects.get(id);
    if (!p) throw new Error('Project is not open. Open its directory first.');
    return p;
  }
  async inspect(id) {
    const p = this.get(id),
      source = await projectFiles(p.path);
    return { ...p, sourceRevision: source.revision, files: source.files };
  }
  async list() {
    return [...this.projects.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }
  serial(id, work) {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.queues.set(id, next);
    void next
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id);
      })
      .catch(() => {});
    return next;
  }
  async read(id, name) {
    const file = await projectFile(this.get(id).path, name),
      bytes = await readFile(file);
    if (
      bytes.length > 1_000_000 ||
      bytes.includes(0) ||
      !Buffer.from(bytes.toString('utf8')).equals(bytes)
    )
      throw new Error('Use the local file path for binary or large source files.');
    return { file, content: bytes.toString('utf8'), digest: digest(bytes) };
  }
  async historyDirectory(project) {
    const directory = join(project.path, '.vstory');
    for (const path of [directory, join(directory, 'history')]) {
      await mkdir(path, { recursive: true });
      if ((await realpath(path)) !== path)
        throw new Error('Project history must be stored inside .vstory without links.');
    }
    return directory;
  }
  async recover(project) {
    const file = join(project.path, '.vstory/transaction.json'),
      journal = await readJSON(file);
    if (!journal) return;
    const directory = await this.historyDirectory(project);
    const cursor = (await readJSON(join(directory, 'history.json')))?.cursor ?? null;
    if (
      !validRequest(journal.requestId) ||
      !Array.isArray(journal.changes) ||
      journal.changes.length > 64 ||
      journal.changes.some(
        (entry) =>
          !entry ||
          [entry.before, entry.after].some((value) => value !== null && typeof value !== 'string'),
      ) ||
      !journal.history ||
      !validCursor(journal.history.before) ||
      !validCursor(journal.history.after) ||
      ![journal.history.before, journal.history.after].includes(cursor)
    )
      throw new Error(
        'Interrupted edit conflicts with the authoring history. Resolve .vstory/transaction.json first.',
      );
    for (const entry of journal.changes) {
      const current = await readOptional(
        await projectFile(project.path, entry.path, { writable: true }),
      );
      if (!matches(current, entry.before) && !matches(current, entry.after))
        throw conflict(entry.path);
    }
    // Recheck at each write boundary and after the whole series. Conflicts retain the journal.
    for (const entry of journal.changes) await this.write(project.path, entry);
    for (const entry of journal.changes) {
      const current = await readOptional(
        await projectFile(project.path, entry.path, { writable: true }),
      );
      if (!matches(current, entry.after)) throw conflict(entry.path);
    }
    await writeJSON(join(directory, 'history', journal.requestId + '.json'), journal);
    await writeJSON(join(directory, 'history.json'), { cursor: journal.history.after });
    await rm(file);
  }
  async write(root, entry) {
    const file = await projectFile(root, entry.path, { writable: true });
    const check = async () => {
      await projectFile(root, entry.path, { writable: true });
      const current = await readOptional(file);
      if (matches(current, entry.after)) return false;
      if (!matches(current, entry.before)) throw conflict(entry.path);
      return true;
    };
    if (!(await check())) return;
    if (entry.after === null) {
      await rm(file, { force: true });
      return;
    }
    await mkdir(dirname(file), { recursive: true });
    const mode = await stat(file).then(
      (info) => info.mode,
      (error) => {
        if (error.code === 'ENOENT') return 0o644;
        throw error;
      },
    );
    const temporary = join(dirname(file), '.vstory-edit-' + randomUUID());
    try {
      await writeFile(temporary, entry.after, { flag: 'wx', mode });
      if (await check()) await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  edit({ projectId, sourceRevision, requestId, changes, undo, assets = [] }) {
    if (!validRequest(requestId))
      throw new Error('requestId must contain 8–100 letters, digits, underscores or hyphens.');
    return this.serial(projectId, async () => {
      const p = this.get(projectId);
      await this.recover(p);
      const directory = await this.historyDirectory(p),
        journalPath = join(directory, 'transaction.json');
      const signature = digest(
        JSON.stringify({
          sourceRevision,
          changes,
          undo,
          assets: assets.map(({ path, hash }) => ({ path, hash })),
        }),
      );
      const prior = await readJSON(join(directory, 'history', requestId + '.json'));
      if (prior) {
        if (prior.signature !== signature)
          throw new Error('requestId already belongs to a different edit.');
        return { ...(await this.inspect(projectId)), requestId, repeated: true };
      }
      const state = await this.inspect(projectId);
      if (state.sourceRevision !== sourceRevision)
        throw failure(
          'source_conflict',
          `Source conflict. Expected ${sourceRevision}; current ${state.sourceRevision}. Read the changed files before retrying.`,
          {
            field: 'sourceRevision',
            current: { sourceRevision: state.sourceRevision },
            action: 'story_inspect',
          },
        );
      // Migration adds immutable packages; undo retains the previous package and restores its lockfile.
      for (const asset of assets) {
        if (!/^dependencies\/visual-storytelling-core-[a-f0-9]{64}\.tgz$/.test(asset.path))
          throw new Error('Migration assets must be content-addressed runtime archives.');
        const bytes = await readFile(asset.source);
        if (digest(bytes) !== asset.hash || !asset.path.includes(asset.hash))
          throw new Error('Runtime archive integrity changed.');
        const target = await projectFile(p.path, asset.path, { writable: true });
        await mkdir(dirname(target), { recursive: true });
        try {
          await copyFile(asset.source, target, constants.COPYFILE_EXCL);
        } catch (error) {
          if (error.code !== 'EEXIST' || digest(await readFile(target)) !== asset.hash) throw error;
        }
        state.files[asset.path] = asset.hash;
      }
      if (assets.length) {
        const current = await projectFiles(p.path);
        if (
          Object.keys(current.files).length !== Object.keys(state.files).length ||
          Object.entries(current.files).some(([name, hash]) => state.files[name] !== hash)
        )
          throw failure('source_conflict', 'Source changed while preparing the runtime update.', {
            action: 'story_inspect',
          });
        state.sourceRevision = current.revision;
      }
      const cursor = (await readJSON(join(directory, 'history.json')))?.cursor ?? null;
      if (!validCursor(cursor))
        throw new Error('Invalid authoring history cursor. Resolve .vstory/history.json first.');
      let next = requestId;
      if (undo) {
        const last = cursor && (await readJSON(join(directory, 'history', cursor + '.json')));
        if (!last) throw new Error('No authored edit to undo.');
        changes = last.changes.map((entry) => ({ path: entry.path, content: entry.before }));
        next = last.history.before;
        for (const entry of last.changes) {
          const current = state.files[entry.path] ?? null,
            expected = entry.after === null ? null : digest(entry.after);
          if (current !== expected)
            throw failure(
              'undo_conflict',
              `Undo would replace an external change in ${entry.path}. Read it first.`,
              { field: entry.path, action: 'story_inspect' },
            );
        }
      }
      if (
        !changes?.length ||
        changes.length > 64 ||
        new Set(changes.map((c) => c.path)).size !== changes.length
      )
        throw new Error('Supply 1–64 distinct authored files.');
      const edits = [];
      for (const change of changes) {
        const file = await projectFile(p.path, change.path, { writable: true });
        const bytes = await readOptional(file);
        if (
          bytes &&
          (bytes.length > 1_000_000 ||
            bytes.includes(0) ||
            !Buffer.from(bytes.toString('utf8')).equals(bytes))
        )
          throw new Error(
            `Use ordinary file tools for binary or large source files: ${change.path}`,
          );
        const before = bytes?.toString('utf8') ?? null;
        if (typeof change.content !== 'string' && change.content !== null)
          throw new Error('File content must be text or null for deletion.');
        if (
          change.content !== null &&
          (Buffer.byteLength(change.content) > 1_000_000 || change.content.includes('\0'))
        )
          throw new Error('Use ordinary file tools for binary content or changes over 1 MB.');
        if (before !== change.content)
          edits.push({ path: change.path, before, after: change.content });
      }
      if ((await projectFiles(p.path)).revision !== state.sourceRevision)
        throw new Error('Source changed while preparing this edit. Inspect before retrying.');
      const journal = {
        requestId,
        signature,
        createdAt: new Date().toISOString(),
        changes: edits,
        history: { before: cursor, after: edits.length ? next : cursor },
      };
      await writeJSON(journalPath, journal);
      await this.recover(p);
      return { ...(await this.inspect(projectId)), requestId };
    });
  }
}
