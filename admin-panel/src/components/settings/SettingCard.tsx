import React, { type ReactNode } from 'react';
import type { IconType } from 'react-icons';

interface SettingCardProps {
    title: string;
    children: ReactNode;
    icon?: IconType;
    className?: string;
}

const SettingCard: React.FC<SettingCardProps> = ({ title, children, icon: Icon, className = '' }) => {
    return (
        <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6 ${className}`}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
                {Icon && <Icon className="text-slate-400" size={20} />}
                <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            </div>
            <div className="p-6">
                {children}
            </div>
        </div>
    );
};

export default SettingCard;
