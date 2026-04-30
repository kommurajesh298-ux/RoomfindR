import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiLoader, FiShield } from 'react-icons/fi';
import { supabase } from '../services/supabase-config';
import { addNativeResumeListener } from '../services/native-bridge.service';
import { deferRealtimeSubscription } from '../services/realtime-subscription';
import { resolvePaymentResolution } from '../utils/payment-resolution';
import { useAuth } from '../hooks/useAuth';
import {
  buildPaymentFailureRedirect,
  buildPaymentSuccessRedirect,
} from '../utils/payment-result-route';

const STATUS_VERIFY_INTERVAL_MS = 5000;
const SLOW_STATUS_NOTICE_MS = 20000;
const STATUS_TIMEOUT_MS = 60_000;

const getPaymentStatusTimeoutMessage = (isRentPayment: boolean) => (
  isRentPayment
    ? 'Rent payment confirmation is taking longer than expected. If money was debited, please wait for reversal or refund and check the Payments tab before retrying.'
    : 'Payment confirmation is taking longer than expected. If money was debited, please wait for refund to the original payment method before retrying.'
);

const PaymentStatusPage: React.FC = () => {
  const { currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookingIdParam = searchParams.get('bookingId') || searchParams.get('booking_id') || '';
  const orderIdParam = searchParams.get('order_id') || searchParams.get('orderId') || '';
  const contextParam = String(searchParams.get('context') || '').toLowerCase();
  const paymentTypeParam = String(searchParams.get('payment_type') || searchParams.get('paymentType') || '').toLowerCase();
  const monthParam = String(searchParams.get('month') || '').trim();
  const statusTokenParam = String(searchParams.get('status_token') || searchParams.get('statusToken') || '').trim();
  const appParam = String(searchParams.get('app') || '').toLowerCase();
  const currentApp = String(import.meta.env.VITE_APP_TYPE || 'customer').toLowerCase();

  const [message, setMessage] = useState('Verifying payment...');
  const [error, setError] = useState<string | null>(null);
  const redirectRef = useRef<{ started: boolean; delay?: number; fallback?: number }>({ started: false });

  const targetApp = appParam || currentApp;
  const isRentFlow = contextParam.includes('rent') || contextParam.includes('monthly') || paymentTypeParam === 'monthly' || paymentTypeParam === 'rent';
  const appQuery = useMemo(() => `app=${encodeURIComponent(targetApp)}`, [targetApp]);
  const missingReference = !bookingIdParam && !orderIdParam;
  useEffect(() => {
    const blockBack = () => {
      window.history.pushState(null, '', window.location.href);
    };
    blockBack();
    window.addEventListener('popstate', blockBack);
    return () => window.removeEventListener('popstate', blockBack);
  }, []);

  const scheduleRedirect = useCallback((url: string, nextMessage: string) => {
    if (redirectRef.current.started) return;
    redirectRef.current.started = true;
    setMessage(nextMessage);
    const delay = window.setTimeout(() => {
      navigate(url, { replace: true });

      // Android payment returns can occasionally miss a client-side route
      // transition after the app is reopened from PhonePe/Cashfree. Fall back
      // to a full location replace if we are still on the status screen.
      const fallback = window.setTimeout(() => {
        if (window.location.pathname === '/payment-status') {
          window.location.replace(url);
        }
      }, 250);
      redirectRef.current.fallback = fallback;
    }, 1200);
    redirectRef.current.delay = delay;
  }, [navigate, setMessage]);

  useEffect(() => {
    const redirectState = redirectRef.current;
    return () => {
      if (redirectState.delay) window.clearTimeout(redirectState.delay);
      if (redirectState.fallback) window.clearTimeout(redirectState.fallback);
    };
  }, []);

  useEffect(() => {
    if (missingReference) {
      const redirectTimer = window.setTimeout(() => {
        scheduleRedirect(currentUser ? `/bookings?${appQuery}` : '/login', currentUser ? 'Redirecting to bookings...' : 'Redirecting to sign in...');
      }, 0);
      return () => window.clearTimeout(redirectTimer);
    }

    let active = true;
    let resolvedBookingId = bookingIdParam;
    let bookingChannel: ReturnType<typeof supabase.channel> | null = null;
    let paymentChannel: ReturnType<typeof supabase.channel> | null = null;
    let unsubscribeRealtime: (() => void) | null = null;
    let realtimeStarted = false;
    let verifyTimer: number | null = null;
    let slowTimer: number | null = null;
    let timeoutTimer: number | null = null;

    const clearVerifyTimer = () => {
      if (verifyTimer) {
        window.clearTimeout(verifyTimer);
        verifyTimer = null;
      }
    };

    const attachBookingChannel = (bookingId: string) => {
      if (!bookingId || bookingChannel) return;
      bookingChannel = supabase
        .channel(`payment-status-booking-${bookingId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `id=eq.${bookingId}`,
        }, () => {
          void resolveStatus(false);
        })
        .subscribe();
    };

    const attachPaymentChannel = () => {
      if (paymentChannel) return;
      const filter = orderIdParam
        ? `provider_order_id=eq.${orderIdParam}`
        : resolvedBookingId
          ? `booking_id=eq.${resolvedBookingId}`
          : '';
      if (!filter) return;

      paymentChannel = supabase
        .channel(`payment-status-payment-${orderIdParam || resolvedBookingId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'payments',
          filter,
        }, () => {
          void resolveStatus(false);
        })
        .subscribe();
    };

    const attachRealtimeListeners = () => {
      if (unsubscribeRealtime) return;
      unsubscribeRealtime = deferRealtimeSubscription(() => {
        realtimeStarted = true;
        attachPaymentChannel();
        if (resolvedBookingId) attachBookingChannel(resolvedBookingId);

        return () => {
          realtimeStarted = false;
          if (bookingChannel) {
            void supabase.removeChannel(bookingChannel);
            bookingChannel = null;
          }
          if (paymentChannel) {
            void supabase.removeChannel(paymentChannel);
            paymentChannel = null;
          }
        };
      });
    };

    const scheduleVerify = () => {
      clearVerifyTimer();
      verifyTimer = window.setTimeout(() => {
        void resolveStatus(true);
      }, STATUS_VERIFY_INTERVAL_MS);
    };

    const resolveStatus = async (verify: boolean) => {
      const resolution = await resolvePaymentResolution({
        bookingId: resolvedBookingId || bookingIdParam || undefined,
        orderId: orderIdParam || undefined,
        defaultIsRentPayment: isRentFlow,
        verify,
        metadata: /^\d{4}-\d{2}$/.test(monthParam) ? { month: monthParam } : undefined,
        statusToken: statusTokenParam || undefined,
      });

      if (!active || redirectRef.current.started) return;

      resolvedBookingId = resolution.bookingId || resolvedBookingId;
      attachRealtimeListeners();
      if (realtimeStarted && resolvedBookingId) {
        attachBookingChannel(resolvedBookingId);
      }
      if (realtimeStarted) {
        attachPaymentChannel();
      }

      if (resolution.status === 'paid' && resolution.bookingId) {
        scheduleRedirect(
          buildPaymentSuccessRedirect({
            bookingId: resolution.bookingId,
            app: targetApp,
            isRentPayment: resolution.isRentPayment,
            message: resolution.isRentPayment
              ? 'Rent payment received successfully.'
              : 'Payment received. Please wait for owner approval.',
            context: resolution.isRentPayment ? 'rent' : 'payment',
          }),
          resolution.isRentPayment ? 'Rent payment confirmed. Redirecting...' : 'Payment confirmed. Redirecting...',
        );
        return;
      }

      if (resolution.status === 'failed') {
        const isRefund = resolution.paymentStatus === 'refunded' || resolution.bookingStatus === 'refunded';
        const context = isRefund ? 'refund' : (resolution.isRentPayment ? 'rent' : 'payment');
        const failureMessage = isRefund
          ? 'Refund has been processed for this booking.'
          : resolution.isRentPayment
            ? 'Rent payment was cancelled or failed. Please try again.'
            : 'Payment was cancelled or failed. Please try again.';

        scheduleRedirect(
          buildPaymentFailureRedirect({
            bookingId: resolution.bookingId,
            propertyId: resolution.propertyId,
            app: targetApp,
            isRentPayment: resolution.isRentPayment,
            context,
            message: failureMessage,
          }),
          isRefund ? 'Refund processed. Redirecting...' : resolution.isRentPayment ? 'Rent payment failed. Redirecting...' : 'Payment failed. Redirecting...',
        );
        return;
      }

      setError(null);
      setMessage(resolution.isRentPayment ? 'Waiting for rent payment confirmation...' : 'Verifying payment...');
      scheduleVerify();
    };

    slowTimer = window.setTimeout(() => {
      if (!active || redirectRef.current.started) return;
      setMessage('Waiting for backend confirmation. This page updates automatically when payment status changes.');
    }, SLOW_STATUS_NOTICE_MS);

    timeoutTimer = window.setTimeout(() => {
      if (!active || redirectRef.current.started) return;

      void resolvePaymentResolution({
        bookingId: resolvedBookingId || bookingIdParam || undefined,
        orderId: orderIdParam || undefined,
        defaultIsRentPayment: isRentFlow,
        verify: true,
        metadata: /^\d{4}-\d{2}$/.test(monthParam) ? { month: monthParam } : undefined,
        statusToken: statusTokenParam || undefined,
      }).then((resolution) => {
        if (!active || redirectRef.current.started) return;

        if (resolution.status === 'paid' && resolution.bookingId) {
          scheduleRedirect(
            buildPaymentSuccessRedirect({
              bookingId: resolution.bookingId,
              app: targetApp,
              isRentPayment: resolution.isRentPayment,
              message: resolution.isRentPayment
                ? 'Rent payment received successfully.'
                : 'Payment received. Please wait for owner approval.',
              context: resolution.isRentPayment ? 'rent' : 'payment',
            }),
            resolution.isRentPayment ? 'Rent payment confirmed. Redirecting...' : 'Payment confirmed. Redirecting...',
          );
          return;
        }

        if (resolution.status === 'failed') {
          scheduleRedirect(
            buildPaymentFailureRedirect({
              bookingId: resolution.bookingId || resolvedBookingId || bookingIdParam || undefined,
              app: targetApp,
              isRentPayment: resolution.isRentPayment,
              context: resolution.isRentPayment ? 'rent' : 'payment',
              message: getPaymentStatusTimeoutMessage(resolution.isRentPayment),
            }),
            resolution.isRentPayment ? 'Rent payment failed. Redirecting...' : 'Payment failed. Redirecting...',
          );
          return;
        }

        scheduleRedirect(
          buildPaymentFailureRedirect({
            bookingId: resolvedBookingId || bookingIdParam || undefined,
            app: targetApp,
            isRentPayment: isRentFlow,
            context: 'verification',
            message: getPaymentStatusTimeoutMessage(isRentFlow),
          }),
          'Payment confirmation timed out. Redirecting...',
        );
      }).catch(() => {
        if (!active || redirectRef.current.started) return;
        scheduleRedirect(
          buildPaymentFailureRedirect({
            bookingId: resolvedBookingId || bookingIdParam || undefined,
            app: targetApp,
            isRentPayment: isRentFlow,
            context: 'verification',
            message: getPaymentStatusTimeoutMessage(isRentFlow),
          }),
          'Payment confirmation timed out. Redirecting...',
        );
      });
    }, STATUS_TIMEOUT_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void resolveStatus(true);
      }
    };

    const removeNativeResumeListener = addNativeResumeListener(() => {
      void resolveStatus(true);
    });

    attachRealtimeListeners();
    void resolveStatus(true);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      removeNativeResumeListener();
      clearVerifyTimer();
      if (slowTimer) window.clearTimeout(slowTimer);
      if (timeoutTimer) window.clearTimeout(timeoutTimer);
      unsubscribeRealtime?.();
    };
  }, [appQuery, bookingIdParam, currentUser, isRentFlow, missingReference, monthParam, orderIdParam, scheduleRedirect, statusTokenParam, targetApp]);

  const displayError = error || (missingReference ? 'Missing booking reference.' : null);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 via-white to-orange-50 p-6">
      <div className="bg-white rounded-[2.5rem] shadow-2xl border border-orange-100 p-10 w-full max-w-lg text-center">
        <div className="w-16 h-16 rounded-full bg-orange-50 flex items-center justify-center mx-auto">
          <FiShield className="text-orange-500 text-3xl" />
        </div>
        <h1 className="text-2xl font-black text-gray-900 mt-6">Processing Payment</h1>
        <p className="text-gray-600 font-medium mt-2">{displayError || message}</p>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-400">
          <FiLoader className="animate-spin" /> Finalizing with Cashfree...
        </div>
      </div>
    </div>
  );
};

export default PaymentStatusPage;
