// ============================================================
// SERVICE WORKER — Bitácora PRO · Amigos por la Pesca
// Versión: 1.0.0
// Estrategia: Cache First para assets, Network First para datos
// ============================================================

const APP_VERSION   = 'v1.0.0';
const CACHE_STATIC  = `bitacora-pro-static-${APP_VERSION}`;
const CACHE_DYNAMIC = `bitacora-pro-dynamic-${APP_VERSION}`;
const CACHE_IMAGES  = `bitacora-pro-images-${APP_VERSION}`;

// Archivos que se cachean en la instalación (shell de la app)
const STATIC_ASSETS = [
  './',
  './index.html',
  './bitacora-pro.html',
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Rajdhani:wght@300;400;600;700&family=Exo+2:ital,wght@0,300;0,600;0,900;1,300&display=swap'
];

// Rutas que NUNCA se cachean (siempre red)
const NEVER_CACHE = [
  'chrome-extension',
  'googleapis.com/maps',
  'wa.me'
];

// ============================================================
// INSTALL — Pre-cachear el shell de la app
// ============================================================
self.addEventListener('install', event => {
  console.log(`[SW] Instalando ${CACHE_STATIC}...`);

  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        console.log('[SW] Pre-cacheando assets estáticos');
        // Intentamos cachear uno a uno para no fallar todo si uno falla
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn(`[SW] No se pudo cachear ${url}:`, err)
            )
          )
        );
      })
      .then(() => {
        console.log('[SW] Instalación completa — activando inmediatamente');
        return self.skipWaiting(); // Activar sin esperar a que cierren las tabs
      })
  );
});

// ============================================================
// ACTIVATE — Limpiar caches viejos
// ============================================================
self.addEventListener('activate', event => {
  console.log(`[SW] Activando ${APP_VERSION}...`);

  const validCaches = [CACHE_STATIC, CACHE_DYNAMIC, CACHE_IMAGES];

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => !validCaches.includes(name))
            .map(name => {
              console.log(`[SW] Eliminando cache viejo: ${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] Tomando control de todos los clientes');
        return self.clients.claim(); // Tomar control sin recargar
      })
  );
});

// ============================================================
// FETCH — Estrategia de caché según tipo de recurso
// ============================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar peticiones que no sean GET
  if (request.method !== 'GET') return;

  // Ignorar URLs que nunca se deben cachear
  if (NEVER_CACHE.some(pattern => request.url.includes(pattern))) return;

  // Ignorar extensiones del navegador
  if (url.protocol === 'chrome-extension:') return;

  // ── Fuentes de Google: Cache First (raramente cambian) ──
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // ── Imágenes: Cache First con fallback ──
  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request, CACHE_IMAGES));
    return;
  }

  // ── Navegación (HTML): Network First con fallback offline ──
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }

  // ── Todo lo demás: Stale While Revalidate ──
  event.respondWith(staleWhileRevalidate(request, CACHE_DYNAMIC));
});

// ============================================================
// ESTRATEGIAS DE CACHÉ
// ============================================================

/**
 * Cache First: sirve desde caché; si no está, va a red y guarda.
 * Ideal para: fuentes, imágenes, assets que no cambian.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

/**
 * Network First: intenta red primero; si falla, usa caché.
 * Con página offline de fallback para navegación.
 */
async function networkFirstWithOfflineFallback(request) {
  const cache = await caches.open(CACHE_STATIC);

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Fallback: intentar servir el shell principal
    const shell = await cache.match('./') || await cache.match('./index.html') || await cache.match('./bitacora-pro.html');
    if (shell) return shell;

    // Último recurso: página offline inline
    return new Response(offlineHTML(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

/**
 * Stale While Revalidate: sirve desde caché inmediatamente
 * y actualiza en background.
 * Ideal para: JS, CSS, recursos dinámicos.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || offlineFallback(request);
}

/**
 * Fallback genérico para recursos no encontrados offline.
 */
function offlineFallback(request) {
  if (request.destination === 'image') {
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
        <rect width="200" height="200" fill="#0d1425"/>
        <text x="100" y="110" font-size="60" text-anchor="middle">🎣</text>
      </svg>`,
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  return new Response('', { status: 408, statusText: 'Offline' });
}

// ============================================================
// PÁGINA OFFLINE INLINE
// ============================================================
function offlineHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sin conexión — Bitácora PRO</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #040810;
      color: #f0f4ff;
      font-family: 'Rajdhani', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
      padding: 24px;
      gap: 20px;
    }
    .icon { font-size: 72px; animation: float 3s ease-in-out infinite; }
    @keyframes float {
      0%,100% { transform: translateY(0); }
      50% { transform: translateY(-12px); }
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: #c9a227;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    p { font-size: 15px; color: rgba(240,244,255,0.5); line-height: 1.6; max-width: 280px; }
    .btn {
      margin-top: 8px;
      padding: 14px 32px;
      background: linear-gradient(135deg, #c9a227, #e8b830);
      color: #040810;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 1px;
      cursor: pointer;
      text-transform: uppercase;
    }
    .badge {
      padding: 6px 16px;
      background: rgba(229,57,53,0.15);
      border: 1px solid rgba(229,57,53,0.4);
      border-radius: 20px;
      font-size: 12px;
      color: #ff6b6b;
      letter-spacing: 2px;
    }
  </style>
</head>
<body>
  <div class="icon">🎣</div>
  <div class="badge">● SIN CONEXIÓN</div>
  <h1>Bitácora PRO</h1>
  <p>No hay conexión a internet. Tus datos están seguros guardados localmente en el dispositivo.</p>
  <button class="btn" onclick="location.reload()">↺ Reintentar</button>
</body>
</html>`;
}

// ============================================================
// MENSAJE DESDE LA APP (ej: forzar actualización)
// ============================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Actualización forzada por la app');
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => console.log('[SW] Todos los caches eliminados'));
  }
});
