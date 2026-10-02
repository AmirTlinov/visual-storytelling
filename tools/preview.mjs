import { serve } from './site.mjs';
const site = await serve('site', 8794);
console.log(site.url);
