(() => {
    if (!('serviceWorker' in navigator)) return;
    const config = window.__cluster_firebase_config || {};
    const workerUrl = `/firebase-messaging-sw.js?v=20261119-save&config=${encodeURIComponent(JSON.stringify(config))}`;
    const register = () => {
        navigator.serviceWorker.register(workerUrl, { scope: '/' }).catch(() => {});
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);
})();
