import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { userService } from '../../services/user.service';
import { authService } from '../../services/auth.service';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../common/LoadingSpinner';

interface ProfileCompletionModalProps {
    isOpen: boolean;
}

const INDIAN_CITIES = ["Bengaluru", "Chennai", "Hyderabad"];

const ProfileCompletionModal: React.FC<ProfileCompletionModalProps> = ({ isOpen }) => {
    const { currentUser, userData, loading: authLoading, profileResolved } = useAuth();
    const [loading, setLoading] = useState(false);

    // Form State
    const [formData, setFormData] = useState<{ name: string; email: string; city: string }>({
        name: (currentUser?.user_metadata?.full_name as string) || (currentUser?.user_metadata?.name as string) || '',
        email: (currentUser?.email as string) || '',
        city: (currentUser?.user_metadata?.city as string) || ''
    });
    const [citySearch, setCitySearch] = useState((currentUser?.user_metadata?.city as string) || '');
    const [showCitySuggestions, setShowCitySuggestions] = useState(false);

    // Logic: Show ONLY if Authenticated AND Not Loading AND Profile Data is Missing
    const shouldShow = isOpen && !authLoading && profileResolved && currentUser && !userData;

    if (!shouldShow) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.name || !formData.email || !formData.city) {
            toast.error("All fields are required");
            return;
        }

        setLoading(true);
        try {
            // Check if email is already used by ANOTHER account?
            // Since we are forcing completion on CURRENT user, we assume they own this email.
            // But we should probably check duplications if strictly needed.
            // For now, let's proceed with creating the doc.

            await userService.createUserDocument(currentUser.id, {
                name: formData.name,
                email: formData.email,
                phone: currentUser.phone || (currentUser.user_metadata?.phone as string) || '',
                emailVerified: !!currentUser.email_confirmed_at,
                phoneVerified: !!currentUser.phone_confirmed_at,
                location: { city: formData.city },
                profilePhotoUrl: currentUser.user_metadata?.avatar_url || ''
            });

            // Update Auth Profile too if needed
            if (!currentUser.user_metadata?.full_name) {
                await authService.updateUserProfile({ name: formData.name });
            }

            toast.success("Profile completed successfully!");
            // Force a reload or context refresh?
            // The AuthContext listens to auth state changes, but maybe not Doc changes instantly if we don't trigger it.
            // A window reload is a safe brute-force way to ensure fresh state references everywhere.
            window.location.reload();

        } catch (error) {
            console.error("Profile Completion Error:", error);
            toast.error("Failed to save profile. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl animate-in zoom-in duration-300 sm:p-8">
                <div className="mb-6 text-center sm:mb-8">
                    <h2 className="text-2xl font-bold text-slate-900">Complete Your Profile</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">Please provide your details to continue using RoomFindR.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Full Name</label>
                        <input
                            type="text"
                            name="profileFullName"
                            required
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-[#0f766e] focus:bg-white focus:ring-4 focus:ring-[#ccfbf1]"
                            placeholder="John Doe"
                        />
                    </div>

                    <div>
                        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email Address</label>
                        <input
                            type="email"
                            name="profileEmail"
                            required
                            value={formData.email}
                            onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-[#0f766e] focus:bg-white focus:ring-4 focus:ring-[#ccfbf1] disabled:bg-slate-100 disabled:text-slate-500"
                            placeholder="john@example.com"
                            disabled={!!currentUser.email} // Disable if already linked (e.g. email login)
                        />
                    </div>

                    <div className="relative">
                        <label className="mb-1.5 block text-sm font-semibold text-slate-700">City</label>
                        <input
                            type="text"
                            name="profileCity"
                            required
                            value={citySearch}
                            onChange={(e) => {
                                const nextCity = e.target.value;
                                setCitySearch(nextCity);
                                setFormData(prev => ({ ...prev, city: nextCity }));
                                setShowCitySuggestions(true);
                            }}
                            onFocus={() => setShowCitySuggestions(true)}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-[#0f766e] focus:bg-white focus:ring-4 focus:ring-[#ccfbf1]"
                            placeholder="Search city"
                        />
                        {showCitySuggestions && (
                            <div className="absolute z-10 mt-2 max-h-32 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
                                {INDIAN_CITIES.filter(c => c.toLowerCase().includes(citySearch.toLowerCase())).map(city => (
                                    <div
                                        key={city}
                                        className="cursor-pointer px-4 py-2 text-sm text-slate-700 hover:bg-[#f0fdfa]"
                                        onClick={() => {
                                            setFormData(prev => ({ ...prev, city }));
                                            setCitySearch(city);
                                            setShowCitySuggestions(false);
                                        }}
                                    >
                                        {city}
                                    </div>
                                ))}
                                {INDIAN_CITIES.filter(c => c.toLowerCase().includes(citySearch.toLowerCase())).length === 0 && (
                                    <div className="px-4 py-2 text-sm text-slate-500">No cities found</div>
                                )}
                            </div>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="mt-2 w-full rounded-2xl bg-[#0f766e] px-4 py-3.5 text-base font-semibold text-white transition-all hover:bg-[#115e59] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                    >
                        {loading ? <LoadingSpinner size="sm" color="border-white" /> : 'Save & Continue'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ProfileCompletionModal;
