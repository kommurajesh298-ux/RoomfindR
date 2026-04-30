import React, { memo } from 'react';
import type { IconType } from 'react-icons';
import { formatDistanceToNow } from 'date-fns';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';

interface ActivityItemProps {
    action: string;
    actor: string;
    timestamp: string;
    details: string | Record<string, unknown>;
    icon: IconType;
    type?: 'verification' | 'moderation' | 'settings' | 'refund' | 'booking';
}

const ActivityItem: React.FC<ActivityItemProps> = memo(({ action, actor, timestamp, details, icon: Icon, type = 'booking' }) => {
    const [expanded, setExpanded] = React.useState(false);

    const typeColors: Record<string, string> = {
        verification: 'bg-blue-100 text-blue-600',
        moderation: 'bg-orange-100 text-orange-600',
        settings: 'bg-purple-100 text-purple-600',
        refund: 'bg-red-100 text-red-600',
        booking: 'bg-blue-100 text-blue-600',
    };

    return (
        <div className="border-b border-slate-100 last:border-0 py-4 first:pt-0 last:pb-0">
            <div
                className="flex items-start gap-4 cursor-pointer hover:bg-slate-50 p-2 rounded-lg transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                <div className={`p-2 rounded-full shrink-0 ${typeColors[type] || 'bg-slate-100 text-slate-500'}`}>
                    <Icon size={16} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                        <h4 className="text-sm font-semibold text-slate-900 truncate">{action}</h4>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                            {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
                        </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-1">by {actor}</p>

                    {expanded && (
                        <div className="mt-2 text-xs text-slate-600 bg-slate-50 p-3 rounded border border-slate-100 font-mono break-all">
                            {typeof details === 'object' ? JSON.stringify(details, null, 2) : details}
                        </div>
                    )}
                </div>

                <div className="text-slate-400">
                    {expanded ? <FiChevronUp /> : <FiChevronDown />}
                </div>
            </div>
        </div>
    );
});

ActivityItem.displayName = 'ActivityItem';

export default ActivityItem;

