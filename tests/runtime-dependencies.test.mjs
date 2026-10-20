import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('the emitted library has no runtime dependency cycles', async () => {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => resolve(entry.parentPath, entry.name));
  const modules = new Set(files),
    graph = new Map();
  assert.ok(modules.has(resolve(root, 'index.js')), 'build the library before checking its graph');
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const dependencies = new Set();
    const add = (specifier) => {
      if (specifier?.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        if (modules.has(target)) dependencies.add(target);
      }
    };
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        add(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        add(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    graph.set(file, dependencies);
  }
  const complete = new Set(),
    active = new Set(),
    stack = [];
  const visit = (file) => {
    if (active.has(file)) {
      const cycle = [...stack.slice(stack.indexOf(file)), file].map((path) => relative(root, path));
      assert.fail(`Runtime dependency cycle: ${cycle.join(' → ')}`);
    }
    if (complete.has(file)) return;
    active.add(file);
    stack.push(file);
    for (const dependency of graph.get(file)) visit(dependency);
    stack.pop();
    active.delete(file);
    complete.add(file);
  };
  for (const file of files) visit(file);
});
