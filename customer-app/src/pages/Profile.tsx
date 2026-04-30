import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { userService } from '../services/user.service';
import type { UserData } from '../services/user.service';
import { supabase } from '../services/supabase-config';
import type { Property } from '../types/property.types';
import ProfileHeader from '../components/profile/ProfileHeader';
import EditableField from '../components/profile/EditableField';
import ChangePasswordModal from '../components/profile/ChangePasswordModal';
import FavoritesGrid from '../components/profile/FavoritesGrid';
import { toast } from 'react-hot-toast';
import { FaSignOutAlt, FaEdit, FaSave, FaTimes } from 'react-icons/fa';
import { authService } from '../services/auth.service';
import LoadingOverlay from '../components/common/LoadingOverlay';
import { notificationTestService } from '../services/notification-test.service';

const Profile: React.FC = () => {
    const { currentUser, userData: contextUserData } = useAuth();
    const [userData, setUserData] = useState<UserData | null>(contextUserData);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<UserData>>({});
    const [favorites, setFavorites] = useState<Property[]>([]);

    const [loading, setLoading] = useState(!contextUserData);
    const [loadingFavs, setLoadingFavs] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [isSendingTestNotification, setIsSendingTestNotification] = useState(false);

    useEffect(() => {
        const fetchUserData = async () => {
            if (!currentUser) {
                setLoading(false);
                window.location.href = '/login';
                return;
            }

            setLoading(true);
            try {
                if (contextUserData) {
                    setUserData(contextUserData);
                    setFormData(contextUserData);
                    setLoading(false);
                    loadFavorites(currentUser.id);
                    return;
                }

                const data = await userService.getUserDocument(currentUser.id);

                if (data) {
                    setUserData(data);
                    setFormData(data);
                    loadFavorites(currentUser.id);
                } else {
                    const emptyProfile: UserData = {
                        id: currentUser.id,
                        role: 'customer',
                        name: currentUser.user_metadata?.name || '',
                        email: currentUser.email || '',
                        phone: currentUser.user_metadata?.phone || '',
                        phoneVerified: !!currentUser.user_metadata?.phone,
                        emailVerified: !!currentUser.email_confirmed_at,
                        createdAt: new Date().toISOString(),
                        location: { city: 'Bengaluru' }
                    };
                    setUserData(emptyProfile);
                    setFormData(emptyProfile);
                    setIsEditing(true);
                    toast('Please complete your profile', { icon: 'âœï¸' });
                }
            } catch (error: unknown) {
                console.error("Error loading profile:", error);
                toast.error("Failed to load profile data");
            } finally {
                setLoading(false);
            }
        };

        fetchUserData();
    }, [currentUser, contextUserData]);

    const loadFavorites = async (id: string) => {
        setLoadingFavs(true);
        try {
            const propertyIds = await userService.getFavorites(id);
            if (propertyIds.length > 0) {
                const { data: props, error } = await supabase.from('properties').select('*').in('id', propertyIds);
                if (props && !error) {
                    setFavorites(props.map((p): Property => ({
                        propertyId: String(p.id),
                        ownerId: String(p.owner_id || ''),
                        title: String(p.title),
                        description: String(p.description || ''),
                        pricePerMonth: Number(p.monthly_rent),
                        advanceAmount: Number(p.advance_deposit || 0),
                        address: { text: String(p.city), lat: 0, lng: 0 },
                        city: String(p.city),
                        images: (p.images as string[]) || [],
                        tags: (p.tags as string[]) || [],
                        features: { wifi: false, ac: false, meals: false, laundry: false, security: false },
                        currency: 'INR',
                        vacancies: Number(p.rooms_available || 0),
                        verified: p.status === 'published',
                        published: p.status === 'published',
                        createdAt: String(p.created_at || ''),
                        updatedAt: String(p.updated_at || '')
                    })));
                }
            } else {
                setFavorites([]);
            }
        } catch (error: unknown) {
            console.error('Error loading favorites:', error);
        } finally {
            setLoadingFavs(false);
        }
    };

    const handleSave = async () => {
        if (!currentUser) return;
        setIsSaving(true);
        try {
            if (formData.email && formData.email !== userData?.email) {
                await userService.updateAuthEmail(formData.email);
            }

            await userService.updateUserProfile(currentUser.id, formData);
            setUserData({ ...userData, ...formData } as UserData);
            setIsEditing(false);
            toast.success('Profile updated successfully');
        } catch (error: unknown) {
            toast.error((error as Error).message || 'Failed to update profile');
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setFormData(userData || {});
        setIsEditing(false);
    };

    const handlePhotoChange = async (file: File) => {
        if (!currentUser) return;
        const toastId = toast.loading('Uploading photo...');
        try {
            const url = await userService.uploadProfilePhoto(currentUser.id, file);
            await userService.updateUserProfile(currentUser.id, { profilePhotoUrl: url });
            setUserData(prev => prev ? { ...prev, profilePhotoUrl: url } : null);
            toast.success('Photo updated', { id: toastId });
        } catch (error: unknown) {
            toast.error('Failed to upload photo', { id: toastId });
            console.error(error);
        }
    };

    const handleRemoveFavorite = async (propertyId: string) => {
        if (!currentUser) return;
        try {
            await userService.toggleFavorite(currentUser.id, propertyId);
            setFavorites(prev => prev.filter(p => p.propertyId !== propertyId));
            toast.success('Removed from favorites');
        } catch {
            toast.error('Failed to remove favorite');
        }
    };

    const handleLogout = () => {
        setShowLogoutConfirm(true);
    };

    const handleSendTestNotification = async () => {
        if (!currentUser || isSendingTestNotification) return;

        setIsSendingTestNotification(true);
        try {
            await notificationTestService.sendToCurrentUser(currentUser.id);
            toast.success('Test notification queued. Check your browser or Android device.');
        } catch (error: unknown) {
            console.error('Test notification failed:', error);
            toast.error((error as Error)?.message || 'Failed to send test notification');
        } finally {
            setIsSendingTestNotification(false);
        }
    };

    const confirmLogout = async () => {
        setIsLoggingOut(true);
        try {
            await authService.signOut();
            window.location.href = '/login';
        } catch (error: unknown) {
            console.error('Error signing out:', error);
            toast.error('Failed to sign out. Please try again.');
        } finally {
            setIsLoggingOut(false);
        }
    };

    if (loading || !userData) {
        return <LoadingOverlay />;
    }

    const resolvedProfilePhotoUrl =
        String(userData.profilePhotoUrl || currentUser?.user_metadata?.avatar_url || '').trim() || undefined;
    const resolvedUserData: UserData = resolvedProfilePhotoUrl
        ? { ...userData, profilePhotoUrl: resolvedProfilePhotoUrl }
        : userData;

    return (
        <div className="min-h-screen bg-[#F8FAFC] pb-24 font-['Inter',_sans-serif]">
            {/* ðŸ” MOBILE TOP BAR (ANDROID STANDARDIZED) */}
            <div className="h-[56px] min-h-[56px] bg-white flex items-center justify-between px-4 border-b border-gray-100 shadow-sm sticky top-0 z-[100]">
                <h1 className="text-[20px] font-semibold text-[#111827]">Settings</h1>
                {!isEditing ? (
                    <button
                        onClick={() => setIsEditing(true)}
                        className="w-[44px] h-[44px] flex items-center justify-center text-[#2563eb] rounded-full active:bg-blue-50 transition-colors"
                    >
                        <FaEdit size={20} />
                    </button>
                ) : (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleCancel}
                            className="w-[44px] h-[44px] flex items-center justify-center text-[#6B7280] rounded-full active:bg-gray-100 transition-colors"
                            disabled={isSaving}
                        >
                            <FaTimes size={20} />
                        </button>
                        <button
                            onClick={handleSave}
                            className="w-[44px] h-[44px] flex items-center justify-center text-[#2563eb] rounded-full active:bg-blue-50 transition-colors"
                            disabled={isSaving}
                        >
                            <FaSave size={20} />
                        </button>
                    </div>
                )}
            </div>

            <div className="p-4 space-y-4">
                <ProfileHeader
                    user={resolvedUserData}
                    avatarUrl={resolvedProfilePhotoUrl}
                    onPhotoChange={handlePhotoChange}
                    isEditing={isEditing}
                />

                <div className="space-y-4">
                    {/* Personal Info Section */}
                    <div className="bg-white rounded-[18px] border border-gray-100 shadow-sm p-5">
                        <h3 className="text-[16px] font-semibold text-[#111827] mb-5">Personal Information</h3>
                        <div className="space-y-1">
                            <EditableField
                                label="Full Name"
                                value={formData.name || ''}
                                onChange={(val) => setFormData(prev => ({ ...prev, name: val }))}
                                isEditing={isEditing}
                            />
                            <EditableField
                                label="Email Address"
                                value={formData.email || ''}
                                onChange={(val) => setFormData(prev => ({ ...prev, email: val }))}
                                isEditing={isEditing}
                                type="email"
                            />

                            <div className="mb-4">
                                <label className="block text-[11px] font-bold text-[#6B7280] uppercase tracking-widest mb-1.5">
                                    Phone Number
                                </label>
                                <div className="flex items-center gap-2 text-[15px] font-semibold text-[#111827]">
                                    {userData.phone}
                                    {userData.phoneVerified && (
                                        <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase tracking-wider border border-blue-100">Verified</span>
                                    )}
                                </div>
                            </div>

                            <div className="mb-4">
                                <label className="block text-[11px] font-bold text-[#6B7280] uppercase tracking-widest mb-1.5">
                                    Primary City
                                </label>
                                {isEditing ? (
                                    <select
                                        name="profilePrimaryCity"
                                        value={formData.location?.city || ''}
                                        onChange={(e) => setFormData(prev => ({ ...prev, location: { city: e.target.value } }))}
                                        className="w-full h-[48px] bg-white border border-gray-200 rounded-[12px] px-4 text-[15px] font-medium text-[#111827] focus:ring-2 focus:ring-[#2563eb] outline-none"
                                    >
                                        <option value="Bengaluru">Bengaluru</option>
                                        <option value="Hyderabad">Hyderabad</option>
                                        <option value="Chennai">Chennai</option>
                                    </select>
                                ) : (
                                    <div className="text-[15px] font-semibold text-[#111827]">
                                        {userData.location?.city || 'Not specified'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {isEditing && (
                            <div className="mt-2 pt-5 border-t border-gray-50">
                                <button
                                    onClick={() => setShowPasswordModal(true)}
                                    className="text-[13px] font-bold text-[#2563eb] uppercase tracking-widest"
                                >
                                    Change Password
                                </button>
                            </div>
                        )}

                        <div className="mt-4 pt-4 border-t border-gray-50">
                            <button
                                type="button"
                                onClick={handleSendTestNotification}
                                disabled={isSendingTestNotification}
                                className="inline-flex h-[42px] items-center rounded-[12px] border border-[#BFDBFE] bg-[#EFF6FF] px-4 text-[13px] font-semibold text-[#1D4ED8] transition hover:bg-[#DBEAFE] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSendingTestNotification ? 'Sending Test...' : 'Send Test Notification'}
                            </button>
                        </div>
                    </div>

                    {/* Favorites Section */}
                    <div>
                        <div className="flex justify-between items-center mb-4 px-1">
                            <h3 className="text-[16px] font-semibold text-[#111827]">Saved Favorites</h3>
                        </div>
                        <FavoritesGrid
                            favorites={favorites}
                            onRemove={handleRemoveFavorite}
                            loading={loadingFavs}
                        />
                    </div>

                    <button
                        onClick={handleLogout}
                        className="w-full h-[52px] flex items-center justify-center gap-3 bg-white border border-red-100 text-red-600 rounded-[14px] active:bg-red-50 transition-all font-bold uppercase tracking-widest text-[13px] mt-4"
                    >
                        <FaSignOutAlt size={16} />
                        Sign Out Account
                    </button>
                </div>
            </div>

            <ChangePasswordModal
                isOpen={showPasswordModal}
                onClose={() => setShowPasswordModal(false)}
            />

            {showLogoutConfirm && (
                <div
                    className="fixed inset-0 z-[130] flex items-end justify-center bg-[#0F172A]/50 p-4 backdrop-blur-[3px] sm:items-center"
                    onClick={() => !isLoggingOut && setShowLogoutConfirm(false)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="logout-confirm-title"
                        className="w-full max-w-sm overflow-hidden rounded-[28px] border border-[#DBEAFE] bg-[linear-gradient(180deg,#FFFFFF_0%,#F7FAFF_65%,#FFF4E8_100%)] shadow-[0_24px_60px_rgba(15,23,42,0.28)]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="border-b border-[#E7EEFF] px-5 py-5">
                            <div className="inline-flex rounded-full border border-[#FED7AA] bg-[#FFF7ED] px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-[#F97316]">
                                Confirm Action
                            </div>
                            <h3
                                id="logout-confirm-title"
                                className="mt-3 text-[22px] font-black leading-tight text-[#1D4ED8]"
                            >
                                Sign out of your account?
                            </h3>
                            <p className="mt-2 text-[14px] leading-6 text-[#5B6B88]">
                                You will go back to the login screen. You can sign in again any time.
                            </p>
                        </div>

                        <div className="flex gap-3 px-5 py-5">
                            <button
                                type="button"
                                onClick={() => setShowLogoutConfirm(false)}
                                disabled={isLoggingOut}
                                className="flex-1 rounded-[16px] border border-[#BFDBFE] bg-white px-4 py-3 text-[13px] font-black uppercase tracking-[0.16em] text-[#2563EB] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={confirmLogout}
                                disabled={isLoggingOut}
                                className="flex-1 rounded-[16px] bg-[linear-gradient(135deg,#FB923C_0%,#F97316_100%)] px-4 py-3 text-[13px] font-black uppercase tracking-[0.16em] text-white shadow-[0_16px_30px_rgba(249,115,22,0.28)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isLoggingOut ? 'Signing Out...' : 'Sign Out'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Profile;

