import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:'examples',resolve:{alias:[
 {find:'@visual-storytelling/core/style.css',replacement:fileURLToPath(new URL('./src/style.css',import.meta.url))},
 {find:'@visual-storytelling/core/three',replacement:fileURLToPath(new URL('./src/viewport/index.ts',import.meta.url))},
 {find:'@visual-storytelling/core',replacement:fileURLToPath(new URL('./src/index.ts',import.meta.url))}
]}});
