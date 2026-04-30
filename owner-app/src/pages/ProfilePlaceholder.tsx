import React, { useEffect, useState } from 'react';
import { IoShieldCheckmarkOutline } from 'react-icons/io5';

import Modal from '../components/common/Modal';
import OwnerBankVerificationCard from '../components/common/OwnerBankVerificationCard';
import { useAuth } from '../hooks/useAuth';
import { useOwner } from '../hooks/useOwner';
import { authService } from '../services/auth.service';
import {
    ReferenceAuthField,
    ReferenceAuthInput,
    ReferenceAuthOtpInput,
} from '../../../shared/auth-ui';
import { showToast } from '../utils/toast';
import { validateOTP, validatePassword } from '../utils/validation';
import { notificationTestService } from '../services/notification-test.service';

const PASSWORD_OTP_RESEND_SECONDS = 30;

const ProfilePlaceholder: React.FC = () => {
    const { userData, currentUser } = useAuth();
    const { ownerData, verificationStatus, bankVerified } = useOwner();
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [passwordOtp, setPasswordOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSendingPasswordOtp, setIsSendingPasswordOtp] = useState(false);
    const [passwordOtpSent, setPasswordOtpSent] = useState(false);
    const [passwordOtpResendTimer, setPasswordOtpResendTimer] = useState(0);
    const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
    const [isSendingTestNotification, setIsSendingTestNotification] = useState(false);
    const passwordEmail = (currentUser?.email || userData?.email || '').trim().toLowerCase();

    useEffect(() => {
        if (!isPasswordModalOpen || passwordOtpResendTimer <= 0) return;

        const timer = window.setInterval(() => {
            setPasswordOtpResendTimer((previous) => {
                if (previous <= 1) {
                    window.clearInterval(timer);
                    return 0;
                }
                return previous - 1;
            });
        }, 1000);

        return () => window.clearInterval(timer);
    }, [isPasswordModalOpen, passwordOtpResendTimer]);

    const resetPasswordModalFields = () => {
        setPasswordOtp('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordOtpSent(false);
        setPasswordOtpResendTimer(0);
    };

    const sendPasswordOtp = async () => {
        if (!passwordEmail) {
            showToast.error('Unable to find your email address.');
            return;
        }

        if (isSendingPasswordOtp) return;

        setIsSendingPasswordOtp(true);
        try {
            await authService.requestPasswordChangeOtp(passwordEmail);
            setPasswordOtp('');
            setPasswordOtpSent(true);
            setPasswordOtpResendTimer(PASSWORD_OTP_RESEND_SECONDS);
            showToast.success(`Verification code sent to ${passwordEmail}.`);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Unable to send verification code.';
            showToast.error(message);
        } finally {
            setIsSendingPasswordOtp(false);
        }
    };

    const openPasswordModal = () => {
        if (!passwordEmail) {
            showToast.error('Unable to find your email address.');
            return;
        }

        resetPasswordModalFields();
        setIsPasswordModalOpen(true);
        void sendPasswordOtp();
    };

    const closePasswordModal = () => {
        if (isSendingPasswordOtp || isUpdatingPassword) return;
        setIsPasswordModalOpen(false);
        resetPasswordModalFields();
    };

    const handleSendTestNotification = async () => {
        if (!currentUser?.uid || isSendingTestNotification) return;

        setIsSendingTestNotification(true);
        try {
            await notificationTestService.sendToCurrentUser(currentUser.uid);
            showToast.success('Test notification queued. Check your browser or Android device.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to send test notification.';
            showToast.error(message);
        } finally {
            setIsSendingTestNotification(false);
        }
    };

    const handleChangePassword = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isUpdatingPassword) return;

        if (!passwordOtpSent) {
            showToast.error('Send the verification code first.');
            return;
        }

        if (!validateOTP(passwordOtp)) {
            showToast.error('Please enter a valid 6-digit OTP.');
            return;
        }

        if (!validatePassword(newPassword)) {
            showToast.error('Password must be at least 8 characters and include upper/lowercase letters and a number.');
            return;
        }

        if (newPassword !== confirmPassword) {
            showToast.error('Passwords do not match.');
            return;
        }

        setIsUpdatingPassword(true);
        try {
            await authService.updatePasswordWithOtp({
                email: passwordEmail,
                otp: passwordOtp,
                new_password: newPassword,
            });
            showToast.success('Password updated successfully.');
            closePasswordModal();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to update password.';
            showToast.error(message);
        } finally {
            setIsUpdatingPassword(false);
        }
    };

    return (
        <>
            <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(220,252,231,0.45),_transparent_28%),linear-gradient(180deg,#ffffff_0%,#f9fafb_100%)] pb-20 md:pb-8 p-4 md:p-6">
                <div className="max-w-6xl mx-auto space-y-6">
                    <div className="space-y-2">
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-indigo-500">Owner Profile</p>
                        <h1 className="text-3xl md:text-4xl font-black text-gray-900">My Profile</h1>
                        <p className="text-sm text-slate-500">Manage your account details, password, and bank verification records.</p>
                    </div>

                    <section className="bg-white rounded-[28px] shadow-[0_16px_38px_rgba(15,23,42,0.08)] border border-gray-100 overflow-hidden">
                        <div className="bg-primary/10 p-6 md:p-8 flex items-center gap-4">
                            <img
                                src={currentUser?.photoURL || `https://ui-avatars.com/api/?name=${userData?.name}&background=random`}
                                alt="Profile"
                                className="w-16 h-16 rounded-full border-4 border-white shadow-sm"
                            />
                            <div>
                                <h2 className="text-2xl font-black text-gray-900">{userData?.name}</h2>
                                <p className="text-gray-500">{userData?.email}</p>
                                <div className="flex items-center gap-1 mt-1">
                                    <IoShieldCheckmarkOutline className={bankVerified ? "text-blue-500" : verificationStatus ? "text-indigo-500" : "text-amber-500"} />
                                    <span className={`text-xs font-medium ${bankVerified ? "text-blue-600" : verificationStatus ? "text-indigo-600" : "text-amber-600"}`}>
                                        {bankVerified ? "Bank Verified" : verificationStatus ? "Approved Owner" : "Verification Pending"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 md:p-8 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Phone</p>
                                    <p className="mt-2 font-bold text-slate-900">{userData?.phone || 'Not set'}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Role</p>
                                    <p className="mt-2 font-bold capitalize text-slate-900">{userData?.role}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Bank Name</p>
                                    <p className="mt-2 font-bold text-slate-900">{ownerData?.bankDetails?.bankName || 'Not set'}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Account Number</p>
                                    <p className="mt-2 font-bold text-slate-900">{ownerData?.bankDetails?.accountNumber || 'Not set'}</p>
                                </div>
                            </div>

                            <div className="border-t border-gray-100 pt-4 flex gap-3">
                                <button disabled className="px-4 py-2 bg-gray-100 text-gray-400 rounded-lg font-medium cursor-not-allowed">
                                    Edit Profile
                                </button>
                                <button
                                    onClick={openPasswordModal}
                                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg font-medium"
                                >
                                    Change Password
                                </button>
                                <button
                                    onClick={() => void handleSendTestNotification()}
                                    disabled={isSendingTestNotification}
                                    className="px-4 py-2 rounded-lg font-medium border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSendingTestNotification ? 'Sending Test...' : 'Send Test Notification'}
                                </button>
                            </div>
                        </div>
                    </section>

                    <OwnerBankVerificationCard
                        heading="Bank Verification"
                        subheading="Review your verified bank account, Rs 1 transfer status, and verification history from your profile."
                    />
                </div>
            </div>

            <Modal
                isOpen={isPasswordModalOpen}
                onClose={closePasswordModal}
                title="Change Password"
                className="max-w-md rounded-[24px]"
            >
                <form onSubmit={handleChangePassword} className="rf-auth-stack p-2">
                    <p className="text-xs leading-5 text-slate-500">
                        {isSendingPasswordOtp
                            ? `Sending a 6-digit verification code to ${passwordEmail}...`
                            : `Enter the OTP from ${passwordEmail} and choose a new password.`}
                    </p>

                    <ReferenceAuthField label="Email" htmlFor="passwordChangeEmail" hideLabel={false}>
                        <ReferenceAuthInput
                            id="passwordChangeEmail"
                            type="email"
                            value={passwordEmail}
                            readOnly
                            className="cursor-default bg-slate-50 text-slate-500"
                        />
                    </ReferenceAuthField>

                    <ReferenceAuthField
                        label="OTP"
                        hideLabel={false}
                        helper={
                            passwordOtpResendTimer > 0 ? (
                                <>Resend available in {passwordOtpResendTimer}s</>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => void sendPasswordOtp()}
                                    className="rf-auth-link-button"
                                    disabled={isSendingPasswordOtp || isUpdatingPassword}
                                >
                                    {passwordOtpSent ? 'Resend code' : 'Send code'}
                                </button>
                            )
                        }
                    >
                        <ReferenceAuthOtpInput
                            value={passwordOtp}
                            onChange={setPasswordOtp}
                            disabled={isSendingPasswordOtp || isUpdatingPassword}
                        />
                    </ReferenceAuthField>

                    <ReferenceAuthField
                        label="New Password"
                        htmlFor="newPassword"
                        hideLabel={false}
                    >
                        <ReferenceAuthInput
                            id="newPassword"
                            type="password"
                            placeholder="New Password"
                            required
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            autoComplete="new-password"
                            disabled={isSendingPasswordOtp || isUpdatingPassword}
                        />
                    </ReferenceAuthField>

                    <ReferenceAuthField
                        label="Confirm New Password"
                        htmlFor="confirmPassword"
                        hideLabel={false}
                    >
                        <ReferenceAuthInput
                            id="confirmPassword"
                            type="password"
                            placeholder="Confirm New Password"
                            required
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            autoComplete="new-password"
                            disabled={isSendingPasswordOtp || isUpdatingPassword}
                        />
                    </ReferenceAuthField>

                    <p className="text-xs leading-5 text-slate-500">
                        Use at least 8 characters with uppercase, lowercase, and a number.
                    </p>

                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            onClick={closePasswordModal}
                            disabled={isSendingPasswordOtp || isUpdatingPassword}
                            className="flex-1 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSendingPasswordOtp || isUpdatingPassword || !passwordOtpSent}
                            className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {isUpdatingPassword ? 'Updating...' : 'Verify OTP'}
                        </button>
                    </div>
                </form>
            </Modal>
        </>
    );
};

export default ProfilePlaceholder;
