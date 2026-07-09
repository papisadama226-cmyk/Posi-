/**
 * sw.js — Service Worker pour Posi 🔥🍀
 * ---------------------------------------------------------
 * Stratégie : cache statique "app shell" (HTML/CSS/JS/manifest)
 * pour un chargement instantané et un fonctionnement hors-ligne
 * partiel. Les données temps réel (positions, chat) passent
 * toujours par le réseau (Firebase), jamais par ce cache.
 * ---------------------------------------------------------
 */

const CACHE_NAME = "posi-cache-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase.js",
  "./manifest.json",
];

// Installation : met en cache l'app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activation : nettoie les anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch : "cache first" pour l'app shell, "network first" pour le reste
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Ne jamais intercepter les appels Firebase / API externes (temps réel)
  if (
    request.url.includes("firestore.googleapis.com") ||
    request.url.includes("firebaseio.com") ||
    request.url.includes("googleapis.com") ||
    request.method !== "GET"
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => cached);
    })
  );
});

// Notifications push (Firebase Cloud Messaging) reçues en arrière-plan
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const title = data.notification?.title || "Posi 🔥🍀";
  const options = {
    body: data.notification?.body || "",
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
