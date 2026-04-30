(function () {
  var hostname = window.location.hostname || '';
  var isLocalDevHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.indexOf('10.') === 0 ||
    hostname.indexOf('192.168.') === 0 ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

  if (!isLocalDevHost || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      registrations.forEach(function (registration) {
        registration.unregister();
      });
    });

    if ('caches' in window) {
      caches.keys().then(function (keys) {
        keys.forEach(function (key) {
          if (
            key.indexOf('workbox') !== -1 ||
            key.indexOf('roomfindr') !== -1 ||
            key.indexOf('supabase-cache') !== -1
          ) {
            caches.delete(key);
          }
        });
      });
    }
  });
})();
