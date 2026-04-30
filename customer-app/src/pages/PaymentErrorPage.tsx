import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FaExclamationTriangle } from 'react-icons/fa';
import { useAuth } from '../hooks/useAuth';
import { buildPaymentFailureRedirect } from '../utils/payment-result-route';

const PaymentErrorPage: React.FC = () => {
    const { currentUser } = useAuth();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const context = (searchParams.get('context') || 'payment').toLowerCase();
    const isRefund = context.includes('refund');
    const isRentPayment = context.includes('rent') || context.includes('monthly');
    const isVerification = context.includes('verification');
    const defaultMessage = isRefund
        ? 'Your refund has been initiated and will be credited to the original payment method.'
        : isRentPayment
            ? 'Rent payment failed. Start payment again from the resident portal.'
        : isVerification
                ? 'Payment verification is delayed. If money was debited, wait for refund before starting fresh payment.'
                : 'Payment failed. Start fresh payment.';
    const message = searchParams.get('message') || defaultMessage;
    const bookingId = searchParams.get('bookingId') || searchParams.get('booking_id') || '';
    const appParam = String(searchParams.get('app') || '').toLowerCase();
    const currentApp = String(import.meta.env.VITE_APP_TYPE || 'customer').toLowerCase();
    const targetApp = appParam || currentApp;
    const hasStoredSession = React.useMemo(() => {
        if (typeof window === 'undefined') return false;

        try {
            return Object.keys(window.localStorage).some((key) => {
                if (!key.includes('auth-token')) return false;
                return Boolean(window.localStorage.getItem(key));
            });
        } catch {
            return false;
        }
    }, []);
    const canRedirectInApp = Boolean(currentUser || hasStoredSession);

    useEffect(() => {
        const blockBack = () => {
            window.history.pushState(null, '', window.location.href);
        };
        blockBack();
        window.addEventListener('popstate', blockBack);
        const timer = canRedirectInApp ? window.setTimeout(() => {
            navigate(buildPaymentFailureRedirect({
                bookingId,
                app: targetApp,
                isRentPayment,
                message,
                context,
            }), { replace: true });
        }, 700) : null;

        return () => {
            if (timer) window.clearTimeout(timer);
            window.removeEventListener('popstate', blockBack);
        };
    }, [bookingId, canRedirectInApp, context, isRentPayment, message, navigate, targetApp]);

    const handleRetry = () => {
        if (!canRedirectInApp) {
            navigate('/login', { replace: true });
            return;
        }

        navigate(`/payment?booking_id=${bookingId}&app=${encodeURIComponent(targetApp)}`);
    };

    const handleSecondaryAction = () => {
        if (!canRedirectInApp) {
            navigate('/login', { replace: true });
            return;
        }

        navigate(isRentPayment ? `/chat?portalTab=payments&app=${encodeURIComponent(targetApp)}` : `/bookings?app=${encodeURIComponent(targetApp)}`);
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
            <div className="bg-white rounded-[2rem] shadow-2xl border border-gray-100 p-10 w-full max-w-lg text-center">
                <div className="mx-auto w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-5">
                    <FaExclamationTriangle className="text-red-500 text-2xl" />
                </div>
                <h1 className="text-2xl font-black text-gray-900 mb-3">
                    {isRefund ? 'Refund Issued' : isRentPayment ? 'Rent Payment Failed' : 'Payment Failed'}
                </h1>
                <p className="text-gray-600 font-medium leading-relaxed">{message}</p>
                <p className="text-xs text-gray-400 mt-3 uppercase tracking-widest">Context: {context}</p>

                <div className="mt-8 grid grid-cols-1 gap-3">
                    {!isRentPayment && bookingId && (
                        <button
                            onClick={handleRetry}
                            className="w-full py-4 bg-orange-500 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all"
                        >
                            {currentUser ? 'Start Fresh Payment' : 'Sign In to Continue'}
                        </button>
                    )}
                    {isRentPayment && (
                        <button
                            onClick={handleSecondaryAction}
                            className="w-full py-4 bg-orange-500 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all"
                        >
                            {canRedirectInApp ? 'Back to Payments' : 'Sign In to Continue'}
                        </button>
                    )}
                    <button
                        onClick={handleSecondaryAction}
                        className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all"
                    >
                        {canRedirectInApp
                            ? (isRentPayment ? 'Go to Resident Portal' : 'Go to My Bookings')
                            : 'Sign In to RoomFindR'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentErrorPage;
