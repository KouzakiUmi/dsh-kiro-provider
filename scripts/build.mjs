import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = new URL('src/', root);
const output = new URL('lib/', root);
await mkdir(output, { recursive: true });
for (const name of await readdir(source)) if (name.endsWith('.mjs')) {
  await copyFile(new URL(name, source), new URL(name, output));
}

// Client modules share one factory scope after concatenation: no imports, cross-module
// references are bare identifiers. Order is dependency-first; new modules must register here.
const clientModules = [
  'remote.mjs',
  'client/styles.js',
  'client/kit.js',
  'client/store.js',
  'client/login.js',
  'client/connection.js',
  'client/models.js',
  'client/usage.js',
  'client/advanced.js',
  'client/pill.js',
  'client/settings.js',
  'client/index.js',
];
let bundle = '';
for (const name of clientModules) {
  const text = await readFile(new URL(name, source), 'utf8');
  for (const line of text.split('\n')) {
    if (/^export /.test(line) && !/^export (const|function|async function|class) /.test(line)) {
      throw new Error(`client module ${name}: unsupported export shape: ${line.slice(0, 80)}`);
    }
  }
  bundle += `${text.replace(/^export /gm, '')}\n`;
}
const factory = `window.__ModuleLoader__.load({id:'dsh-kiro-provider',factory:(require)=>{\n'use strict';\nconst React = require('react');\nconst h = React.createElement;\n${bundle}\nreturn {name,inject,apply,createKiroStore,normalizeLogin,registerContextPill,kit:{Section,ListBox,Switch,Row,Chip,Notice,EmptyState,Meter,RelativeDeadline,NumberField,button},ModelsPanel,UsagePanel,AdvancedPanel,LoginPanel,ConnectionPanel,Settings,quotaStatusView,sortModelsByEnabled,filterModels,tabAfter};\n}});\n`;
new vm.Script(factory);
await writeFile(new URL('client.js', output), factory);