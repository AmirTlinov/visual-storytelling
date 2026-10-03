import { extname } from 'node:path';

/** Resource types shared by scene building, the local server and offline packaging. */
const mediaTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
};
export const mediaType = (path) =>
  mediaTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
export const sceneAsset = (path) => {
  const extension = extname(path).toLowerCase();
  return extension in mediaTypes && !['.html', '.js'].includes(extension);
};
