const CACHE = "lead-tracker-v5";
const FILES = ["./", "./index.html", "./styles.css", "./app.js", "./firebase-config.js", "./manifest.webmanifest"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener("fetch", event => event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request))));
