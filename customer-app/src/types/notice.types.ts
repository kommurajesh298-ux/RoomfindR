// Removed legacy firebase imports

export type NoticeType = 'info' | 'urgent' | 'food' | 'payment' | 'rule' | 'maintenance' | 'festival';

export interface Notice {
    noticeId: string;
    propertyId: string;
    title: string;
    message: string;
    type: NoticeType;
    createdAt: string;
    createdBy: string; // Owner ID
    visibleTo: 'all' | 'owners' | 'residents'; // For future extensibility
}
