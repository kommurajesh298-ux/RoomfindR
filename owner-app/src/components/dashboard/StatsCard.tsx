import React, { memo } from 'react';
import { cardAccentStyles, cardStyles } from '../../../../design-system';

interface StatsCardProps {
    label: string;
    value: string | number;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    loading?: boolean;
    trend?: { value: number; isPositive: boolean };
}

export const StatsCard: React.FC<StatsCardProps> = memo(({
    label,
    value,
    icon: Icon,
    color,
    loading = false,
    trend
}) => {
    if (loading) {
        return (
            <div className={`${cardStyles.stat} animate-pulse`}>
                <div className="flex items-center justify-between">
                    <div className="h-12 w-12 rounded-2xl bg-gray-100" />
                    <div className="h-4 w-12 rounded bg-gray-100" />
                </div>
                <div className="mt-4 h-8 w-24 rounded bg-gray-100" />
                <div className="mt-2 h-4 w-32 rounded bg-gray-100" />
            </div>
        );
    }

    const accentClass = color.includes('amber')
        ? cardAccentStyles.warning
        : color.includes('green')
            ? cardAccentStyles.success
            : color.includes('indigo')
                ? cardAccentStyles.info
                : cardAccentStyles.action;

    return (
        <div className={`${cardStyles.stat} group transition-all duration-300 hover:-translate-y-1`}>
            <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[rgba(249,115,22,0.08)] blur-2xl transition-opacity group-hover:opacity-100" />

            <div className="relative z-10 flex items-start justify-between">
                <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--rf-color-text-muted)]">{label}</p>
                    <h3 className="text-2xl font-bold tracking-[-0.03em] text-[var(--rf-color-text)] md:text-3xl">{value}</h3>

                    {trend && (
                        <div className={`mt-3 flex w-fit items-center rounded-full px-3 py-1 text-xs font-medium ${trend.isPositive ? 'bg-[rgba(59, 130, 246,0.12)] text-[var(--rf-color-primary-green-dark)]' : 'bg-[rgba(239,68,68,0.1)] text-[var(--rf-color-error)]'}`}>
                            <span>{trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%</span>
                            <span className="ml-1.5 font-normal text-[var(--rf-color-text-muted)]">vs last month</span>
                        </div>
                    )}
                </div>

                <div className={`${accentClass} transition-transform duration-300 group-hover:scale-105`}>
                    <Icon className="h-5 w-5 md:h-6 md:w-6" />
                </div>
            </div>
        </div>
    );
});

StatsCard.displayName = 'StatsCard';


