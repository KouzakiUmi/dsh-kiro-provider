import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = new URL('src/', root);
const output = new URL('lib/', root);
await mkdir(output, { recursive: true });
for (const name of await readdir(source)) if (name.endsWith('.mjs')) {
  await copyFile(new URL(name, source), new URL(name, output));
}
const shared = (await readFile(new URL('remote.mjs', source), 'utf8')).replace(/^export /gm, '');
const client = (await readFile(new URL('client.js', source), 'utf8')).replace(/^export /gm, '');
await writeFile(new URL('client.js', output), `window.__ModuleLoader__.load({id:'dsh-kiro-provider',factory:(require)=>{\n'use strict';\n${shared}\n${client}\nreturn {name,inject,apply};\n}});\n`);
