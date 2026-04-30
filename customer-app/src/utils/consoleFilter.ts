/**
 * Dev-only console noise filter for third-party logs.
 * This only runs on localhost to keep debugging signals clean.
 */

const suppressedPatterns: RegExp[] = [
  /clevertap/i,
  /sentry\.es6\.min\.js/i,
  /performance log/i,
  /checkout_page_loaded/i,
  /offers action/i,
  /checkout initialized/i,
  /bank-logos/i,
  /testpgnb\.svg/i,
  /extension context invalidated/i,
  /grant_type=refresh_token/i,
  /invalid refresh token/i,
  /refresh token is not valid/i,
  /refresh token not found/i,
  /@supabase\/gotrue-js: Lock "lock:.*auth-token".*Forcefully acquiring the lock to recover/i,
  /WebSocket connection to 'wss:\/\/.*\/realtime\/v1\/websocket.*closed before the connection is established/i,
  /\[vite\] server connection lost\. polling for restart/i,
  /\[bookingservice\] using create-booking-compat edge flow for this hosted backend/i,
  /Skipping payment failure persistence because no gateway order was created yet/i,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (arg as any).message || (arg as any).reason || JSON.stringify(arg);
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
  const originalLog = console.log;
  const originalInfo = console.info;

  console.error = (...args) => {
    if (!shouldSuppress(args)) originalError.apply(console, args);
  };
  console.warn = (...args) => {
    if (!shouldSuppress(args)) originalWarn.apply(console, args);
  };
  console.log = (...args) => {
    if (!shouldSuppress(args)) originalLog.apply(console, args);
  };
  console.info = (...args) => {
    if (!shouldSuppress(args)) originalInfo.apply(console, args);
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
