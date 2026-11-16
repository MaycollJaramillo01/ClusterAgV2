/* global firebase, clients */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const SHELL_CACHE = 'cluster-shell-v2';
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'];

const readQueryConfig = () => {
    try {
        return JSON.parse(new URL(self.location.href).searchParams.get('config') || '{}');
    } catch {
        return {};
    }
};

const showGroupedNotification = async ({ title, body, data = {} }) => {
    const isCompliance = data.type === 'compliance';
    const groupId = data.clientId || data.type || 'general';
    const tag = isCompliance ? 'cluster-compliance' : `cluster-chat-${groupId}`;
    const existing = await self.registration.getNotifications({ tag });
    const previousCount = Number(existing[0]?.data?.messageCount || 0);
    const messageCount = previousCount + 1;
    const groupedBody = messageCount > 1
        ? `${body}\n${messageCount} ${isCompliance ? 'avisos nuevos' : 'mensajes nuevos'}`
        : body;

    return self.registration.showNotification(title || 'Cluster Agency OS', {
        body: groupedBody || 'Tienes una notificación nueva',
        icon: '/src/app/assets/cluster-symbol.webp',
        badge: '/src/app/assets/cluster-symbol.webp',
        tag,
        renotify: true,
        silent: false,
        timestamp: Date.now(),
        data: { ...data, messageCount }
    });
};

let messagingReady = false;
const startFirebaseMessaging = (config) => {
    if (messagingReady || !config?.projectId || !config?.messagingSenderId || !config?.appId) return;
    messagingReady = true;
    firebase.initializeApp(config);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
        const data = payload?.data || {};
        return (async () => {
            await showGroupedNotification({
                title: data.title || payload?.notification?.title,
                body: data.body || payload?.notification?.body,
                data
            });
            const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            windows.forEach((client) => client.postMessage({
                type: 'cluster:push',
                collections: ['client_chats']
            }));
        })();
    });
};

startFirebaseMessaging(readQueryConfig());

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {})));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || request.mode !== 'navigate') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

    event.respondWith((async () => {
        try {
            const response = await fetch(request);
            const cache = await caches.open(SHELL_CACHE);
            cache.put('/index.html', response.clone()).catch(() => {});
            return response;
        } catch {
            return (await caches.match('/index.html'))
                || (await caches.match('/'))
                || Response.error();
        }
    })());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'firebase-config') {
        startFirebaseMessaging(event.data.config || {});
        return;
    }
    if (event.data?.type !== 'cluster:show-notification') return;
    event.waitUntil(showGroupedNotification(event.data.notification || {}));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = new URL(event.notification.data?.link || '/', self.location.origin).href;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
            const existing = windows.find((client) => client.url.startsWith(self.location.origin));
            return existing ? existing.focus() : clients.openWindow(link);
        })
    );
});
