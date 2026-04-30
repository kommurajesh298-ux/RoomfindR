import type { KeyboardEvent, WheelEvent } from 'react';

const MONEY_PRECISION = 100;

export const sanitizeAmountValue = (value: number | string | null | undefined): number => {
    if (value === null || value === undefined || value === '') return 0;

    const parsed = typeof value === 'number'
        ? value
        : Number(String(value).replace(/,/g, '').trim());

    if (!Number.isFinite(parsed)) return 0;

    return Math.max(0, Math.round(parsed * MONEY_PRECISION) / MONEY_PRECISION);
};

export const preventNumberInputWheelChange = (event: WheelEvent<HTMLInputElement>) => {
    if (document.activeElement === event.currentTarget) {
        event.currentTarget.blur();
    }
};

export const preventNumberInputStepperKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
    }
};
