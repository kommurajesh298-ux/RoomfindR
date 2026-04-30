export const RUPEE_SYMBOL = '\u20B9';

const toSafeNumber = (value: number | string | null | undefined): number => {
    const numericValue = typeof value === 'string' ? Number(value) : value ?? 0;
    return Number.isFinite(numericValue) ? numericValue : 0;
};

export const formatCurrencyAmount = (value: number | string | null | undefined): string =>
    toSafeNumber(value).toLocaleString('en-IN');

export const formatCurrency = (value: number | string | null | undefined): string =>
    `${RUPEE_SYMBOL}${formatCurrencyAmount(value)}`;
