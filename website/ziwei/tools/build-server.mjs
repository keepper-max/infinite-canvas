import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({absWorkingDir:fileURLToPath(new URL('../',import.meta.url)),entryPoints:['server/main.ts'],outfile:'server-dist/main.cjs',bundle:true,platform:'node',format:'cjs',target:'node22',packages:'external'});
console.log('Built private website backend (excluded from public whitelist).');
