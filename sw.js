/** @type {string} */
const CACHE_NAME = "webfft-static-v2";

/** CDN cố định (trùng URL import trong mã) để offline/PWA vẫn tải D3 + KaTeX sau khi cài đặt cache. */
const CDN_ASSETS = [
  "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js",
  "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css",
];

/** Danh sách tài nguyên tĩnh (HTML, CSS, JS, icon, manifest) — đường dẫn tương đối file sw.js. */
const STATIC_ASSETS = [
  "./index.html",
  "./manifest.json",
  "./assets/css/style.css",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./src/app.js",
  "./src/audioEngine.js",
  "./src/dsp.js",
  "./src/dsp/complex.js",
  "./src/dsp/dft.js",
  "./src/dsp/fft.js",
  "./src/dsp/stft.js",
  "./src/dsp/butterflyData.js",
  "./src/dsp/yin.js",
  "./src/ui/uiManager.js",
  "./src/ui/dftSimulator.js",
  "./src/ui/spectrumAnalyzer.js",
  "./src/ui/dtmfDecoder.js",
  "./src/ui/noiseReduction.js",
  "./src/ui/tuner.js",
  "./src/utils/domHelpers.js",
  "./src/utils/format.js",
  "./src/visualization/spectrumCanvas.js",
  "./src/visualization/tunerDisplay.js",
  "./src/visualization/butterflySvg.js",
  "./src/audioWorklet/noiseReducer.js",
  "./src/audioWorklet/pcmCapture.js",
];

const ALL_PRECACHE = [...STATIC_ASSETS, ...CDN_ASSETS];

/**
 * @param {Request} request
 * @param {Cache} cache
 */
async function cacheFirst(request, cache) {
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  if (request.mode === "navigate") {
    const shell =
      (await cache.match("./index.html")) ||
      (await cache.match("index.html"));
    if (shell) return shell;
  }

  const response = await fetch(request);
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        ALL_PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {}),
        ),
      );
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        return await cacheFirst(request, cache);
      } catch {
        if (request.mode === "navigate") {
          const shell = await cache.match("./index.html");
          if (shell) return shell;
        }
        return Response.error();
      }
    })(),
  );
});
