/* =============================================================================
 * sw.js —— FPGA Synth Studio PWA Service Worker
 * 目标：现场断网也能完整运行（预缓存应用壳 + Tailwind CDN）
 * 策略：
 *   - 应用壳（HTML/manifest/图标）：cache-first，后台静默更新（stale-while-revalidate）
 *   - 外部 CDN 资源：cache-first + 后台更新；预缓存失败自动降级 no-cors 透明缓存
 *   - 其余请求：网络优先，失败回缓存
 * 更新版本号 CACHE_NAME 即可强制刷新所有缓存
 * ============================================================================= */

const CACHE_NAME = 'synthstudio-v1';

// 应用壳：与本 sw.js 同目录（相对路径，适配任意部署子目录）
const APP_SHELL = [
    './',
    './ble_song_uploader.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon-512-maskable.png'
];

// 外部依赖（Tailwind CDN，页面唯一的网络依赖）
const CDN_URLS = [
    'https://cdn.tailwindcss.com'
];

// 预缓存：CDN 用 no-cors 兜底（跨域无 CORS 头时 cache.add 会失败）
async function precache() {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(APP_SHELL.map(u => cache.add(u)));
    await Promise.allSettled(CDN_URLS.map(async u => {
        try {
            await cache.add(u);
        } catch (e) {
            try {
                const resp = await fetch(u, { mode: 'no-cors' });
                if (resp && (resp.ok || resp.type === 'opaque')) await cache.put(u, resp);
            } catch (e2) { /* 完全离线时首次安装会缺失 CDN，交给运行时缓存 */ }
        }
    }));
}

self.addEventListener('install', (event) => {
    event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

// 命中缓存的资源：先回缓存，同时后台拉新版刷新缓存（stale-while-revalidate）
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const refresh = fetch(request).then(resp => {
        if (resp && (resp.ok || resp.type === 'opaque')) cache.put(request, resp.clone());
        return resp;
    }).catch(() => null);
    return cached || (await refresh) || new Response('离线且无缓存', { status: 503 });
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET') return;

    // CDN 资源
    if (CDN_URLS.some(u => url.href.startsWith(u))) {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }

    // 同源应用壳
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(event.request));
    }
    // 其它跨域请求（一般没有）直接走网络
});
