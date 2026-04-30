import { supabase } from './supabase-config';
import type { Offer } from '../types/booking.types';

const PENDING_OFFER_REDEMPTIONS_STORAGE_KEY = 'roomfindr_pending_offer_redemptions';

type PendingOfferRedemption = {
    bookingId: string;
    offerId: string;
    userId: string;
    code?: string;
    createdAt: string;
};

const readPendingOfferRedemptions = (): Record<string, PendingOfferRedemption> => {
    if (typeof window === 'undefined') return {};

    try {
        const raw = window.sessionStorage.getItem(PENDING_OFFER_REDEMPTIONS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, PendingOfferRedemption> | null;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const writePendingOfferRedemptions = (value: Record<string, PendingOfferRedemption>) => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(PENDING_OFFER_REDEMPTIONS_STORAGE_KEY, JSON.stringify(value));
};

const syncOfferUsageCount = async (offerId: string) => {
    const normalizedOfferId = String(offerId || '').trim();
    if (!normalizedOfferId) return;

    try {
        const { data: offerRow, error: offerLookupError } = await supabase
            .from('offers')
            .select('id, current_uses')
            .eq('id', normalizedOfferId)
            .maybeSingle();

        if (offerLookupError) throw offerLookupError;

        if (offerRow?.id) {
            const { error: updateError } = await supabase
                .from('offers')
                .update({ current_uses: Number(offerRow.current_uses || 0) + 1 })
                .eq('id', normalizedOfferId);

            if (updateError) throw updateError;
        }
    } catch (error) {
        // Hosted environments without the latest offer-usage trigger or RPC
        // can reject direct customer updates here. The claim row is still the
        // source of truth, so keep the booking flow successful and let the
        // backend sync handle the aggregate counter.
        console.warn('Offer usage counter sync is pending backend support:', error);
    }
};

const normalizeOfferRecord = (offerData: Record<string, unknown>): Offer => ({
    id: String(offerData.id || ''),
    offerId: String(offerData.id || ''),
    code: String(offerData.code || ''),
    title: String(offerData.title || ''),
    description: String(offerData.description || ''),
    discount_type: offerData.discount_type as 'percentage' | 'fixed',
    discount_value: Number(offerData.discount_value || 0),
    max_discount: Number(offerData.max_discount || 0),
    min_booking_amount: Number(offerData.min_booking_amount || 0),
    valid_until: String(offerData.valid_until || '') || undefined,
    max_uses: Number(offerData.max_uses || 0),
    current_uses: Number(offerData.current_uses || 0),
    is_active: Boolean(offerData.is_active),
    type: offerData.discount_type === 'fixed' ? 'flat' : 'percentage',
    value: Number(offerData.discount_value || 0),
    minBookingAmount: Number(offerData.min_booking_amount || 0),
    maxDiscount: Number(offerData.max_discount || 0),
    active: Boolean(offerData.is_active),
    expiry: String(offerData.valid_until || '') || undefined,
    usageLimit: Number(offerData.max_uses || 0),
    usedCount: Number(offerData.current_uses || 0),
    appliesTo: ['all']
});

export const offerService = {
    validateOffer: async (code: string, userId: string, bookingAmount: number): Promise<{ success: boolean; message?: string; offer?: Offer; }> => {
        try {
            const normalizedCode = code.trim().toUpperCase();
            const { data: offerData, error } = await supabase.from('offers').select('*').eq('code', normalizedCode).eq('is_active', true).maybeSingle();

            if (error || !offerData) return { success: false, message: 'Invalid or inactive offer code' };
            if (offerData.valid_until && new Date(offerData.valid_until) < new Date()) return { success: false, message: 'Offer has expired' };
            const { data: claimed } = await supabase.from('claimed_offers').select('id').eq('offer_id', offerData.id).eq('user_id', userId).maybeSingle();
            if (claimed) return { success: false, message: 'You have already used this code' };
            if (Number(offerData.max_uses || 0) > 0 && Number(offerData.current_uses || 0) >= Number(offerData.max_uses || 0)) {
                return { success: false, message: 'Offer usage limit reached' };
            }
            if (bookingAmount < Number(offerData.min_booking_amount || 0)) {
                return { success: false, message: `Minimum booking amount of Rs.${offerData.min_booking_amount} required` };
            }

            return { success: true, offer: normalizeOfferRecord(offerData) };
        } catch (error) {
            console.error('Error validating offer:', error);
            return { success: false, message: 'Error validating offer code' };
        }
    },

    subscribeToEligibleOffers: (_category: string, callback: (offers: Offer[]) => void): (() => void) => {
        const fetchAndCallback = async () => {
            const { data } = await supabase.from('offers').select('*').eq('is_active', true);
            if (data) {
                callback(data.map((offer) => normalizeOfferRecord(offer)));
            }
        };
        fetchAndCallback();
        const channel = supabase.channel('offers-changes').on('postgres_changes', {
            event: '*', schema: 'public', table: 'offers', filter: 'is_active=eq.true'
        }, () => fetchAndCallback()).subscribe();
        return () => { supabase.removeChannel(channel); };
    },

    claimOffer: async (code: string, userId?: string): Promise<{ success: boolean; message: string; offer?: Offer }> => {
        try {
            const { data: offerData, error } = await supabase.from('offers').select('*').eq('code', code.toUpperCase()).eq('is_active', true).maybeSingle();
            if (error || !offerData) return { success: false, message: 'Invalid or inactive offer code' };
            if (offerData.valid_until && new Date(offerData.valid_until) < new Date()) return { success: false, message: 'Offer has expired' };

            localStorage.setItem('claimedOffer', JSON.stringify({
                code: offerData.code,
                offerId: offerData.id,
                type: offerData.discount_type,
                value: offerData.discount_value,
                minBookingAmount: offerData.min_booking_amount,
                expiry: offerData.valid_until ? new Date(offerData.valid_until).getTime() : null
            }));

            if (userId) {
                await supabase.from('claimed_offers').insert({ offer_id: offerData.id, user_id: userId });
            }

            return { success: true, message: 'Offer claimed successfully!', offer: normalizeOfferRecord(offerData) };
        } catch (error) {
            console.error('Error claiming offer:', error);
            return { success: false, message: 'Failed to claim offer' };
        }
    },

    subscribeToOffer: (offerId: string, callback: (offer: Offer | null) => void): (() => void) => {
        const fetchAndCallback = async () => {
            const { data, error } = await supabase.from('offers').select('*').eq('id', offerId).maybeSingle();
            if (error || !data || !data.is_active) {
                callback(null);
                return;
            }
            callback(normalizeOfferRecord(data));
        };
        fetchAndCallback();
        const channel = supabase.channel(`offer-${offerId}`).on('postgres_changes', {
            event: '*', schema: 'public', table: 'offers', filter: `id=eq.${offerId}`
        }, () => fetchAndCallback()).subscribe();
        return () => { supabase.removeChannel(channel); };
    },

    rememberPendingOfferRedemption: (input: { bookingId: string; offerId: string; userId: string; code?: string }) => {
        const bookingId = String(input.bookingId || '').trim();
        const offerId = String(input.offerId || '').trim();
        const userId = String(input.userId || '').trim();
        if (!bookingId || !offerId || !userId) return;

        const next = readPendingOfferRedemptions();
        next[bookingId] = {
            bookingId,
            offerId,
            userId,
            code: String(input.code || '').trim() || undefined,
            createdAt: new Date().toISOString(),
        };
        writePendingOfferRedemptions(next);
    },

    clearPendingOfferRedemption: (bookingId: string) => {
        const normalizedBookingId = String(bookingId || '').trim();
        if (!normalizedBookingId) return;

        const next = readPendingOfferRedemptions();
        if (!next[normalizedBookingId]) return;
        delete next[normalizedBookingId];
        writePendingOfferRedemptions(next);
    },

    redeemPendingOfferForBooking: async (bookingId: string, userId?: string): Promise<{ success: boolean; message?: string }> => {
        const normalizedBookingId = String(bookingId || '').trim();
        const normalizedUserId = String(userId || '').trim();
        if (!normalizedBookingId || !normalizedUserId) return { success: false, message: 'Missing booking or user context' };

        const pending = readPendingOfferRedemptions()[normalizedBookingId];
        if (!pending || pending.userId !== normalizedUserId || !pending.offerId) {
            return { success: false, message: 'No pending offer redemption found' };
        }

        try {
            const { data: existingClaim, error: claimLookupError } = await supabase
                .from('claimed_offers')
                .select('id, booking_id')
                .eq('offer_id', pending.offerId)
                .eq('user_id', normalizedUserId)
                .maybeSingle();

            if (claimLookupError) throw claimLookupError;

            if (!existingClaim?.id) {
                const { error: insertError } = await supabase
                    .from('claimed_offers')
                    .insert({
                        offer_id: pending.offerId,
                        user_id: normalizedUserId,
                        booking_id: normalizedBookingId,
                        used_at: new Date().toISOString(),
                    });

                if (insertError) {
                    const duplicateClaim = String(insertError.code || '').trim() === '23505'
                        || /duplicate|unique/i.test(String(insertError.message || ''));
                    if (!duplicateClaim) throw insertError;
                }
            }

            await syncOfferUsageCount(pending.offerId);
            offerService.clearPendingOfferRedemption(normalizedBookingId);
            return { success: true };
        } catch (error) {
            console.error('Error redeeming pending offer:', error);
            return { success: false, message: 'Failed to redeem pending offer' };
        }
    },

    normalizeCategory: (category: string): string => category.toLowerCase(),
};
