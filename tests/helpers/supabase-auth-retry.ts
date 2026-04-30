const RETRYABLE_NETWORK_CODES = new Set([
    'UND_ERR_CONNECT_TIMEOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
]);

type ErrorLike = {
    __isAuthError?: boolean;
    status?: number;
    code?: string;
    message?: string;
    cause?: {
        code?: string;
        message?: string;
    };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isRetryableSupabaseNetworkError = (error: unknown) => {
    const candidate = error as ErrorLike | undefined;
    const message = String(candidate?.message || '');
    const causeMessage = String(candidate?.cause?.message || '');
    const code = String(candidate?.code || candidate?.cause?.code || '');

    if (candidate?.__isAuthError && candidate?.status === 0) {
        return true;
    }

    if (RETRYABLE_NETWORK_CODES.has(code)) {
        return true;
    }

    return /fetch failed|connect timeout|network|enotfound|getaddrinfo|timed out/i.test(`${message} ${causeMessage}`);
};

export const withSupabaseAdminRetry = async <T>(
    label: string,
    run: () => Promise<T>,
    options?: {
        retries?: number;
        initialDelayMs?: number;
    }
): Promise<T> => {
    const retries = options?.retries ?? 8;
    const initialDelayMs = options?.initialDelayMs ?? 1000;

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= retries) {
        try {
            return await run();
        } catch (error) {
            lastError = error;
            if (!isRetryableSupabaseNetworkError(error) || attempt === retries) {
                throw error;
            }

            const waitMs = initialDelayMs * (attempt + 1);
            console.warn(`[E2E Supabase Retry] ${label} failed on attempt ${attempt + 1}/${retries + 1}. Retrying in ${waitMs}ms.`);
            await sleep(waitMs);
            attempt += 1;
        }
    }

    throw lastError;
};
