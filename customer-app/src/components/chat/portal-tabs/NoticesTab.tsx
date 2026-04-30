import { useState, useEffect } from 'react';
import { FaCalendarCheck, FaExclamationTriangle, FaInfoCircle, FaUtensils, FaCreditCard, FaTools, FaFileContract } from 'react-icons/fa';
import { format } from 'date-fns';
import { noticeService } from '../../../services/notice.service';
import type { Notice, NoticeType } from '../../../types/notice.types';

interface NoticesTabProps {
    propertyId: string;
    propertyTitle: string;
}

const NoticesTab = ({ propertyId, propertyTitle }: NoticesTabProps) => {
    const [notices, setNotices] = useState<Notice[]>([]);
    const [loading, setLoading] = useState(!!propertyId);

    useEffect(() => {
        if (!propertyId) {
            return;
        }

        const unsubscribe = noticeService.subscribeToNotices(propertyId, (data) => {
            setNotices(data);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [propertyId]);

    // ... helper functions ...

    const getIcon = (type: NoticeType) => {
        switch (type) {
            case 'urgent': return <FaExclamationTriangle className="text-red-500" />;
            case 'food': return <FaUtensils className="text-orange-500" />;
            case 'payment': return <FaCreditCard className="text-blue-500" />;
            case 'maintenance': return <FaTools className="text-gray-500" />;
            case 'rule': return <FaFileContract className="text-blue-500" />;
            case 'festival': return <FaCalendarCheck className="text-purple-500" />;
            default: return <FaInfoCircle className="text-blue-500" />;
        }
    };

    const getBadgeStyle = (type: NoticeType) => {
        switch (type) {
            case 'urgent': return 'bg-red-50 text-red-700 border-red-100';
            case 'food': return 'bg-orange-50 text-orange-700 border-orange-100';
            case 'payment': return 'bg-blue-50 text-blue-700 border-blue-100';
            case 'maintenance': return 'bg-gray-50 text-gray-700 border-gray-100';
            case 'rule': return 'bg-blue-50 text-blue-700 border-blue-100';
            case 'festival': return 'bg-purple-50 text-purple-700 border-purple-100';
            default: return 'bg-blue-50 text-blue-600 border-blue-100';
        }
    };

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between px-1">
                <div className="min-w-0">
                    <h3 className="rfm-pg-title-single-line text-[20px] font-semibold text-[#111827] leading-tight" title={propertyTitle}>{propertyTitle}</h3>
                    <p className="text-[11px] font-bold text-[#6B7280] uppercase tracking-widest mt-0.5">Property Notices</p>
                </div>
            </div>

            {notices.length === 0 && !loading ? (
                <div className="bg-white rounded-2xl p-10 text-center border border-dashed border-gray-200">
                    <p className="text-gray-500 text-sm">No announcements yet.</p>
                </div>
            ) : (
                notices.map((notice) => (
                    <div key={notice.noticeId} className={`bg-white rounded-2xl border ${notice.type === 'urgent' ? 'border-red-100 bg-red-50/10' : 'border-gray-100'} shadow-sm p-5 transition-shadow hover:shadow-md animate-in slide-in-from-bottom-2 duration-300`}>
                        <div className="flex items-start gap-4">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${notice.type === 'urgent' ? 'bg-red-100' :
                                notice.type === 'food' ? 'bg-orange-100' :
                                    notice.type === 'payment' ? 'bg-blue-100' :
                                        notice.type === 'maintenance' ? 'bg-gray-100' :
                                            notice.type === 'festival' ? 'bg-purple-100' :
                                                'bg-blue-100'
                                }`}>
                                {getIcon(notice.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-col mb-1.5">
                                    <div className="flex justify-between items-start">
                                        <h4 className="text-lg font-bold text-gray-900 leading-tight">{notice.title}</h4>
                                        <span className="text-xs text-gray-400 font-bold whitespace-nowrap ml-2">
                                            {notice.createdAt ? format(new Date(notice.createdAt), 'dd MMM') : 'Just now'}
                                        </span>
                                    </div>
                                    <span className={`self-start mt-1 px-2 py-0.5 rounded text-xs uppercase font-bold tracking-wide border ${getBadgeStyle(notice.type)}`}>
                                        {notice.type}
                                    </span>
                                </div>
                                <p className="text-base text-gray-600 leading-relaxed whitespace-pre-wrap">{notice.message}</p>
                            </div>
                        </div>
                    </div>
                ))
            )}

            {loading && (
                <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse"></div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default NoticesTab;

