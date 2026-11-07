// Generated asset list. Change cache version after editing app assets.
const CACHE = 'oneul-fcc1b568be65';
const FILES = [
  "./",
  "./app.js",
  "./db.js",
  "./goals.css",
  "./goals.js",
  "./icons.js",
  "./icons/app-192.png",
  "./icons/app-512.png",
  "./icons/app-maskable-512.png",
  "./icons/app.svg",
  "./icons/arrow-left.svg",
  "./icons/arrow-up-right.svg",
  "./icons/book-open.svg",
  "./icons/briefcase.svg",
  "./icons/calendar.svg",
  "./icons/check.svg",
  "./icons/chevron-left.svg",
  "./icons/chevron-right.svg",
  "./icons/chevrons-left.svg",
  "./icons/chevrons-right.svg",
  "./icons/compass.svg",
  "./icons/download.svg",
  "./icons/grip-vertical.svg",
  "./icons/heart-pulse.svg",
  "./icons/leaf.svg",
  "./icons/moon.svg",
  "./icons/palette.svg",
  "./icons/plus.svg",
  "./icons/settings.svg",
  "./icons/smile.svg",
  "./icons/sun.svg",
  "./icons/upload.svg",
  "./icons/users.svg",
  "./icons/wallet.svg",
  "./icons/x.svg",
  "./index.html",
  "./manifest.json",
  "./settings.js",
  "./style.css",
  "./vendor/DEXIE-LICENSE",
  "./vendor/LUCIDE-LICENSE",
  "./vendor/PRETENDARD-LICENSE",
  "./vendor/PretendardVariable.woff2",
  "./vendor/dexie.mjs"
];
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
