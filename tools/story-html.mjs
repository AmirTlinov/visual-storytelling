import { parse } from 'parse5';

/** Authored JSON is data even when an offline page carries it inside a script. */
export const storyDocumentScript = (document) =>
  `<script>window.__visualStoryDocument=${JSON.stringify(document).replaceAll('<', '\\u003c')};</script>`;

export function withStoryDocument(html, document) {
  return inStoryHead(html, storyDocumentScript(document));
}
export function headInsertionOffset(html) {
  const root = parse(html, { sourceCodeLocationInfo: true });
  const head = root.childNodes
    .find((node) => node.tagName === 'html')
    ?.childNodes.find((node) => node.tagName === 'head');
  const offset = head?.sourceCodeLocation?.endTag?.startOffset;
  if (!Number.isInteger(offset)) throw new Error('A document presentation needs an explicit head.');
  return offset;
}

export function inStoryHead(html, content) {
  const offset = headInsertionOffset(html);
  return html.slice(0, offset) + content + html.slice(offset);
}

export function inStoryBody(html, content) {
  const root = parse(html, { sourceCodeLocationInfo: true });
  const body = root.childNodes
    .find((node) => node.tagName === 'html')
    ?.childNodes.find((node) => node.tagName === 'body');
  const offset = body?.sourceCodeLocation?.endTag?.startOffset ?? html.length;
  return html.slice(0, offset) + content + html.slice(offset);
}
