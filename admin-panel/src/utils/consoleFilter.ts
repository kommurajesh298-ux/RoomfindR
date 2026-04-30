/**
 * Dev-only console noise filter for benign realtime teardown warnings.
 */

const suppressedPatterns: RegExp[] = [
  /@supabase\/gotrue-js: Lock "lock:.*auth-token".*Forcefully acquiring the lock to recover/i,
  /WebSocket connection to 'wss:\/\/.*\/realtime\/v1\/websocket.*closed before the connection is established/i,
];

const shouldSuppress = (args: unknown[]): boolean => {
  try {
    const msg = args
      .map((arg) => {
        if (arg === null || arg === undefined) return String(arg);
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return `${arg.message} ${arg.stack || ''}`;
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');

    return suppressedPatterns.some((pattern) => pattern.test(msg));
  } catch {
    return false;
  }
};

const wrapConsole = () => {
  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args) => {
    if (!shouldSuppress(args)) originalError.apply(console, args);
  };

  console.warn = (...args) => {
    if (!shouldSuppress(args)) originalWarn.apply(console, args);
  };

  window.addEventListener(
    'error',
    (event) => {
      const msg = `${event.message || ''} ${event.filename || ''}`;
      if (suppressedPatterns.some((pattern) => pattern.test(msg))) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );

  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(event.reason || '');
    if (suppressedPatterns.some((pattern) => pattern.test(msg))) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
};

const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
if (import.meta.env.DEV || isLocalhost) {
  wrapConsole();
}
