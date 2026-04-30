import React from 'react';
import type { IconType } from 'react-icons';
import { FiArrowUp, FiArrowDown } from 'react-icons/fi';

interface MetricCardProps {
    title: string;
    value: number | string;
    subtitle?: string;
    trend?: {
        value: number;
        direction: 'up' | 'down';
    };
    icon?: IconType;
    color?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, subtitle, trend, icon: Icon, color }) => {
    const accentClasses: Record<string, string> = {
        blue: 'bg-orange-50 text-orange-600',
        green: 'bg-blue-50 text-blue-600',
        emerald: 'bg-blue-50 text-blue-600',
        purple: 'bg-orange-50 text-orange-600',
        orange: 'bg-amber-50 text-amber-600'
    };

    return (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex justify-between items-start mb-2">
                <div>
                    <h4 className="text-slate-500 text-sm font-medium">{title}</h4>
                    <div className="text-2xl font-bold text-slate-900 mt-1">
                        {typeof value === 'number' ? value.toLocaleString() : value}
                    </div>
                </div>
                {Icon && (
                    <div className={`p-2 rounded-lg ${color ? accentClasses[color] || 'bg-slate-50 text-slate-500' : 'bg-slate-50 text-slate-500'}`}>
                        <Icon size={20} />
                    </div>
                )}
            </div>

            {(trend || subtitle) && (
                <div className="flex items-center gap-2 text-sm mt-3 pt-3 border-t border-slate-50">
                    {trend && (
                        <span className={`flex items-center font-medium ${trend.direction === 'up' ? 'text-blue-600' : 'text-red-500'
                            }`}>
                            {trend.direction === 'up' ? <FiArrowUp /> : <FiArrowDown />}
                            {trend.value}%
                        </span>
                    )}
                    {subtitle && (
                        <span className="text-slate-400">{subtitle}</span>
                    )}
                </div>
            )}
        </div>
    );
};

export default MetricCard;

