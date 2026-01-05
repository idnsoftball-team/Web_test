// 變更快取名稱以確保更新後的文件能被載入（每次發版請遞增）
const CACHE_NAME = 'static-v20260105-1';

// 使用相對路徑：避免 GitHub Pages 專案站（/repo/）因為絕對路徑 (/) 造成快取命中錯誤
const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  if (evt.request.method !== 'GET') return;
  const req = evt.request;
  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.includes('text/html');

  // HTML 採 Network-first：確保發版後能拿到最新 UI
  if (isHTML) {
    evt.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 其他靜態檔案採 Cache-first
  evt.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});