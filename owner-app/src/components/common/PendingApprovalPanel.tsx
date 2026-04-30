import React from 'react';
import { useNavigate } from 'react-router-dom';
import { IoCheckmarkCircleOutline, IoLogOutOutline, IoMailOutline, IoTimeOutline } from 'react-icons/io5';
import { useAuth } from '../../hooks/useAuth';
import { showToast } from '../../utils/toast';
import { resolveOwnerVerificationState } from '../../utils/ownerVerification';
import OwnerBankVerificationCard from './OwnerBankVerificationCard';

const PendingApprovalPanel: React.FC = () => {
    const { userData, ownerData, signOut } = useAuth();
    const navigate = useNavigate();
    const { ownerActive, transferStatus, bankVerified, requiresAdminApproval } = resolveOwnerVerificationState(ownerData);

    const handleSignOut = async () => {
        try {
            await signOut();
        } catch (error) {
            console.error('Sign out failed:', error);
            showToast.error('Unable to sign out right now.');
        }
    };

    return (
        <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_34%),linear-gradient(180deg,#fff8eb_0%,#ffffff_42%,#fff4d8_100%)]">
            <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
                <div className="relative w-full max-w-2xl overflow-hidden rounded-[32px] border border-amber-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.14)]">
                    <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500" />

                    <div className="space-y-8 p-8 md:p-10">
                        <div className="flex justify-center">
                            <div className={`flex h-20 w-20 items-center justify-center rounded-full shadow-inner ${ownerActive ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
                                {ownerActive ? <IoCheckmarkCircleOutline size={36} /> : <IoTimeOutline size={36} />}
                            </div>
                        </div>

                        <div className="space-y-4 text-center">
                            <p className={`text-xs font-black uppercase tracking-[0.4em] ${ownerActive ? 'text-blue-500' : 'text-amber-500'}`}>
                                {ownerActive ? 'Verification Status' : 'Dashboard Locked'}
                            </p>
                            <h1 className="text-3xl font-black tracking-tight text-slate-900 md:text-4xl">
                                {ownerActive
                                    ? "Bank verification completed"
                                    : requiresAdminApproval
                                        ? "Waiting for admin approval"
                                        : "Verification in progress"}
                            </h1>
                            <p className="mx-auto max-w-xl text-sm leading-7 text-slate-600 md:text-base">
                                {userData?.name ? `${userData.name}, ` : ''}
                                {ownerActive
                                    ? "your account is active. You can still review the bank verification details and transfer history from this page anytime."
                                    : requiresAdminApproval
                                    ? "your bank account is verified, but your owner account is still pending manual admin approval. You cannot access the dashboard until admin approves your details."
                                    : "your owner account is not active yet. Complete bank verification to unlock your dashboard, properties, bookings, and payouts."}
                            </p>
                        </div>

                        <div className={`rounded-[28px] px-5 py-6 text-left ${ownerActive ? 'border border-blue-200 bg-blue-50' : 'border border-amber-200 bg-amber-50'}`}>
                            <p className={`text-sm font-bold ${ownerActive ? 'text-blue-900' : 'text-amber-900'}`}>
                                {ownerActive
                                    ? 'Current status: owner account active'
                                    : requiresAdminApproval
                                    ? "Remaining status: admin approval pending"
                                    : `Remaining status: bank verification ${transferStatus}`}
                            </p>
                            <p className={`mt-2 text-sm leading-7 ${ownerActive ? 'text-blue-800' : 'text-amber-800'}`}>
                                {ownerActive
                                    ? "Use this view to confirm the verified bank account, IFSC, and all Rs 1 verification attempts linked to your owner profile."
                                    : requiresAdminApproval
                                    ? "Once admin approves your owner profile, this page will automatically unlock your account."
                                    : "Once bank verification succeeds, your profile will move to admin review and this page will unlock only after manual approval."}
                            </p>
                        </div>

                        <OwnerBankVerificationCard
                            heading="Bank Verification Status"
                            subheading={
                                bankVerified
                                    ? "Your Rs 1 verification is complete. Admin approval is still required before dashboard access is granted."
                                    : "Complete the Rs 1 verification transfer first. After that, admin must manually approve your owner profile."
                            }
                        />

                        <div className="grid gap-3 sm:grid-cols-2">
                            {ownerActive ? (
                                <button
                                    type="button"
                                    onClick={() => navigate('/dashboard')}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white transition hover:bg-slate-800"
                                >
                                    Go to Dashboard
                                </button>
                            ) : (
                                <a
                                    href="mailto:kommurajesh298@gmail.com"
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 px-5 py-4 text-sm font-black text-slate-700 transition hover:border-amber-300 hover:bg-amber-50"
                                >
                                    <IoMailOutline size={18} />
                                    Contact Admin
                                </a>
                            )}
                            <button
                                type="button"
                                onClick={handleSignOut}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-black text-white transition hover:bg-slate-800"
                            >
                                <IoLogOutOutline size={18} />
                                Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PendingApprovalPanel;
