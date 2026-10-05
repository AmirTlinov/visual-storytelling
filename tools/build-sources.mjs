import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath, access } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { parse } from '@babel/parser';

export const sourceHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (root, file) => {
  const path = relative(root, file).split(sep).join('/');
  return path && !path.startsWith('../') ? path : undefined;
};

const modulePath = /^@visual-storytelling\/core(?:\/(?:ink|story|three))?$/;
const operations = new Set([
  'add',
  'divide',
  'multiply',
  'power',
  'exponential',
  'map',
  'calculate',
  'dot',
  'vectorAdd',
  'apply',
  'chain',
  'formula',
  'body',
  'plan',
]);
const children = (node) =>
  Object.entries(node).flatMap(([key, value]) =>
    ['loc', 'comments', 'tokens', 'extra'].includes(key)
      ? []
      : Array.isArray(value)
        ? value.filter((item) => item?.type)
        : value?.type
          ? [value]
          : [],
  );
function identifiers(pattern) {
  if (!pattern) return [];
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'RestElement') return identifiers(pattern.argument);
  if (pattern.type === 'AssignmentPattern') return identifiers(pattern.left);
  if (pattern.type === 'TSParameterProperty') return identifiers(pattern.parameter);
  if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(identifiers);
  if (pattern.type === 'ObjectPattern')
    return pattern.properties.flatMap((p) => identifiers(p.value ?? p.argument));
  return [];
}

/** Exact lexical bindings only. Dynamic factories and reassigned handles remain unavailable. */
function authoredBindings(ast) {
  const locations = new WeakMap(),
    nodes = [],
    mutations = [];
  const functions = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ObjectMethod',
    'ClassMethod',
    'ClassPrivateMethod',
  ]);
  const scoped = new Set([
    'Program',
    'BlockStatement',
    'CatchClause',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'ClassDeclaration',
    'ClassExpression',
    'SwitchStatement',
    'StaticBlock',
  ]);
  const lookup = (scope, name) => {
    for (let at = scope; at; at = at.parent)
      if (at.bindings.has(name)) return at.bindings.get(name);
  };
  const declare = (scope, pattern, value = {}) => {
    for (const name of identifiers(pattern)) scope.bindings.set(name, value);
  };
  function visit(node, parent, scope) {
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration')
      declare(scope, node.id);
    if (functions.has(node.type) || scoped.has(node.type))
      scope = {
        parent: scope,
        bindings: new Map(),
        function:
          functions.has(node.type) || node.type === 'Program' || node.type === 'StaticBlock',
      };
    locations.set(node, scope);
    nodes.push(node);
    if (functions.has(node.type)) {
      declare(scope, node.id);
      node.params.forEach((param) => declare(scope, param));
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression')
      declare(scope, node.id);
    if (node.type === 'CatchClause') declare(scope, node.param);
    if (node.type === 'ImportDeclaration')
      for (const specifier of node.specifiers) {
        const api = modulePath.test(node.source.value)
          ? specifier.type === 'ImportNamespaceSpecifier'
            ? ''
            : (specifier.imported?.name ?? specifier.imported?.value)
          : undefined;
        declare(scope, specifier.local, { api });
      }
    if (node.type === 'VariableDeclarator') {
      let at = scope;
      if (parent.kind === 'var') while (!at.function) at = at.parent;
      declare(
        at,
        node.id,
        parent.kind === 'const' && node.id.type === 'Identifier' ? { init: node.init, scope } : {},
      );
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression')
      mutations.push([node.left ?? node.argument, scope]);
    if (node.type === 'UnaryExpression' && node.operator === 'delete')
      mutations.push([node.argument, scope]);
    if (['ForInStatement', 'ForOfStatement'].includes(node.type))
      mutations.push([node.left, scope]);
    for (const child of children(node)) visit(child, node, scope);
  }
  visit(ast.program, null, undefined);
  // Mutation anywhere in a lexical owner invalidates that automatic mapping conservatively.
  function invalidate(node, scope, seen = new Set()) {
    if (!node) return;
    if (node.type === 'MemberExpression') return invalidate(node.object, scope, seen);
    if (node.type === 'Identifier') {
      const binding = lookup(scope, node.name);
      if (!binding || seen.has(binding)) return;
      seen.add(binding);
      binding.changed = true;
      // An alias still refers to its imported API or handle. A constructor call owns a new value.
      if (['Identifier', 'MemberExpression'].includes(binding.init?.type))
        invalidate(binding.init, binding.scope, seen);
    } else if (node.type === 'ObjectPattern') {
      for (const property of node.properties)
        invalidate(property.value ?? property.argument, scope, seen);
    } else if (node.type === 'ArrayPattern') {
      for (const item of node.elements) invalidate(item, scope, seen);
    } else if (node.type === 'RestElement' || node.type === 'AssignmentPattern') {
      invalidate(node.argument ?? node.left, scope, seen);
    }
  }
  for (const [node, scope] of mutations) invalidate(node, scope);
  function value(node, scope = locations.get(node), seen = new Set()) {
    if (!node) return;
    if (
      [
        'TSAsExpression',
        'TSTypeAssertion',
        'TSNonNullExpression',
        'ParenthesizedExpression',
      ].includes(node.type)
    )
      return value(node.expression, scope, seen);
    if (node.type === 'Identifier') {
      const binding = lookup(scope, node.name);
      if (!binding || binding.changed || seen.has(binding)) return;
      seen.add(binding);
      return binding.api !== undefined
        ? { api: binding.api }
        : value(binding.init, binding.scope, seen);
    }
    if (node.type === 'MemberExpression' && !node.computed) {
      const owner = value(node.object, scope, seen);
      if (owner?.api !== undefined)
        return { api: [owner.api, node.property.name].filter(Boolean).join('.') };
    }
    if (node.type === 'CallExpression') {
      const api = value(node.callee, scope, seen)?.api;
      if (api === 'Viewport3D.mount') return { api: 'Viewport' };
      if (api === 'object') return { api: 'InkObject' };
    }
    if (node.type === 'ObjectExpression' || node.type === 'ArrayExpression') return { node };
  }
  return { nodes, value };
}

/** Annotate authoring boundaries before asset rewriting, so spans refer to unchanged input text. */
export function annotateSources(source, file, helper) {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    plugins: [
      ...(/\.[cm]?tsx?$/.test(file) ? ['typescript'] : []),
      ...(/\.[jt]sx$/.test(file) ? ['jsx'] : []),
    ],
  });
  const bindings = authoredBindings(ast),
    tagged = new Map();
  const mark = (node, kind) => {
    if (node && node.type !== 'SpreadElement') tagged.set(node, kind);
  };
  for (const call of bindings.nodes.filter((node) => node.type === 'CallExpression')) {
    const api = bindings.value(call.callee)?.api;
    if (api === 'describeObject') mark(call.arguments[1], 'object');
    if (api === 'Viewport.describe') mark(call.arguments[2], 'object');
    if (api === 'InkObject.describe') mark(call.arguments[0], 'object');
    if (api?.startsWith('MathMorph.') && operations.has(api.slice('MathMorph.'.length)))
      mark(call, 'operation');
    if (api === 'SceneStory.mount') {
      const options = bindings.value(call.arguments[1])?.node;
      const property = options?.properties?.find(
        (p) => !p.computed && (p.key?.name ?? p.key?.value) === 'chapters',
      );
      const chapters = bindings.value(property?.value)?.node;
      if (chapters?.type === 'ArrayExpression')
        for (const chapter of chapters.elements) mark(bindings.value(chapter)?.node, 'chapter');
    }
  }
  if (!tagged.size) return source;
  let prefix = '__vstorySource';
  while (source.includes(prefix)) prefix += '_';
  const hash = sourceHash(source),
    spans = [],
    edits = [];
  for (const [node, kind] of tagged) {
    const index =
      spans.push({
        file,
        hash,
        kind,
        start: node.start,
        end: node.end,
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
        endLine: node.loc.end.line,
        endColumn: node.loc.end.column + 1,
      }) - 1;
    edits.push(
      { at: node.start, value: `${prefix}At(` },
      { at: node.end, value: `,${prefix}Spans[${index}])` },
    );
  }
  for (const edit of edits.sort((a, b) => b.at - a.at))
    source = source.slice(0, edit.at) + edit.value + source.slice(edit.at);
  const head = `import {sourceAt as ${prefix}At} from ${JSON.stringify(helper)};\nconst ${prefix}Spans=${JSON.stringify(spans)};\n`;
  const at = ast.program.interpreter ? source.indexOf('\n') + 1 : 0;
  return source.slice(0, at) + head + source.slice(at);
}

export async function sourceAnnotations({ directory, runtimeRoot, sourcePackage = false }) {
  if (!runtimeRoot) return;
  const helper = resolve(
    runtimeRoot,
    sourcePackage ? 'src/scene-source.ts' : 'dist/scene-source.js',
  );
  try {
    await access(helper);
  } catch (error) {
    if (error.code === 'ENOENT') return; // A pinned earlier runtime has no origin contract.
    throw error;
  }
  // Generator children can bundle temporary modules; only their parent's authored tree is editable.
  directory = await realpath(process.env.VISUAL_STORY_SOURCE ?? directory);
  const generated =
    process.env.VISUAL_STORY_OUTPUT && (await realpath(process.env.VISUAL_STORY_OUTPUT));
  return async (source, file) => {
    const local = within(directory, file);
    if (!local || local.split('/').includes('node_modules')) return source;
    file = await realpath(file);
    if (generated && within(generated, file)) return source;
    const path = within(directory, file);
    if (!path || path.split('/').includes('node_modules')) return source;
    return annotateSources(source, path, helper);
  };
}

/** Build inputs, not the reviewing CLI's checkout, own source links in a capture. */
export async function writeSourceReferences(bundle, metafile, { directory, runtimeRoot }) {
  const inputs = [];
  directory = await realpath(process.env.VISUAL_STORY_SOURCE ?? directory);
  const generated =
    process.env.VISUAL_STORY_OUTPUT && (await realpath(process.env.VISUAL_STORY_OUTPUT));
  if (runtimeRoot) runtimeRoot = await realpath(runtimeRoot);
  for (const input of Object.keys(metafile.inputs)) {
    // Inline entry points and other virtual modules have no local owner to open.
    let file;
    try {
      file = await realpath(resolve(input));
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue;
      throw error;
    }
    const local = !(generated && within(generated, file)) && within(directory, file),
      runtime = runtimeRoot && within(runtimeRoot, file),
      references = [];
    if (local && !local.split('/').includes('node_modules')) references.push(local);
    if (runtime?.startsWith('src/')) references.push(runtime);
    if (runtime?.startsWith('dist/') && runtime.endsWith('.js'))
      references.push(runtime.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'));
    if (!references.length) continue;
    inputs.push({
      file,
      hash: sourceHash(await readFile(file)),
      references: [...new Set(references)],
    });
  }
  await writeFile(
    bundle + '.sources.json',
    JSON.stringify({ version: 1, bundle: sourceHash(await readFile(bundle)), inputs }) + '\n',
  );
}
