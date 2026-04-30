const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(String(value || '').trim());

export const isLoopbackHostname = (hostname: string): boolean =>
  LOCAL_HOSTNAMES.has(String(hostname || '').trim().toLowerCase());

export const isPrivateOrLoopbackHostname = (hostname: string): boolean => {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return true;
  if (isLoopbackHostname(normalized)) return true;
  if (normalized.endsWith('.local')) return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  if (normalized.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  return false;
};

export const isAllowedLocalPaymentReturnOrigin = (value: string): boolean => {
  if (!isHttpUrl(value)) return false;

  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
};

export const isUnsafePaymentReturnOrigin = (value: string): boolean => {
  if (!isHttpUrl(value)) return false;

  try {
    const hostname = new URL(value).hostname;
    return isPrivateOrLoopbackHostname(hostname);
  } catch {
    return true;
  }
};

export const getSafeConfiguredReturnBaseUrl = (
  candidates: string[],
  currentOrigin?: string | null,
): string => {
  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (!trimmed) continue;

    try {
      const origin = new URL(trimmed).origin;
      if (!isUnsafePaymentReturnOrigin(origin) || isAllowedLocalPaymentReturnOrigin(origin)) {
        return origin;
      }
    } catch {
      // Ignore invalid candidate values and continue.
    }
  }

  if (currentOrigin && (!isUnsafePaymentReturnOrigin(currentOrigin) || isAllowedLocalPaymentReturnOrigin(currentOrigin))) {
    try {
      return new URL(currentOrigin).origin;
    } catch {
      return '';
    }
  }

  return '';
};
