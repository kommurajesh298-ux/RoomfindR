const LOCAL_DEBUG_HOSTS = new Set(['localhost', '127.0.0.1']);

export const isLocalDebugEnvironment = () => {
  if (typeof globalThis === 'undefined') return false;

  const location = globalThis.location;
  if (!location?.hostname) return false;

  return LOCAL_DEBUG_HOSTS.has(location.hostname);
};
