const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(String(value || "").trim());

export const isLoopbackHostname = (value: string): boolean =>
  LOCAL_HOSTNAMES.has(String(value || "").trim().toLowerCase());

export const isCustomAppUrl = (value: string): boolean =>
  /^[a-z][a-z0-9+\-.]*:/i.test(String(value || "").trim()) && !isHttpUrl(value);

export const isPrivateOrLoopbackHostname = (hostname: string): boolean => {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) return true;
  if (isLoopbackHostname(normalized)) return true;
  if (normalized.endsWith(".local")) return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;
  if (normalized.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  return false;
};

export const isAllowedLocalPaymentReturnUrl = (value: string): boolean => {
  if (!value || !isHttpUrl(value)) return false;
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
};

export const isUnsafePaymentReturnUrl = (value: string): boolean => {
  if (!value || !isHttpUrl(value)) return false;
  try {
    return isPrivateOrLoopbackHostname(new URL(value).hostname);
  } catch {
    return true;
  }
};

export const normalizeReturnBaseUrl = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  if (isCustomAppUrl(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }

  try {
    const parsed = new URL(trimmed);
    if (isHttpUrl(trimmed)) {
      return parsed.origin;
    }
  } catch {
    return "";
  }

  return "";
};

export const sanitizeReturnBaseUrl = (value: string): string => {
  const normalized = normalizeReturnBaseUrl(value);
  if (!normalized) return "";
  if (isUnsafePaymentReturnUrl(normalized) && !isAllowedLocalPaymentReturnUrl(normalized)) return "";
  return normalized;
};
