import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiLoader, FiShield } from 'react-icons/fi';
import { supabase } from '../services/supabase-config';

const PaymentStatusPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookingIdParam = searchParams.get('bookingId') || searchParams.get('booking_id') || '';
  const orderIdParam = searchParams.get('order_id') || searchParams.get('orderId') || '';
  const appParam = String(searchParams.get('app') || '').toLowerCase();
  const currentApp = String(import.meta.env.VITE_APP_TYPE || 'admin').toLowerCase();

  const [message, setMessage] = useState('Verifying payment...');
  const [error, setError] = useState<string | null>(null);
  const redirectRef = useRef<{ started: boolean; delay?: number; fallback?: number }>({ started: false });

  const targetApp = appParam || currentApp;
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
      const fallback = window.setTimeout(() => {
        window.location.assign(url);
      }, 5000);
      redirectRef.current.fallback = fallback;
    }, 1200);
    redirectRef.current.delay = delay;
  }, [navigate]);

  useEffect(() => {
    const redirectState = redirectRef.current;
    return () => {
      if (redirectState.delay) window.clearTimeout(redirectState.delay);
      if (redirectState.fallback) window.clearTimeout(redirectState.fallback);
    };
  }, []);

  useEffect(() => {
    // Poll booking/payment status until webhook updates the DB.
    if (missingReference) {
      const redirectTimer = window.setTimeout(() => {
        scheduleRedirect(`/bookings?${appQuery}`, 'Redirecting to bookings...');
      }, 0);
      return () => window.clearTimeout(redirectTimer);
    }

    let active = true;
    let attempts = 0;
    const maxAttempts = 30;

    const pollStatus = async () => {
      attempts += 1;
      setMessage('Verifying payment...');

      let resolvedBookingId = bookingIdParam;
      let paymentStatusFromPayment = '';

      if (!resolvedBookingId && orderIdParam) {
        const { data: payment } = await supabase
          .from('payments')
          .select('booking_id, status')
          .eq('provider_order_id', orderIdParam)
          .order('created_at', { ascending: false })
          .maybeSingle();

        if (payment?.booking_id) {
          resolvedBookingId = payment.booking_id;
        }
        paymentStatusFromPayment = String(payment?.status || '').toLowerCase();
      }

      if (!resolvedBookingId) {
        return;
      }

      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('id, status, payment_status')
        .eq('id', resolvedBookingId)
        .maybeSingle();

      if (!active) return;

      if (bookingError) {
        setError('Unable to verify payment at the moment.');
      }

      if (booking) {
        const status = String(booking.status || '').toLowerCase();
        const paymentStatus = String(booking.payment_status || '').toLowerCase();
        const effectivePaymentStatus = paymentStatus || paymentStatusFromPayment;

        if (effectivePaymentStatus === 'paid' || ['confirmed', 'approved', 'accepted', 'checked-in', 'checked_in'].includes(status)) {
          scheduleRedirect(`/payment/confirmed?booking_id=${resolvedBookingId}&${appQuery}`, 'Payment confirmed. Redirecting...');
          return;
        }

        if (['failed', 'refunded', 'cancelled'].includes(effectivePaymentStatus) || ['rejected', 'cancelled', 'cancelled_by_customer', 'refunded'].includes(status)) {
          const isRefund = effectivePaymentStatus === 'refunded' || status === 'refunded';
          const context = isRefund ? 'refund' : 'payment';
          scheduleRedirect(`/payment/error?booking_id=${resolvedBookingId}&context=${context}&${appQuery}`, isRefund ? 'Refund processed. Redirecting...' : 'Payment failed. Redirecting...');
          return;
        }
      }

      if (attempts >= maxAttempts) {
        setError('Payment verification is taking longer than expected.');
        const fallbackId = resolvedBookingId || bookingIdParam;
        scheduleRedirect(
          fallbackId
            ? `/payment/error?booking_id=${fallbackId}&context=verification&${appQuery}`
            : `/payment/error?context=verification&${appQuery}`,
          'Redirecting to payment status...'
        );
      }
    };

    pollStatus();
    const timer = setInterval(pollStatus, 2000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [appQuery, bookingIdParam, missingReference, orderIdParam, scheduleRedirect]);

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
