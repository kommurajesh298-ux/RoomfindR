import React, { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { FaBed, FaBullhorn, FaBuilding, FaCreditCard, FaUsers, FaUtensils } from 'react-icons/fa';
import type { Booking } from '../../types/booking.types';
import type { Owner } from '../../types/owner.types';
import type { Property } from '../../types/property.types';
import { ownerService } from '../../services/owner.service';
import { propertyService } from '../../services/property.service';
import LoadingOverlay from '../common/LoadingOverlay';
import CommunityChatTab from './portal-tabs/CommunityChatTab';
import FoodUpdatesTab from './portal-tabs/FoodUpdatesTab';
import MyPGTab from './portal-tabs/MyPGTab';
import NoticesTab from './portal-tabs/NoticesTab';
import PaymentsTab from './portal-tabs/PaymentsTab';
import RoomDetailsTab from './portal-tabs/RoomDetailsTab';

export type ResidentPortalTabId =
    | 'mypg'
    | 'room'
    | 'food'
    | 'notices'
    | 'payments'
    | 'community';

const tabs = [
    { id: 'mypg', label: 'My PG', icon: FaBuilding },
    { id: 'room', label: 'Room', icon: FaBed },
    { id: 'food', label: 'Food', icon: FaUtensils },
    { id: 'notices', label: 'Notices', icon: FaBullhorn },
    { id: 'payments', label: 'Payments', icon: FaCreditCard },
    { id: 'community', label: 'Community', icon: FaUsers },
];

interface ResidentPortalProps {
    booking: Booking;
    currentUser: User | null;
    initialTab?: ResidentPortalTabId;
    onActiveTabChange?: (tab: ResidentPortalTabId) => void;
}

const isResidentPortalTab = (value: string | null | undefined): value is ResidentPortalTabId =>
    ['mypg', 'room', 'food', 'notices', 'payments', 'community'].includes(String(value || '').toLowerCase());

const ResidentPortal: React.FC<ResidentPortalProps> = ({ booking, currentUser, initialTab, onActiveTabChange }) => {
    const [internalActiveTab, setInternalActiveTab] = useState<ResidentPortalTabId>(
        isResidentPortalTab(initialTab) ? initialTab : 'mypg'
    );
    const tabRefs = useRef<Partial<Record<ResidentPortalTabId, HTMLButtonElement | null>>>({});
    const [property, setProperty] = useState<Property | null>(null);
    const [owner, setOwner] = useState<Owner | null>(null);
    const [loading, setLoading] = useState(!!booking.propertyId);
    const activeTab = isResidentPortalTab(initialTab) ? initialTab : internalActiveTab;

    const handleTabChange = (tab: ResidentPortalTabId) => {
        if (!isResidentPortalTab(initialTab)) {
            setInternalActiveTab(tab);
        }
        if (tab !== activeTab) {
            onActiveTabChange?.(tab);
        }
    };

    useEffect(() => {
        if (!booking.propertyId) return;

        const unsubscribe = propertyService.subscribeToProperty(booking.propertyId, (prop) => {
            if (prop) {
                setProperty(prop);
                setLoading(false);
            }
        });

        return () => unsubscribe();
    }, [booking.propertyId]);

    useEffect(() => {
        if (!property?.ownerId) return;
        const unsubscribe = ownerService.subscribeToOwner(property.ownerId, (ownerData) => {
            setOwner(ownerData);
        });
        return () => unsubscribe();
    }, [property?.ownerId]);

    useEffect(() => {
        tabRefs.current[activeTab]?.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'center'
        });
    }, [activeTab]);

    if (loading) return <LoadingOverlay />;
    if (!property) return <div className="p-8 text-center text-gray-500">Not found</div>;

    const isCommunityTab = activeTab === 'community';

    const tabBar = (
        <div className="sticky top-0 z-[100] shrink-0 border-b border-[#DCE8FF] bg-[linear-gradient(180deg,#FFFFFF_0%,#F4F8FF_100%)] px-3 py-2 shadow-[0_12px_28px_rgba(15,23,42,0.08)] lg:px-6 lg:py-3">
            <div className="mx-auto max-w-7xl overflow-x-auto overflow-y-hidden rounded-[18px] border border-[#D9E6FF] bg-white/88 p-1.5 shadow-[0_18px_42px_rgba(37,99,235,0.10)] backdrop-blur-xl no-scrollbar lg:overflow-visible lg:rounded-[24px] lg:p-2">
                <div className="flex min-w-max items-center gap-2 lg:grid lg:min-w-0 lg:grid-cols-6 lg:gap-2.5">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                ref={(node) => {
                                    tabRefs.current[tab.id as ResidentPortalTabId] = node;
                                }}
                                onClick={() => handleTabChange(tab.id as ResidentPortalTabId)}
                                className={`group relative flex h-10 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-[14px] px-3.5 transition-all duration-300 active:scale-[0.98] lg:h-12 lg:w-full lg:px-4 ${
                                    isActive
                                        ? 'bg-[linear-gradient(135deg,#1D4ED8_0%,#2563EB_52%,#F97316_120%)] text-white shadow-[0_14px_28px_rgba(37,99,235,0.24)]'
                                        : 'border border-[#E4ECFF] bg-[#F8FBFF] text-[#475569] hover:-translate-y-0.5 hover:border-[#B8CCFF] hover:bg-white hover:text-[#1D4ED8] hover:shadow-[0_12px_24px_rgba(37,99,235,0.12)]'
                                }`}
                            >
                                {isActive && <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.34),transparent_36%)]" />}
                                <span className={`relative flex h-6 w-6 items-center justify-center rounded-[10px] transition-colors lg:h-7 lg:w-7 ${
                                    isActive
                                        ? 'bg-white/18 text-white'
                                        : 'bg-white text-[#2563EB] shadow-sm group-hover:bg-[#EFF6FF] group-hover:text-[#F97316]'
                                }`}>
                                    <Icon size={15} />
                                </span>
                                <span className="relative whitespace-nowrap text-[12px] font-black tracking-[0.02em] lg:text-[13px]">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );

    const tabContent = (
        <>
            {activeTab === 'mypg' && <MyPGTab booking={booking} property={property} owner={owner} currentUser={currentUser} />}
            {activeTab === 'room' && <RoomDetailsTab booking={booking} property={property} currentUser={currentUser} />}
            {activeTab === 'food' && <FoodUpdatesTab property={property} />}
            {activeTab === 'notices' && <NoticesTab propertyId={property.propertyId} propertyTitle={property.title} />}
            {activeTab === 'payments' && <PaymentsTab booking={booking} property={property} />}
            {activeTab === 'community' && !!currentUser && (
                <div className="flex min-h-0 w-full flex-1 overflow-hidden bg-white lg:h-full">
                    <CommunityChatTab property={property} currentUser={currentUser} />
                </div>
            )}
        </>
    );

    if (!isCommunityTab) {
        return (
            <div className="flex h-[calc(100dvh-76px)] min-h-0 flex-col overflow-hidden bg-[#F8FAFC] font-['Inter',_sans-serif] md:h-[calc(100vh-73px)]">
                {tabBar}
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-24 no-scrollbar">
                    {tabContent}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-[calc(100dvh-76px)] min-h-0 flex-col overflow-x-hidden overflow-y-hidden bg-[#F8FAFC] font-['Inter',_sans-serif] md:h-[calc(100vh-73px)]">
            {tabBar}
            <div className="relative z-0 min-h-0 flex-1 overflow-x-hidden overflow-y-hidden no-scrollbar">
                {tabContent}
            </div>
        </div>
    );
};

export default ResidentPortal;
