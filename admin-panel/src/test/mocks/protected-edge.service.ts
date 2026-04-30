export const extractEdgeErrorMessage = (
  payload: unknown,
  fallback: string,
): string => {
  const body = (payload || {}) as {
    error?: { message?: string } | string;
    message?: string;
  };

  if (typeof body.error === 'string' && body.error.trim()) {
    return body.error;
  }

  if (
    typeof body.error === 'object' &&
    body.error !== null &&
    typeof body.error.message === 'string' &&
    body.error.message.trim()
  ) {
    return body.error.message;
  }

  if (typeof body.message === 'string' && body.message.trim()) {
    return body.message;
  }

  return fallback;
};

export const invokeProtectedEdgeFunction = async <T>(
  _name: string,
  _body: Record<string, unknown>,
): Promise<T> => ({ success: true } as T);
