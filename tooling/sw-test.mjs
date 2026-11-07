import vm from 'node:vm';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const callbacks={},assets=new Map(),old=new Map();let claimed=false;
const cache={async addAll(files){for(const file of files){const path=file==='./'?'index.html':file.slice(2);const bytes=await fs.readFile(new URL('../oneul/'+path,import.meta.url));assert.ok(bytes.length>0);assets.set(new URL(file,'https://example.test/oneul/').href,bytes);} },async match(request){const href=typeof request==='string'?new URL(request,'https://example.test/oneul/').href:request.url.split('?')[0];return assets.get(href);}};
const context={URL,console,self:{location:{href:'https://example.test/oneul/sw.js',origin:'https://example.test'},addEventListener:(name,fn)=>callbacks[name]=fn,clients:{claim:async()=>claimed=true}},caches:{open:async()=>cache,keys:async()=>['unrelated-cache','oneul-old'],delete:async key=>old.set(key,true)},fetch:async()=>{throw new Error('offline')}};
vm.runInNewContext(await fs.readFile(new URL('../oneul/sw.js',import.meta.url),'utf8'),context);
let p;callbacks.install({waitUntil:value=>p=value});await p;
callbacks.activate({waitUntil:value=>p=value});await p;assert.equal(claimed,true);assert.ok(old.has('oneul-old'));assert.ok(!old.has('unrelated-cache'));
for(const path of ['','app.js','db.js','settings.js','goals.js','goals.css','icons.js','style.css','manifest.json','vendor/dexie.mjs','vendor/PretendardVariable.woff2']){callbacks.fetch({request:{url:'https://example.test/oneul/'+path,method:'GET',mode:path===''?'navigate':'cors'},respondWith:value=>p=value});assert.ok((await p)?.length,`offline ${path}`);}
console.log(`PASS ${assets.size} cached responses, subpath scope, offline navigation/modules/font, old cache cleanup`);
