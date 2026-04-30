export const extractEdgeErrorMessage = (
  payload: unknown,
  fallback: string,
): string => {
  const body = (payload || {}) as {
    error?: { message?: string } | string;
    message?: string;
  };

  if (typeof body.error === "string" && body.error.trim()) {
    return body.error;
  }

  if (
    typeof body.error === "object" &&
    body.error !== null &&
    typeof body.error.message === "string" &&
    body.error.message.trim()
  ) {
    return body.error.message;
  }

  if (typeof body.message === "string" && body.message.trim()) {
    return body.message;
  }

  return fallback;
};

export const getFreshAccessToken = async (): Promise<string> => "test-access-token";

export const postProtectedEdgeFunction = async <T>(
  _name: string,
  _body: Record<string, unknown>,
): Promise<{ response: Response; payload: T }> => ({
  response: new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
  payload: { success: true } as T,
});

export const invokeProtectedEdgeFunction = async <T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> => {
  const result = await postProtectedEdgeFunction<T>(name, body);
  return result.payload;
};
