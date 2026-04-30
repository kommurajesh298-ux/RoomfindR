import { resolveCors } from "./cors.ts";

const buildSecurityHeaders = (req: Request): Record<string, string> => {
  const url = new URL(req.url);
  const isHttps = url.protocol === "https:";

  return {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Permitted-Cross-Domain-Policies": "none",
    ...(isHttps ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
};

export const jsonResponse = (
  req: Request,
  body: unknown,
  status = 200,
): Response => {
  const origin = req.headers.get("origin");
  const { headers } = resolveCors(origin);

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      ...buildSecurityHeaders(req),
    },
  });
};

export const errorResponse = (
  req: Request,
  status: number,
  message: string,
  code?: string,
): Response =>
  jsonResponse(
    req,
    {
      success: false,
      error: {
        message,
        ...(code ? { code } : {}),
      },
    },
    status,
  );

export const handleCorsPreflight = (req: Request): Response => {
  const origin = req.headers.get("origin");
  const { allowed, headers } = resolveCors(origin);

  if (!allowed) {
    return new Response("Forbidden", {
      status: 403,
      headers: {
        ...headers,
        ...buildSecurityHeaders(req),
      },
    });
  }

  return new Response("ok", {
    status: 200,
    headers: {
      ...headers,
      ...buildSecurityHeaders(req),
    },
  });
};

export const assertAllowedOrigin = (req: Request): boolean => {
  const origin = req.headers.get("origin");
  const { allowed } = resolveCors(origin);
  return allowed;
};
