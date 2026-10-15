import { parse } from '@babel/parser';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, relative, sep } from 'node:path';
import { voiceDigest, voiceBytesDigest as hash } from './receipt.mjs';
const ignored = new Set(['node_modules', 'dist', 'site', 'artifacts', 'review', '__pycache__']);
const outputs = new Set([
  'audio.wav',
  'voice.wav',
  'music.wav',
  'timeline.json',
  'narration.txt',
  'voice-preview.html',
  'CREDITS.txt',
  'voice.json',
]);
/** Public settings contain portable selection only. Secrets belong to the process environment. */
export function validateAdapterSettings(settings) {
  if (!settings || !['local', 'api'].includes(settings.provider))
    throw new Error('Choose provider "local" or "api" for a voice adapter.');
  const allowed = new Set(['provider', 'adapter', 'model', 'voice', 'language', 'enabled']);
  if (Object.keys(settings).some((key) => !allowed.has(key)))
    throw new Error(
      'Voice adapters accept provider, adapter, model, voice, language and enabled. Keep credentials in environment variables.',
    );
  const text = (value, label, maximum = 200) => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > maximum ||
      /[\x00-\x1f]/.test(value)
    )
      throw new Error(`Voice adapter ${label} must be a non-empty plain string.`);
    return value.trim();
  };
  const adapter = text(settings.adapter, 'adapter', 1000);
  if (
    isAbsolute(adapter) ||
    adapter.includes('\\') ||
    !adapter.endsWith('.mjs') ||
    adapter.split('/').some((part) => !part || part.startsWith('.') || ignored.has(part))
  )
    throw new Error(
      'Voice adapter must be a project-relative .mjs file, for example voice/adapter.mjs.',
    );
  if (settings.enabled !== undefined && typeof settings.enabled !== 'boolean')
    throw new Error('Voice adapter enabled must be boolean.');
  return {
    provider: settings.provider,
    adapter,
    model: text(settings.model, 'model'),
    ...(settings.voice !== undefined && { voice: text(settings.voice, 'voice') }),
    language: settings.language === undefined ? 'ru-RU' : text(settings.language, 'language', 35),
    ...(settings.enabled !== undefined && { enabled: settings.enabled }),
  };
}

export const adapterSelection = (settings) => {
  const { enabled, ...sound } = validateAdapterSettings(settings);
  return sound;
};

/** A small adapter directory and its sibling assets form one verifiable implementation. */
async function adapterImplementation(directory, settings) {
  const root = await realpath(directory);
  let entry = root;
  for (const part of settings.adapter.split('/')) {
    entry = join(entry, part);
    if ((await lstat(entry)).isSymbolicLink())
      throw new Error('Voice adapter files must stay inside the project without symbolic links.');
  }
  if (!(await lstat(entry)).isFile())
    throw new Error('Voice adapter entry must be a regular file.');
  const folder = dirname(entry),
    files = {};
  async function visit(path, prefix = '') {
    for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (
        item.name.startsWith('.') ||
        ignored.has(item.name) ||
        item.name.endsWith('.pyc') ||
        (path === root && outputs.has(item.name))
      )
        continue;
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      const file = join(path, item.name);
      if (item.isSymbolicLink())
        throw new Error(
          'Voice adapter dependencies must stay inside the project without symbolic links.',
        );
      if (item.isDirectory()) await visit(file, name);
      else if (item.isFile()) files[name] = hash(await readFile(file));
      else throw new Error('Voice adapter dependencies must be regular files.');
    }
  }
  await visit(folder);
  return { entry, identity: voiceDigest({ version: 1, adapter: settings.adapter, files }) };
}

/** A root entry owns its explicit local code/assets, never unrelated authoring files. */
export async function adapterInput(directory, settings) {
  if (settings.adapter.includes('/')) return adapterImplementation(directory, settings);
  const root = await realpath(directory),
    files = {},
    seen = new Set();
  async function visit(file) {
    const name = relative(root, file);
    if (name.startsWith('..' + sep) || name === '..' || isAbsolute(name))
      throw new Error('Voice adapter dependencies must stay inside the project.');
    let at = root;
    for (const part of name.split(sep)) {
      at = join(at, part);
      if ((await lstat(at)).isSymbolicLink())
        throw new Error('Voice adapter dependencies cannot be symbolic links.');
    }
    if (!(await lstat(file)).isFile())
      throw new Error('Voice adapter dependencies must be regular files.');
    if (seen.has(name)) return;
    seen.add(name);
    const bytes = await readFile(file);
    files[name] = hash(bytes);
    if (!/\.[cm]?js$/.test(name)) return;
    const ast = parse(bytes.toString('utf8'), { sourceType: 'module' }),
      references = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (
        ['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration'].includes(
          node.type,
        ) &&
        node.source
      )
        references.push(node.source.value);
      if (
        node.type === 'CallExpression' &&
        (node.callee?.type === 'Import' || node.callee?.name === 'require')
      ) {
        if (node.arguments[0]?.type !== 'StringLiteral')
          throw new Error(
            'A root voice adapter needs literal imports; put dynamic implementation in its own folder.',
          );
        references.push(node.arguments[0].value);
      }
      if (
        node.type === 'NewExpression' &&
        node.callee?.name === 'URL' &&
        node.arguments[1]?.object?.type === 'MetaProperty'
      ) {
        if (node.arguments[0]?.type !== 'StringLiteral')
          throw new Error(
            'A root voice adapter needs literal resource URLs; put dynamic implementation in its own folder.',
          );
        const reference = node.arguments[0].value;
        if (!/^[a-z][\w+.-]*:/i.test(reference))
          references.push(reference.startsWith('.') ? reference : './' + reference);
      }
      for (const value of Object.values(node))
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
    };
    walk(ast);
    for (const reference of references) {
      if (reference.startsWith('node:')) continue;
      if (!reference.startsWith('.'))
        throw new Error(
          'A root voice adapter with package dependencies needs its own implementation folder.',
        );
      await visit(resolve(dirname(file), reference));
    }
  }
  const entry = join(root, settings.adapter);
  await visit(entry);
  return { entry, identity: voiceDigest({ version: 1, adapter: settings.adapter, files }) };
}

/** Only explicit migration verifies the former root-directory fingerprint. */
export async function historicalRootAdapterInput(directory, settings) {
  if (settings.adapter.includes('/'))
    throw new Error('Historical root adapter binding needs a root entry.');
  return adapterImplementation(directory, settings);
}

export async function adapterVoiceStatus(directory, settings) {
  try {
    const config = validateAdapterSettings(settings);
    if (!directory) throw new Error('Choose a project containing the voice adapter.');
    await adapterInput(directory, config);
    return {
      supported: true,
      ready: true,
      voices: [{ id: config.voice ?? config.model, name: config.model, language: config.language }],
    };
  } catch {
    return {
      supported: true,
      ready: false,
      voices: [],
      reason:
        'Configure a local or API model and a regular project-relative .mjs voice adapter. Discovery does not run it or contact the provider.',
    };
  }
}
