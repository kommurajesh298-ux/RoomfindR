import React, { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiCheckCircle } from 'react-icons/fi';
import { useAuth } from '../hooks/useAuth';
import { buildPaymentSuccessRedirect } from '../utils/payment-result-route';

const PaymentConfirmedPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookingId = searchParams.get('bookingId') || searchParams.get('booking_id') || '';
  const appParam = String(searchParams.get('app') || '').toLowerCase();
  const context = String(searchParams.get('context') || '').toLowerCase();
  const currentApp = String(import.meta.env.VITE_APP_TYPE || 'customer').toLowerCase();
  const targetApp = appParam || currentApp;
  const isRentPayment = context.includes('rent') || context.includes('monthly');
  const hasStoredSession = useMemo(() => {
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
      navigate(buildPaymentSuccessRedirect({
        bookingId,
        app: targetApp,
        isRentPayment,
        message: isRentPayment
          ? 'Rent payment received successfully.'
          : 'Payment received. Please wait for owner approval.',
        context: isRentPayment ? 'rent' : 'payment',
      }), { replace: true });
    }, 700) : null;

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('popstate', blockBack);
    };
  }, [bookingId, canRedirectInApp, currentUser, hasStoredSession, isRentPayment, navigate, targetApp]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 via-white to-blue-50 p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-[2.5rem] shadow-2xl border border-blue-100 p-10 w-full max-w-md text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center mx-auto"
        >
          <FiCheckCircle className="text-blue-600 text-6xl" />
        </motion.div>
        <h1 className="text-2xl font-black text-gray-900 mt-6">Payment Successful</h1>
        <p className="text-gray-500 font-medium mt-2">
          {isRentPayment
            ? 'Rent payment received. Auto payout to the owner is being processed directly through Cashfree.'
            : 'Payment received. Waiting for owner approval.'}
        </p>
        <p className="text-xs text-gray-400 mt-6">
          {canRedirectInApp
            ? (isRentPayment ? 'Redirecting to payments...' : 'Redirecting to bookings...')
            : 'Sign in on this device to continue inside RoomFindR.'}
        </p>
        {!canRedirectInApp && (
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="mt-6 inline-flex items-center justify-center rounded-2xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg transition-all active:scale-95"
          >
            Sign In to Continue
          </button>
        )}
      </motion.div>
    </div>
  );
};

export default PaymentConfirmedPage;
