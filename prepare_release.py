"""Maintainer-only release preparation; the deployed app needs no build."""
from pathlib import Path
import hashlib, json, re
from PIL import Image, ImageDraw

root = Path(__file__).parent / 'oneul'
icon_map={p.stem:re.sub(r'^.*?<svg[^>]*>|</svg>\s*$','',p.read_text(),flags=re.S) for p in (root/'icons').glob('*.svg') if p.stem!='app'}
(root/'icons.js').write_text('export default '+json.dumps(icon_map,ensure_ascii=False)+';\n')
# Machine-precision app icon, no network or generated image assets.
for name, size, maskable in [('app-192.png',192,False),('app-512.png',512,False),('app-maskable-512.png',512,True)]:
    im=Image.new('RGB',(512,512),'#F3F6F2'); d=ImageDraw.Draw(im)
    d.ellipse((100,100,412,412),fill='#E4EEE7')
    d.rounded_rectangle((173,175,339,342),radius=80,fill='#5E8B72')
    d.line((185,330,289,226),fill='#F3F6F2',width=16)
    d.ellipse((319,143,355,179),fill='#E8B86B')
    im.resize((size,size),Image.Resampling.LANCZOS).save(root/'icons'/name)

assets=sorted('./'+str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.suffix not in {'.md'} and p.name not in {'sw.js','db.test.mjs','.nojekyll'})
digest=hashlib.sha256(b''.join((root/p[2:]).read_bytes() for p in assets)).hexdigest()[:12]
sw="""// Generated asset list. Change cache version after editing app assets.
const CACHE = 'oneul-__HASH__';
const FILES = __FILES__;
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('oneul-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL('./',self.location.href).pathname))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    if(event.request.mode==='navigate')return (await cache.match('./index.html'))||fetch(event.request);
    return (await cache.match(event.request,{ignoreSearch:true}))||fetch(event.request);
  }));
});
""".replace('__HASH__',digest).replace('__FILES__',json.dumps(['./',*assets],ensure_ascii=False,indent=2))
(root/'sw.js').write_text(sw)
(root/'.nojekyll').touch()
print(f'Prepared {len(assets)} offline files, cache oneul-{digest}')
