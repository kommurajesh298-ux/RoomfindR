/**
 * Utility to safely access environment variables in both Vite (ESM) and Jest (CJS) environments.
 */
export const getEnv = (key: string): string | undefined => {
    // Try import.meta.env for Vite
    try {
        const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
        if (viteEnv && viteEnv[key]) {
            return viteEnv[key];
        }
    } catch {
        // Fallback
    }

    // Try process.env for Node/Jest
    try {
        const proc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
        if (proc && proc.env && proc.env[key]) {
            return proc.env[key];
        }
    } catch {
        // Fallback
    }

    return undefined;
};
