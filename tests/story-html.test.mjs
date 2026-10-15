import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { withStoryDocument, inStoryHead, inStoryBody } from '../tools/story-html.mjs';
import { withCheckpoint } from '../tools/standalone.mjs';

const scripts = (html) => {
  const result = [];
  const visit = (node) => {
    if (node.tagName === 'script') result.push(node.childNodes.map((n) => n.value ?? '').join(''));
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(parse(html));
  return result;
};

test('head and body insertions follow HTML locations through comments and authored raw text', () => {
  const html =
    '<html><!-- </head> --><head><script>window.head="</head>";window.body="</body>";</script><style>p:before{content:"</head>"}</style></head><body><p>one</p></body></html>';
  const source = { title: '</script><b>data</b>' };
  let result = withStoryDocument(html, source);
  result = inStoryHead(result, '<script>window.adapter=true;</script>');
  result = inStoryBody(result, '<script>window.footer=true;</script>');
  const window = {};
  for (const code of scripts(result)) new Function('window', code)(window);
  assert.deepEqual(window, {
    head: '</head>',
    body: '</body>',
    __visualStoryDocument: source,
    adapter: true,
    footer: true,
  });
  assert(result.includes('<style>p:before{content:"</head>"}</style>'));
  assert(result.endsWith('<script>window.footer=true;</script></body></html>'));
});

test('portable checkpoint does not modify a body-closing string in the scene program', () => {
  const html =
    '<html><head></head><body><script>window.literal="</body>";</script><main class="ve-scene"></main></body></html>';
  const result = withCheckpoint(html, { values: { count: 17 }, time: 0 });
  const code = scripts(result);
  assert.equal(code.length, 2);
  const window = {};
  new Function('window', code[0])(window);
  assert.equal(window.literal, '</body>');
  assert.match(code[1], /await scene\.restore/);
  assert.match(code[1], /"count":17/);
  assert.equal(
    inStoryBody('<main>fragment</main>', '<script>one</script>'),
    '<main>fragment</main><script>one</script>',
  );
});
