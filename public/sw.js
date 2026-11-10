/* Service Worker — แคชตัวแอปไว้ในเครื่อง ให้เปิดได้แม้เน็ตหลุด
   ข้อมูลจริงอยู่ใน Firestore (มีแคชของตัวเองใน IndexedDB) จึงไม่ยุ่งกับคำขอไป Firestore/Google login */
const CACHE = 'classhub-v5';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/api.js', '/fb.js', '/config.js', '/manifest.webmanifest',
  '/icons/ch-icon-192.png', '/icons/ch-icon-512.png', '/icons/ch-icon-maskable-512.png', '/icons/ch-apple-touch-icon.png', '/icons/ch-favicon-48.png'];
const CDN = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ไลบรารีจาก CDN (Firebase SDK, ฟอนต์, ตัวอ่าน Excel): ใช้ของในเครื่องก่อน
  if (CDN.includes(url.hostname)) {
    if (url.hostname === 'www.gstatic.com' && !url.pathname.startsWith('/firebasejs/')) return;
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/__/')) return;   // หน้า login ของ Firebase

  // ไฟล์ของแอป: ลองเน็ตก่อน (ได้เวอร์ชันล่าสุด) ถ้าไม่มีเน็ตใช้ของในเครื่อง
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/index.html') : undefined))));
});
