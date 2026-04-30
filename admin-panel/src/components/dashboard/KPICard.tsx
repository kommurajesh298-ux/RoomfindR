import React, { memo } from 'react';
import { motion } from 'framer-motion';
import type { IconType } from 'react-icons';
import { FiArrowDown, FiArrowUp } from 'react-icons/fi';
import { cardAccentStyles, cardStyles } from '../../../../design-system';

interface KPICardProps {
    title: string;
    value: number | string;
    icon: IconType;
    color: string;
    trend?: {
        value: number;
        direction: 'up' | 'down';
    };
    loading?: boolean;
}

const KPICard: React.FC<KPICardProps> = memo(({ title, value, icon: Icon, color, trend, loading }) => {
    if (loading) {
        return (
            <div className={`${cardStyles.stat} animate-pulse`}>
                <div className="mb-2 flex items-center justify-between">
                    <div className="h-10 w-10 rounded-xl bg-slate-100" />
                </div>
                <div className="mb-1 h-4 w-3/5 rounded bg-slate-100" />
                <div className="h-7 w-1/2 rounded bg-slate-100" />
            </div>
        );
    }

    const colorClasses: Record<string, string> = {
        blue: cardAccentStyles.info,
        green: cardAccentStyles.success,
        purple: cardAccentStyles.action,
        orange: cardAccentStyles.warning,
        emerald: cardAccentStyles.success,
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${cardStyles.stat} transition-shadow`}
        >
            <div className="mb-2 flex items-start justify-between gap-2">
                <div className={colorClasses[color] || cardAccentStyles.action}>
                    <Icon size={19} />
                </div>
                {trend && (
                    <div className={`flex items-center text-xs font-semibold ${trend.direction === 'up' ? 'text-[var(--rf-color-primary-green-dark)]' : 'text-[var(--rf-color-error)]'}`}>
                        {trend.direction === 'up' ? <FiArrowUp /> : <FiArrowDown />}
                        <span>{trend.value}%</span>
                    </div>
                )}
            </div>

            <h3 className="min-h-[2.1rem] text-[0.9rem] font-medium leading-[1.3] text-[var(--rf-color-text-secondary)]">{title}</h3>
            <div className="text-[clamp(1.45rem,1.8vw,1.85rem)] font-bold leading-none tracking-[-0.03em] text-[var(--rf-color-text)]">
                {typeof value === 'number' ? value.toLocaleString() : value}
            </div>
        </motion.div>
    );
});

KPICard.displayName = 'KPICard';

export default KPICard;


