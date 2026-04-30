import React from 'react';
import { twMerge } from 'tailwind-merge';

interface BadgeProps {
    children: React.ReactNode;
    variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
    className?: string;
}

const Badge: React.FC<BadgeProps> = ({ children, variant = 'neutral', className }) => {
    const variants = {
        success: 'bg-blue-100 text-blue-700 border-blue-200',
        warning: 'bg-amber-100 text-amber-700 border-amber-200',
        danger: 'bg-rose-100 text-rose-700 border-rose-200',
        info: 'bg-blue-100 text-blue-700 border-blue-200',
        neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    };

    return (
        <span className={twMerge(
            'px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-all',
            variants[variant],
            className
        )}>
            {children}
        </span>
    );
};

export default Badge;

