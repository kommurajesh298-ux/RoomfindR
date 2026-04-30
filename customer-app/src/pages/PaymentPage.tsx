import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiAlertTriangle, FiClock, FiLoader, FiRefreshCw, FiShield, FiSmartphone } from 'react-icons/fi';
import { Browser } from '@capacitor/browser';
import {
  paymentService,
  type CashfreeComponent,
  type CashfreeComponentState,
} from '../services/payment.service';
import { bookingService } from '../services/booking.service';
import { offerService } from '../services/offer.service';
import {
  addNativeResumeListener,
  getMobileAppBaseUrl,
} from '../services/native-bridge.service';
import { supabase } from '../services/supabase-config';
import { deferRealtimeSubscription } from '../services/realtime-subscription';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import type { Booking } from '../types/booking.types';
import {
  detectDirectUpiIntentSupport,
  resolvePaymentResolution,
} from '../utils/payment-resolution';
import { getSafeConfiguredReturnBaseUrl } from '../utils/payment-return-url';
import {
  buildFreshBookingRetryRedirect,
  buildPaymentFailureRedirect,
  buildPaymentSuccessRedirect,
} from '../utils/payment-result-route';
import { getBookingGstSummary } from '../utils/gst';

type PayMethod = 'upi' | 'card';

type CardComponents = {
  number: CashfreeComponent;
  holder: CashfreeComponent;
  expiry: CashfreeComponent;
  cvv: CashfreeComponent;
};

type ActiveFlowMode = 'upi-intent' | 'upi-qr' | 'card';

const STATUS_VERIFY_INTERVAL_MS = 5000;
const DELAY_NOTICE_MS = 20000;
const CONFIRMATION_TIMEOUT_MS = 60_000;
const QR_PAYMENT_WINDOW_MS = 5 * 60 * 1000;
const QR_COUNTDOWN_WARNING_MS = 90 * 1000;
const QR_COUNTDOWN_DANGER_MS = 30 * 1000;
const UPI_INTENT_APPS = ['phonepe', 'gpay', 'paytm'] as const;
type UpiIntentApp = typeof UPI_INTENT_APPS[number];
const UPI_APP_LABELS: Record<UpiIntentApp, string> = {
  phonepe: 'PhonePe',
  gpay: 'GPay',
  paytm: 'Paytm',
};
const UPI_APP_ACCENTS: Record<UpiIntentApp, string> = {
  phonepe: 'from-[#6D28D9] to-[#7C3AED]',
  gpay: 'from-[#2563EB] to-[#1D4ED8]',
  paytm: 'from-[#0891B2] to-[#0F766E]',
};
const DIRECT_UPI_QR_FALLBACK_NOTICE = 'Direct UPI app handoff is unavailable here. Use the QR flow instead.';
const ABANDONED_BOOKING_PAYMENT_STORAGE_KEY = 'roomfindr_abandoned_booking_payment_ids';

const formatCountdown = (ms: number) => {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const totalHours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingMinutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}d ${hours}h`;
  }

  if (totalHours >= 1) {
    return `${totalHours}h ${String(remainingMinutes).padStart(2, '0')}m`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const readAbandonedBookingPaymentIds = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(ABANDONED_BOOKING_PAYMENT_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((value) => String(value || '').trim()).filter(Boolean));
  } catch {
    return new Set();
  }
};

const writeAbandonedBookingPaymentIds = (ids: Set<string>) => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(
    ABANDONED_BOOKING_PAYMENT_STORAGE_KEY,
    JSON.stringify(Array.from(ids)),
  );
};

const getMobileUpiIntentPriority = (): string[] => {
  if (typeof window === 'undefined') return [...UPI_INTENT_APPS];

  const configured = String(import.meta.env.VITE_CASHFREE_UPI_APP_PRIORITY || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => UPI_INTENT_APPS.includes(value as typeof UPI_INTENT_APPS[number]));

  if (configured.length > 0) {
    return Array.from(new Set([...configured, ...UPI_INTENT_APPS]));
  }

  const userAgent = window.navigator.userAgent || '';
  const isAppleMobile = /iphone|ipad|ipod/i.test(userAgent);
  return isAppleMobile
    ? ['gpay', 'paytm', 'phonepe']
    : [...UPI_INTENT_APPS];
};

const getConfiguredReturnBaseUrl = (): string => {
  const mobileAppBaseUrl = getMobileAppBaseUrl();
  if (mobileAppBaseUrl) {
    return mobileAppBaseUrl;
  }

  return getSafeConfiguredReturnBaseUrl([
    String(import.meta.env.VITE_PAYMENT_RETURN_BASE_URL || '').trim(),
    String(import.meta.env.VITE_CUSTOMER_PAYMENT_RETURN_BASE_URL || '').trim(),
    String(import.meta.env.VITE_APP_URL || '').trim(),
    String(import.meta.env.VITE_SITE_URL || '').trim(),
  ], typeof window !== 'undefined' ? window.location?.origin : '');
};

const pickPositiveAmount = (...values: Array<number | null | undefined>) => {
  for (const value of values) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) {
      return amount;
    }
  }
  return 0;
};

const destroyComponent = (component: CashfreeComponent | null | undefined) => {
  if (!component) return;
  try {
    component.destroy?.();
    component.unmount?.();
  } catch {
    // Ignore SDK cleanup errors during unmount.
  }
};

const removeCashfreeInjectedUi = () => {
  if (typeof document === 'undefined') return;

  const selectors = [
    'iframe[src*="cashfree"]',
    'iframe[src*="sdk.cashfree.com"]',
    '[id*="cashfree"]',
    '[class*="cashfree"]',
    '[data-cashfree]',
  ];

  const removableNodes = new Set<Element>();
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      if (node instanceof HTMLElement && node.id === 'root') return;
      if (node instanceof HTMLBodyElement || node instanceof HTMLHtmlElement) return;
      removableNodes.add(node);
    });
  });

  removableNodes.forEach((node) => {
    if (!node.isConnected) return;
    try {
      node.remove();
    } catch {
      // Ignore third-party DOM cleanup issues.
    }
  });

  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.touchAction = '';
  document.body.style.pointerEvents = '';
  document.body.classList.remove('overflow-hidden');

  document.documentElement.style.overflow = '';
  document.documentElement.style.position = '';
  document.documentElement.style.touchAction = '';
  document.documentElement.style.pointerEvents = '';
  document.documentElement.classList.remove('overflow-hidden');
};

const isComponentComplete = (component: CashfreeComponent | null | undefined) => {
  if (!component) return false;
  if (typeof component.isComplete === 'function') {
    return component.isComplete();
  }
  return Boolean(component.data()?.complete);
};

const getComponentErrorMessage = (state?: CashfreeComponentState) =>
  state?.error?.message || null;

const isCashfreeIntentBridgeError = (value: unknown) => {
  const message = String(
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : (value as { error?: { message?: string } } | null | undefined)?.error?.message || '',
  ).toLowerCase();

  return message.includes('postmessage') || message.includes('upi app') || message.includes('popup');
};

const getPaymentFailureMessage = (isRentPayment: boolean) => (
  isRentPayment
    ? 'Rent payment failed. Start payment again from the resident portal. If money was debited, wait for refund.'
    : 'Payment failed. Start fresh payment. If money was debited, wait for refund.'
);

const getPaymentVerificationTimeoutMessage = (isRentPayment: boolean) => (
  isRentPayment
    ? 'Rent payment confirmation is delayed. If money was debited, wait for refund before trying again.'
    : 'Payment confirmation is delayed. If money was debited, wait for refund before starting fresh payment.'
);

const resolveQrExpiryTime = (rawExpiryTime?: string | null) => {
  const now = Date.now();
  const fallbackExpiry = now + QR_PAYMENT_WINDOW_MS;
  const parsedExpiry = Date.parse(String(rawExpiryTime || '').trim());

  if (!Number.isFinite(parsedExpiry)) {
    return new Date(fallbackExpiry).toISOString();
  }

  return new Date(Math.min(Math.max(parsedExpiry, now), fallbackExpiry)).toISOString();
};

const PaymentPage: React.FC = () => {
  const { currentUser, userData } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const bookingId = searchParams.get('bookingId') || searchParams.get('booking_id') || '';
  const rawContext = String(searchParams.get('context') || 'booking').toLowerCase();
  const requestedMonth = String(searchParams.get('month') || '').trim();
  const requestedAmount = Number(searchParams.get('amount') || 0);
  const isRentPayment = rawContext.includes('rent') || rawContext.includes('monthly');
  const appType = String(import.meta.env.VITE_APP_TYPE || 'customer').toLowerCase();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [payMethod, setPayMethod] = useState<PayMethod>('upi');
  const [paying, setPaying] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('Preparing secure payment...');
  const [cardComplete, setCardComplete] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [upiReady, setUpiReady] = useState(false);
  const [upiError, setUpiError] = useState<string | null>(null);
  const [upiNotice, setUpiNotice] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [activeOrderId, setActiveOrderId] = useState('');
  const [activeFlowMode, setActiveFlowMode] = useState<ActiveFlowMode | null>(null);
  const [activeOrderExpiryTime, setActiveOrderExpiryTime] = useState('');
  const [qrCountdownMs, setQrCountdownMs] = useState<number | null>(null);
  const [showQrExpiredDialog, setShowQrExpiredDialog] = useState(false);
  const [delayNotice, setDelayNotice] = useState<string | null>(null);
  const [refreshingQr, setRefreshingQr] = useState(false);
  const [resolvedIntentApp, setResolvedIntentApp] = useState<string | null>(null);
  const [forceQrFallback, setForceQrFallback] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth < 768 : false),
  );
  const [rentGuardResolvedMonth, setRentGuardResolvedMonth] = useState('');
  const [rentGuardReady, setRentGuardReady] = useState(() => !isRentPayment);
  const [rentGuardCanPay, setRentGuardCanPay] = useState(() => !isRentPayment);
  const [rentGuardMessage, setRentGuardMessage] = useState<string | null>(null);

  const cardComponentsRef = useRef<CardComponents | null>(null);
  const upiComponentRef = useRef<CashfreeComponent | null>(null);
  const autoFailOnLeaveEnabledRef = useRef(true);
  const awaitingConfirmationRef = useRef(awaitingConfirmation);
  const activeOrderIdRef = useRef(activeOrderId);
  const activeFlowModeRef = useRef<ActiveFlowMode | null>(activeFlowMode);
  const bookingRef = useRef<Booking | null>(booking);

  useEffect(() => {
    awaitingConfirmationRef.current = awaitingConfirmation;
  }, [awaitingConfirmation]);

  useEffect(() => {
    activeOrderIdRef.current = activeOrderId;
  }, [activeOrderId]);

  useEffect(() => {
    activeFlowModeRef.current = activeFlowMode;
  }, [activeFlowMode]);

  useEffect(() => {
    bookingRef.current = booking;
  }, [booking]);

  const cleanupPaymentUi = useCallback(async () => {
    destroyComponent(upiComponentRef.current);
    upiComponentRef.current = null;

    const components = cardComponentsRef.current;
    if (components) {
      destroyComponent(components.number);
      destroyComponent(components.holder);
      destroyComponent(components.expiry);
      destroyComponent(components.cvv);
    }
    cardComponentsRef.current = null;

    setAwaitingConfirmation(false);
    setActiveFlowMode(null);
    setActiveOrderId('');
    setActiveOrderExpiryTime('');
    setPaying(false);
    setRefreshingQr(false);
    setDelayNotice(null);
    setQrCountdownMs(null);
    setShowQrExpiredDialog(false);
    setResolvedIntentApp(null);

    removeCashfreeInjectedUi();
    await Browser.close().catch(() => undefined);
    window.setTimeout(() => {
      void Browser.close().catch(() => undefined);
      removeCashfreeInjectedUi();
    }, 120);
  }, []);

  const cardNumberMountId = `cf-card-number-${useId().replace(/:/g, '')}`;
  const cardHolderMountId = `cf-card-holder-${useId().replace(/:/g, '')}`;
  const cardExpiryMountId = `cf-card-expiry-${useId().replace(/:/g, '')}`;
  const cardCvvMountId = `cf-card-cvv-${useId().replace(/:/g, '')}`;
  const upiMountId = `cf-upi-${useId().replace(/:/g, '')}`;

  const supportsDirectUpiIntent = useMemo(() => detectDirectUpiIntentSupport(), []);
  const safeReturnBaseUrl = useMemo(() => getConfiguredReturnBaseUrl(), []);
  const showCardOption = !isMobileViewport;
  const upiMode = isMobileViewport && supportsDirectUpiIntent && !forceQrFallback ? 'intent' : 'qr';
  const isQrGenerated = awaitingConfirmation && activeFlowMode === 'upi-qr' && !!activeOrderId;
  const mobileUpiIntentPriority = useMemo(() => getMobileUpiIntentPriority(), []);
  const availableUpiIntentApps = useMemo(
    () => mobileUpiIntentPriority.filter((app): app is UpiIntentApp =>
      UPI_INTENT_APPS.includes(app as UpiIntentApp)),
    [mobileUpiIntentPriority],
  );
  const [selectedUpiApp, setSelectedUpiApp] = useState<UpiIntentApp | null>(null);

  useEffect(() => {
    const updateViewportMode = () => setIsMobileViewport(window.innerWidth < 768);
    updateViewportMode();
    window.addEventListener('resize', updateViewportMode);
    return () => window.removeEventListener('resize', updateViewportMode);
  }, []);

  useEffect(() => {
    if (upiMode !== 'intent') {
      setSelectedUpiApp(null);
      return;
    }

    setUpiNotice(null);

    setSelectedUpiApp((current) => {
      if (current && availableUpiIntentApps.includes(current)) return current;
      return availableUpiIntentApps[0] || null;
    });
  }, [availableUpiIntentApps, upiMode]);

  useEffect(() => {
    if (!showCardOption && payMethod !== 'upi') {
      setPayMethod('upi');
    }
  }, [payMethod, showCardOption]);

  useEffect(() => {
    if (!bookingId) {
      toast.error('Missing booking reference');
      navigate('/bookings');
      return;
    }

    let active = true;

    const loadBooking = async () => {
      let resolvedBooking: Booking | null = null;

      for (let attempt = 0; attempt < 5 && active; attempt += 1) {
        try {
          resolvedBooking = await bookingService.getBookingById(bookingId);
          if (resolvedBooking) {
            break;
          }
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn('[PaymentPage] Booking lookup retry', attempt + 1, error);
          }
        }

        if (attempt < 4) {
          await new Promise((resolve) => window.setTimeout(resolve, 600 * (attempt + 1)));
        }
      }

      if (!active) return;
      setBooking(resolvedBooking);
      setLoading(false);
    };

    void loadBooking();

    return () => {
      active = false;
    };
  }, [bookingId, navigate]);

  useEffect(() => {
    if (!paying) return;
    const blockBack = () => {
      window.history.pushState(null, '', window.location.href);
    };
    blockBack();
    window.addEventListener('popstate', blockBack);
    return () => window.removeEventListener('popstate', blockBack);
  }, [paying]);

  const totalDue = useMemo(() => {
    if (!booking) return Number.isFinite(requestedAmount) ? requestedAmount : 0;
    if (isRentPayment) {
      return pickPositiveAmount(booking.monthlyRent, requestedAmount);
    }
    return pickPositiveAmount(
      booking.amountDue,
      booking.advancePaid,
      booking.amountPaid,
      booking.monthlyRent,
      requestedAmount,
    );
  }, [booking, isRentPayment, requestedAmount]);

  const checkoutSummary = useMemo(() => {
    if (!booking) return null;

    const summaryBooking = isRentPayment
      ? {
          ...booking,
          paymentType: 'monthly' as const,
          paymentStatus:
            booking.rentPaymentStatus && booking.rentPaymentStatus !== 'not_due'
              ? booking.rentPaymentStatus
              : 'pending',
          amountPaid: 0,
          advancePaid: 0,
          amountDue: totalDue,
          monthlyRent: totalDue || booking.monthlyRent,
          roomGst: 0,
          roomGstRate: 0,
          platformFee: 0,
          platformGst: 0,
          platformGstRate: 0,
          totalAmount: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
        }
      : {
          ...booking,
          amountPaid: 0,
          amountDue: totalDue,
        };

    return getBookingGstSummary({
      ...summaryBooking,
    });
  }, [booking, isRentPayment, totalDue]);
  const payableAmount = checkoutSummary?.totalAmount || totalDue;

  const formatCurrency = (value: number) => `INR ${Number(value || 0).toLocaleString('en-IN')}`;
  const effectiveRentMonth = rentGuardResolvedMonth || requestedMonth;
  const effectiveRentMonthRef = useRef(effectiveRentMonth);
  const isRentPaymentRef = useRef(isRentPayment);

  useEffect(() => {
    effectiveRentMonthRef.current = effectiveRentMonth;
  }, [effectiveRentMonth]);

  useEffect(() => {
    isRentPaymentRef.current = isRentPayment;
  }, [isRentPayment]);
  const payNowLabel = useMemo(() => {
    if (paying) return 'Processing...';
    if (refreshingQr) return 'Refreshing QR...';
    if (isRentPayment && !rentGuardReady) return 'Checking rent status...';
    if (awaitingConfirmation) return activeFlowMode === 'upi-qr' ? 'Waiting for Payment...' : 'Awaiting Confirmation...';
    if (payMethod === 'upi' && upiMode === 'qr') return `Generate QR ${formatCurrency(payableAmount)}`;
    if (payMethod === 'upi' && upiMode === 'intent' && selectedUpiApp) {
      return `Open ${UPI_APP_LABELS[selectedUpiApp]}`;
    }
    return `Pay Now ${formatCurrency(payableAmount)}`;
  }, [activeFlowMode, awaitingConfirmation, isRentPayment, payMethod, payableAmount, paying, refreshingQr, rentGuardReady, selectedUpiApp, upiMode]);
  const showProcessingOverlay =
    (paying && !(payMethod === 'upi' && upiMode === 'qr' && refreshingQr)) ||
    (awaitingConfirmation && activeFlowMode !== 'upi-qr');
  const showFreshRetryButton = awaitingConfirmation && !isRentPayment;
  const qrCountdownUi = useMemo(() => {
    if (!awaitingConfirmation || activeFlowMode !== 'upi-qr') {
      return {
        label: 'Will appear after Pay Now',
        toneClass: 'text-gray-500',
        badgeClass: 'border-gray-200 bg-gray-50 text-gray-600',
        noticeClass: 'border-blue-100 bg-blue-50 text-blue-800',
      };
    }

    if (qrCountdownMs === null) {
      return {
        label: 'Waiting for payment...',
        toneClass: 'text-gray-500',
        badgeClass: 'border-gray-200 bg-gray-50 text-gray-600',
        noticeClass: 'border-blue-100 bg-blue-50 text-blue-800',
      };
    }

    if (qrCountdownMs <= QR_COUNTDOWN_DANGER_MS) {
      return {
        label: `Expires in ${formatCountdown(qrCountdownMs)}`,
        toneClass: 'text-red-700',
        badgeClass: 'border-red-200 bg-red-50 text-red-700',
        noticeClass: 'border-red-200 bg-red-50 text-red-800',
      };
    }

    if (qrCountdownMs <= QR_COUNTDOWN_WARNING_MS) {
      return {
        label: `Expires in ${formatCountdown(qrCountdownMs)}`,
        toneClass: 'text-amber-700',
        badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
        noticeClass: 'border-amber-200 bg-amber-50 text-amber-800',
      };
    }

    return {
      label: `Expires in ${formatCountdown(qrCountdownMs)}`,
      toneClass: 'text-emerald-700',
      badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      noticeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    };
  }, [activeFlowMode, awaitingConfirmation, qrCountdownMs]);

  useEffect(() => {
    if (!booking || !isRentPayment) {
      setRentGuardReady(true);
      setRentGuardResolvedMonth('');
      setRentGuardCanPay(true);
      setRentGuardMessage(null);
      return;
    }

    let active = true;
    setRentGuardReady(false);
    void bookingService.getBookingRentCycle(booking.bookingId)
      .then((cycle) => {
        if (!active) return;
        if (!cycle) {
          setRentGuardResolvedMonth(requestedMonth);
          setRentGuardCanPay(true);
          setRentGuardMessage(null);
          setRentGuardReady(true);
          return;
        }

        const activeCycleMonth = cycle.currentCycleStartDate
          ? format(new Date(cycle.currentCycleStartDate), 'yyyy-MM')
          : '';

        setRentGuardResolvedMonth(activeCycleMonth || requestedMonth);
        setRentGuardCanPay(Boolean(cycle.canPayRent));
        setRentGuardReady(true);

        if (!cycle.canPayRent) {
          const dueDate = String(cycle.nextDueDate || '').trim();
          setRentGuardMessage(
            dueDate
              ? `Rent payment is not open yet. It will unlock automatically on ${dueDate}.`
              : 'Rent payment is not open yet for this booking.',
          );
          return;
        }

        if (requestedMonth && activeCycleMonth && requestedMonth !== activeCycleMonth) {
          setRentGuardMessage(`This link was for ${requestedMonth}. We updated it to the active rent cycle ${activeCycleMonth}.`);
          return;
        }

        setRentGuardMessage(null);
      })
      .catch((error) => {
        if (!active) return;
        if (import.meta.env.DEV) {
          console.warn('[PaymentPage] Failed to resolve rent cycle before payment:', error);
        }
        setRentGuardResolvedMonth(requestedMonth);
        setRentGuardCanPay(true);
        setRentGuardReady(true);
      });

    return () => {
      active = false;
    };
  }, [booking, isRentPayment, requestedMonth]);

  useEffect(() => {
    let active = true;

    const updateCardState = () => {
      if (!active) return;
      const components = cardComponentsRef.current;
      if (!components) return;

      const errorMessage = [
        getComponentErrorMessage(components.number.data()),
        getComponentErrorMessage(components.holder.data()),
        getComponentErrorMessage(components.expiry.data()),
        getComponentErrorMessage(components.cvv.data()),
      ].find(Boolean) || null;

      setCardError(errorMessage);
      setCardComplete(
        isComponentComplete(components.number) &&
        isComponentComplete(components.holder) &&
        isComponentComplete(components.expiry) &&
        isComponentComplete(components.cvv),
      );
    };

    const initCardComponents = async () => {
      if (!booking || !showCardOption) return;
      if (cardComponentsRef.current) {
        updateCardState();
        return;
      }

      try {
        const [number, holder, expiry, cvv] = await Promise.all([
          paymentService.createCashfreeComponent('cardNumber', {
            values: { placeholder: '4111 XXXX XXXX 1111' },
          }),
          paymentService.createCashfreeComponent('cardHolder', {
            values: {
              cardHolder: userData?.name || booking.customerName || '',
              placeholder: 'Name on card',
            },
          }),
          paymentService.createCashfreeComponent('cardExpiry'),
          paymentService.createCashfreeComponent('cardCvv'),
        ]);

        if (!active) {
          destroyComponent(number);
          destroyComponent(holder);
          destroyComponent(expiry);
          destroyComponent(cvv);
          return;
        }

        const components: CardComponents = { number, holder, expiry, cvv };
        const bindEvents = (component: CashfreeComponent) => {
          ['ready', 'change', 'complete', 'empty', 'invalid', 'loaderror'].forEach((eventName) => {
            component.on(eventName, updateCardState);
          });
        };

        bindEvents(number);
        bindEvents(holder);
        bindEvents(expiry);
        bindEvents(cvv);

        number.mount(`#${cardNumberMountId}`);
        holder.mount(`#${cardHolderMountId}`);
        expiry.mount(`#${cardExpiryMountId}`);
        cvv.mount(`#${cardCvvMountId}`);

        cardComponentsRef.current = components;
        updateCardState();
      } catch (error) {
        if (!active) return;
        setCardError(error instanceof Error ? error.message : 'Unable to load secure card fields.');
      }
    };

    initCardComponents();

    return () => {
      active = false;
    };
  }, [
    booking,
    cardCvvMountId,
    cardExpiryMountId,
    cardHolderMountId,
    cardNumberMountId,
    showCardOption,
    userData?.name,
  ]);

  useEffect(() => {
    let active = true;

    const initUpiComponent = async () => {
      destroyComponent(upiComponentRef.current);
      upiComponentRef.current = null;
      setUpiReady(false);
      setUpiError(null);
      setResolvedIntentApp(null);

      if (!booking || payMethod !== 'upi') return;

      try {
        if (upiMode === 'intent') {
          const targetApp = selectedUpiApp || availableUpiIntentApps[0];
          if (!targetApp) {
            setUpiReady(false);
            setForceQrFallback(true);
            setUpiNotice(DIRECT_UPI_QR_FALLBACK_NOTICE);
            setUpiError(null);
            return;
          }

          const component = await paymentService.createCashfreeComponent('upiApp', {
            values: {
              upiApp: targetApp,
              buttonText: `Pay with ${UPI_APP_LABELS[targetApp]}`,
              buttonIcon: false,
            },
          });

          if (!active) {
            destroyComponent(component);
            return;
          }

          const result = await new Promise<{ status: 'ready' | 'loaderror' | 'timeout'; message?: string }>((resolve) => {
            let settled = false;
            const settle = (value: { status: 'ready' | 'loaderror' | 'timeout'; message?: string }) => {
              if (settled) return;
              settled = true;
              resolve(value);
            };

            component.on('ready', () => settle({ status: 'ready' }));
            component.on('loaderror', (state) => settle({
              status: 'loaderror',
              message: state?.error?.message,
            }));
            component.mount(`#${upiMountId}`);
            window.setTimeout(() => settle({ status: 'timeout' }), 1800);
          });

          if (result.status === 'ready') {
            setUpiReady(true);
            setUpiError(null);
            setResolvedIntentApp(targetApp);
            upiComponentRef.current = component;
            return;
          }

          destroyComponent(component);
          setUpiReady(false);
          setResolvedIntentApp(null);
          setForceQrFallback(true);
          setUpiNotice(
            result.status === 'timeout'
              ? DIRECT_UPI_QR_FALLBACK_NOTICE
              : result.message || `Unable to open ${UPI_APP_LABELS[targetApp]} automatically. Use the QR flow instead.`,
          );
          setUpiError(null);
          return;
        }

        const component = await paymentService.createCashfreeComponent('upiQr', {
          values: {
            size: window.innerWidth < 640 ? '220px' : '240px',
          },
        });

        if (!active) {
          destroyComponent(component);
          return;
        }

        component.on('ready', () => {
          if (!active) return;
          setUpiReady(true);
          setUpiError(null);
        });

        component.on('loaderror', (state) => {
          if (!active) return;
          setUpiReady(false);
          setUpiError(
            state?.error?.message ||
            'Unable to load the inline UPI QR. Please switch to Card or try again.',
          );
        });

        component.mount(`#${upiMountId}`);
        upiComponentRef.current = component;
      } catch (error) {
        if (!active) return;
        setUpiReady(false);
        if (upiMode === 'intent') {
          setResolvedIntentApp(null);
          setForceQrFallback(true);
          setUpiNotice(DIRECT_UPI_QR_FALLBACK_NOTICE);
          setUpiError(null);
          return;
        }

        setUpiError(error instanceof Error
          ? error.message
          : 'Unable to initialize UPI QR.');
      }
    };

    initUpiComponent();

    return () => {
      active = false;
    };
  }, [availableUpiIntentApps, booking, payMethod, selectedUpiApp, upiMode, upiMountId]);

  useEffect(() => () => {
    destroyComponent(upiComponentRef.current);
    upiComponentRef.current = null;

    const components = cardComponentsRef.current;
    if (components) {
      destroyComponent(components.number);
      destroyComponent(components.holder);
      destroyComponent(components.expiry);
      destroyComponent(components.cvv);
    }
    cardComponentsRef.current = null;

    removeCashfreeInjectedUi();
    void Browser.close().catch(() => undefined);
  }, []);

  const persistAbandonedBookingPayment = useCallback((targetBookingId: string) => {
    const ids = readAbandonedBookingPaymentIds();
    ids.add(targetBookingId);
    writeAbandonedBookingPaymentIds(ids);
  }, []);

  const clearAbandonedBookingPayment = useCallback((targetBookingId: string) => {
    const ids = readAbandonedBookingPaymentIds();
    if (!ids.delete(targetBookingId)) return;
    writeAbandonedBookingPaymentIds(ids);
  }, []);

  const failAbandonedBookingPayment = useCallback(() => {
    if (!autoFailOnLeaveEnabledRef.current) return;
    if (isRentPaymentRef.current) return;
    if (!awaitingConfirmationRef.current) return;
    if (activeFlowModeRef.current === 'upi-intent') return;

    const pendingBooking = bookingRef.current;
    const pendingOrderId = activeOrderIdRef.current;
    const pendingBookingId = pendingBooking?.bookingId || bookingId;

    if (!pendingBookingId || !pendingOrderId) return;

    persistAbandonedBookingPayment(pendingBookingId);

    void paymentService.markPaymentFailed({
      bookingId: pendingBookingId,
      orderId: pendingOrderId,
      paymentType: 'booking',
      metadata: effectiveRentMonthRef.current ? { month: effectiveRentMonthRef.current } : undefined,
      reason: 'Customer left the payment page before completing the booking payment',
      keepalive: true,
    }).catch(() => undefined);
  }, [bookingId, persistAbandonedBookingPayment]);

  const navigateToConfirmed = useCallback((resolvedBookingId: string) => {
    autoFailOnLeaveEnabledRef.current = false;
    clearAbandonedBookingPayment(resolvedBookingId);
    if (currentUser?.id) {
      void offerService.redeemPendingOfferForBooking(resolvedBookingId, currentUser.id);
    }
    void cleanupPaymentUi();
    navigate(buildPaymentSuccessRedirect({
      bookingId: resolvedBookingId,
      app: appType,
      isRentPayment,
      message: isRentPayment
        ? 'Rent payment received successfully.'
        : 'Payment received. Please wait for owner approval.',
      context: isRentPayment ? 'rent' : 'payment',
    }));
  }, [appType, cleanupPaymentUi, clearAbandonedBookingPayment, currentUser?.id, isRentPayment, navigate]);

  const navigateToError = useCallback((message: string) => {
    autoFailOnLeaveEnabledRef.current = false;
    clearAbandonedBookingPayment(bookingId);
    offerService.clearPendingOfferRedemption(bookingId);
    void cleanupPaymentUi();
    navigate(buildPaymentFailureRedirect({
      bookingId,
      propertyId: booking?.propertyId,
      app: appType,
      isRentPayment,
      message,
      context: isRentPayment ? 'rent' : 'payment',
    }));
  }, [appType, booking?.propertyId, bookingId, cleanupPaymentUi, clearAbandonedBookingPayment, isRentPayment, navigate]);

  const navigateToFreshRetry = useCallback(() => {
    autoFailOnLeaveEnabledRef.current = false;
    offerService.clearPendingOfferRedemption(bookingId);
    if (isRentPayment) {
      navigateToError('Rent payment was cancelled. Start again from the resident portal.');
      return;
    }

    void cleanupPaymentUi();
    navigate(buildFreshBookingRetryRedirect({
      bookingId,
      propertyId: booking?.propertyId,
      roomId: booking?.roomId,
      app: appType,
      isRentPayment: false,
    }));
  }, [appType, booking?.propertyId, booking?.roomId, bookingId, cleanupPaymentUi, isRentPayment, navigate, navigateToError]);

  const markCurrentPaymentFailed = useCallback(async (reason: string, orderId?: string) => {
    if (!orderId) {
      if (import.meta.env.DEV) {
        console.warn('Skipping payment failure persistence because no gateway order was created yet.');
      }
      return;
    }
    try {
      await paymentService.markPaymentFailed({
        bookingId,
        orderId,
        paymentType: isRentPayment ? 'monthly' : 'booking',
        metadata: effectiveRentMonth ? { month: effectiveRentMonth } : undefined,
        reason,
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to persist payment failure state:', error);
      }
    }
  }, [bookingId, effectiveRentMonth, isRentPayment]);

  const handleCancelAndRestartFresh = useCallback(async () => {
    autoFailOnLeaveEnabledRef.current = false;
    if (isRentPayment) {
      navigateToError('Rent payment was cancelled. Start again from the resident portal.');
      return;
    }

    setPaying(true);
    setProcessingMessage('Closing your current payment and preparing a fresh retry...');

    await markCurrentPaymentFailed(
      'Payment cancelled by customer before completion',
      activeOrderId || undefined,
    );

    navigateToFreshRetry();
  }, [
    activeOrderId,
    isRentPayment,
    markCurrentPaymentFailed,
    navigateToFreshRetry,
    navigateToError,
  ]);

  useEffect(() => {
    const handlePageHide = () => {
      failAbandonedBookingPayment();
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      failAbandonedBookingPayment();
    };
  }, [failAbandonedBookingPayment]);

  useEffect(() => {
    if (!(awaitingConfirmation && activeFlowMode === 'upi-qr' && activeOrderExpiryTime)) {
      setQrCountdownMs(null);
      return;
    }

    const updateCountdown = () => {
      const expiresAt = Date.parse(activeOrderExpiryTime);
      if (!Number.isFinite(expiresAt)) {
        setQrCountdownMs(null);
        return;
      }
      setQrCountdownMs(Math.max(0, expiresAt - Date.now()));
    };

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [activeFlowMode, activeOrderExpiryTime, awaitingConfirmation]);

  useEffect(() => {
    if (!awaitingConfirmation || activeFlowMode !== 'upi-qr') return;
    if (qrCountdownMs === null || qrCountdownMs > 0) return;
    if (showQrExpiredDialog) return;

    let active = true;

    const expireQrPayment = async () => {
      autoFailOnLeaveEnabledRef.current = false;
      setDelayNotice(null);
      setAwaitingConfirmation(false);
      setActiveFlowMode(null);
      setActiveOrderExpiryTime('');
      setQrCountdownMs(null);
      destroyComponent(upiComponentRef.current);
      upiComponentRef.current = null;
      removeCashfreeInjectedUi();

      await markCurrentPaymentFailed(
        'QR payment expired before completion',
        activeOrderId || undefined,
      );

      if (!active) return;
      setShowQrExpiredDialog(true);
    };

    void expireQrPayment();

    return () => {
      active = false;
    };
  }, [
    activeFlowMode,
    activeOrderId,
    awaitingConfirmation,
    markCurrentPaymentFailed,
    qrCountdownMs,
    showQrExpiredDialog,
  ]);

  useEffect(() => {
    if (!awaitingConfirmation || !bookingId) return;

    let active = true;
    let verifyTimer: number | null = null;
    let delayTimer: number | null = null;

    const resolveCurrentPayment = async (verify: boolean) => {
      const resolution = await resolvePaymentResolution({
        bookingId,
        orderId: activeOrderId || undefined,
        defaultIsRentPayment: isRentPayment,
        verify,
        metadata: effectiveRentMonth ? { month: effectiveRentMonth } : undefined,
      });

      if (!active) return;

      if (resolution.status === 'paid') {
        navigateToConfirmed(resolution.bookingId || bookingId);
        return;
      }

      if (resolution.status === 'failed') {
        navigateToError(getPaymentFailureMessage(resolution.isRentPayment));
        return;
      }

      setDelayNotice(null);
      setProcessingMessage(
        activeFlowMode === 'upi-qr'
          ? 'QR generated. Waiting for scan and backend confirmation...'
          : activeFlowMode === 'upi-intent'
            ? 'Waiting for your UPI app and backend confirmation...'
            : 'Waiting for backend confirmation...',
      );
    };

    const scheduleVerify = () => {
      verifyTimer = window.setTimeout(async () => {
        await resolveCurrentPayment(true);
        if (active) scheduleVerify();
      }, STATUS_VERIFY_INTERVAL_MS);
    };

    const unsubscribeRealtime = deferRealtimeSubscription(() => {
      const bookingChannel = supabase
        .channel(`payment-page-booking-${bookingId}-${activeOrderId || 'pending'}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `id=eq.${bookingId}`,
        }, () => {
          void resolveCurrentPayment(false);
        })
        .subscribe();

      const paymentChannel = supabase
        .channel(`payment-page-payments-${bookingId}-${activeOrderId || 'pending'}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'payments',
          filter: `booking_id=eq.${bookingId}`,
        }, () => {
          void resolveCurrentPayment(false);
        })
        .subscribe();

      return () => {
        void supabase.removeChannel(bookingChannel);
        void supabase.removeChannel(paymentChannel);
      };
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void resolveCurrentPayment(true);
      }
    };

    const removeNativeResumeListener = addNativeResumeListener(() => {
      void resolveCurrentPayment(true);
    });

    void resolveCurrentPayment(true);
    scheduleVerify();
    delayTimer = window.setTimeout(() => {
      if (!active) return;
      setDelayNotice('Payment is taking a little longer than usual. We are still waiting for Cashfree and the backend to confirm the final status.');
    }, DELAY_NOTICE_MS);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      removeNativeResumeListener();
      if (verifyTimer) window.clearTimeout(verifyTimer);
      if (delayTimer) window.clearTimeout(delayTimer);
      unsubscribeRealtime();
    };
  }, [
    activeFlowMode,
    activeOrderId,
    bookingId,
    isRentPayment,
    navigateToConfirmed,
    navigateToError,
    navigateToFreshRetry,
    awaitingConfirmation,
    effectiveRentMonth,
  ]);

  useEffect(() => {
    if (!awaitingConfirmation || activeFlowMode === 'upi-qr') return;

    const timer = window.setTimeout(() => {
      void resolvePaymentResolution({
        bookingId,
        orderId: activeOrderId || undefined,
        defaultIsRentPayment: isRentPayment,
        verify: true,
        metadata: effectiveRentMonth ? { month: effectiveRentMonth } : undefined,
      }).then((resolution) => {
        if (!awaitingConfirmationRef.current) return;

        if (resolution.status === 'paid') {
          navigateToConfirmed(resolution.bookingId || bookingId);
          return;
        }

        if (resolution.status === 'failed') {
          navigateToError(getPaymentFailureMessage(resolution.isRentPayment));
          return;
        }

        navigateToError(getPaymentVerificationTimeoutMessage(isRentPayment));
      }).catch(() => {
        if (!awaitingConfirmationRef.current) return;
        navigateToError(getPaymentVerificationTimeoutMessage(isRentPayment));
      });
    }, CONFIRMATION_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeFlowMode,
    activeOrderId,
    awaitingConfirmation,
    bookingId,
    effectiveRentMonth,
    isRentPayment,
    navigateToConfirmed,
    navigateToError,
  ]);

  const startPayment = useCallback(async (options?: { autoRefresh?: boolean }) => {
    const autoRefresh = !!options?.autoRefresh;
    if (!booking || paying || (awaitingConfirmation && !autoRefresh)) return;

    if (payMethod === 'card' && (!cardComponentsRef.current || !cardComplete)) {
      navigateToError(cardError || 'Complete the secure card fields before continuing.');
      return;
    }

    if (payMethod === 'upi' && (!upiComponentRef.current || !upiReady)) {
      navigateToError(upiError || 'Unable to prepare the selected UPI payment method. Please try again.');
      return;
    }
    if (isRentPayment && !rentGuardReady) {
      return;
    }
    if (isRentPayment && !rentGuardCanPay) {
      navigateToError(rentGuardMessage || 'Rent payment is not open for the current cycle yet.');
      return;
    }

    setRefreshingQr(autoRefresh);
    setPaying(true);
    setShowQrExpiredDialog(false);
    setDelayNotice(null);
    setProcessingMessage(autoRefresh ? 'Refreshing secure payment...' : 'Preparing secure payment...');
    let nextOrderId = '';

    try {
      const preferredPhone = userData?.phone || currentUser?.phone || booking.customerPhone || '';
      const result = await paymentService.processPayment({
        bookingId: booking.bookingId,
        amount: payableAmount,
        customerId: booking.customerId,
        propertyId: booking.propertyId,
        roomId: booking.roomId,
        paymentType: isRentPayment ? 'monthly' : 'booking',
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        customerPhone: preferredPhone,
        description: isRentPayment
          ? `Monthly rent for ${booking.propertyTitle}`
          : `Booking payment for ${booking.propertyTitle}`,
        metadata: {
          startDate: booking.startDate,
          endDate: booking.endDate,
          ...(effectiveRentMonth ? { month: effectiveRentMonth } : {}),
        },
        returnBaseUrl: safeReturnBaseUrl || undefined,
      }, payMethod === 'upi' ? resolvedIntentApp || selectedUpiApp || availableUpiIntentApps[0] : undefined);

      if (!result.success) {
        await markCurrentPaymentFailed(result.message || 'Payment initiation failed');
        navigateToError(result.message || 'Payment initiation failed');
        return;
      }

      if (result.metadata?.alreadyPaid || result.status === 'completed') {
        await cleanupPaymentUi();
        navigate(buildPaymentSuccessRedirect({
          bookingId: booking.bookingId,
          app: appType,
          isRentPayment,
          message: isRentPayment
            ? 'Rent payment received successfully.'
            : 'Payment received. Please wait for owner approval.',
          context: isRentPayment ? 'rent' : 'payment',
        }));
        return;
      }

      if (!result.paymentSessionId || !result.orderId) {
        await markCurrentPaymentFailed('Missing payment session. Please try again.', result.orderId);
        navigateToError('Missing payment session. Please try again.');
        return;
      }

      nextOrderId = result.orderId;

      setProcessingMessage(
        payMethod === 'upi'
          ? upiMode === 'qr'
            ? autoRefresh
              ? 'Refreshing QR...'
              : 'Generating your payment QR...'
            : 'Opening your UPI app...'
          : 'Authorizing secure card payment...',
      );

      const flowMode: ActiveFlowMode = payMethod === 'card' ? 'card' : upiMode === 'qr' ? 'upi-qr' : 'upi-intent';
      const paymentRequest = paymentService.payWithCashfreeComponent({
        component: payMethod === 'upi'
          ? upiComponentRef.current!
          : cardComponentsRef.current!.number,
        paymentSessionId: result.paymentSessionId,
      });

      if (flowMode === 'upi-qr') {
        const resolvedQrExpiryTime = resolveQrExpiryTime(result.orderExpiryTime);
        setActiveOrderId(result.orderId);
        setActiveOrderExpiryTime(resolvedQrExpiryTime);
        setActiveFlowMode(flowMode);
        setAwaitingConfirmation(true);
        setProcessingMessage(
          autoRefresh
            ? 'QR refreshed. Waiting for scan and backend confirmation...'
            : 'QR ready. Scan it using any UPI app.',
        );

        toast.success(
          autoRefresh
            ? 'QR refreshed. Use the latest code to complete payment.'
            : 'QR ready. Scan it with any UPI app.',
        );

        void paymentRequest.then(async (paymentResult) => {
          if (!paymentResult?.error?.message) return;

          await markCurrentPaymentFailed(paymentResult.error.message, result.orderId);
          setAwaitingConfirmation(false);
          navigateToError(getPaymentFailureMessage(isRentPayment));
        }).catch(async (error) => {
          const message = error instanceof Error ? error.message : 'Payment failed';
          await markCurrentPaymentFailed(message, result.orderId);
          setAwaitingConfirmation(false);
          navigateToError(getPaymentFailureMessage(isRentPayment));
        });

        return;
      }

      const paymentResult = await paymentRequest;

      if (paymentResult?.error?.message) {
        if (payMethod === 'upi' && upiMode === 'intent' && isCashfreeIntentBridgeError(paymentResult.error.message)) {
          destroyComponent(upiComponentRef.current);
          upiComponentRef.current = null;
          setAwaitingConfirmation(false);
          setActiveFlowMode(null);
          setActiveOrderId('');
          setActiveOrderExpiryTime('');
          setResolvedIntentApp(null);
          setForceQrFallback(true);
          setUpiReady(false);
          setUpiError(null);
          setUpiNotice(DIRECT_UPI_QR_FALLBACK_NOTICE);
          return;
        }

        await markCurrentPaymentFailed(paymentResult.error.message, result.orderId);
        navigateToError(getPaymentFailureMessage(isRentPayment));
        return;
      }

      setActiveOrderId(result.orderId);
      setActiveOrderExpiryTime(resolveQrExpiryTime(result.orderExpiryTime));
      setActiveFlowMode(flowMode);
      setAwaitingConfirmation(true);
      setProcessingMessage(
        payMethod === 'upi'
          ? payMethod === 'upi' && upiMode === 'qr'
            ? 'QR ready. Scan it using any UPI app.'
            : 'Waiting for UPI confirmation...'
          : 'Waiting for card payment confirmation...',
      );
    } catch (error) {
      if (payMethod === 'upi' && upiMode === 'intent' && isCashfreeIntentBridgeError(error)) {
        destroyComponent(upiComponentRef.current);
        upiComponentRef.current = null;
        setAwaitingConfirmation(false);
        setActiveFlowMode(null);
        setActiveOrderId('');
        setActiveOrderExpiryTime('');
        setResolvedIntentApp(null);
        setForceQrFallback(true);
        setUpiReady(false);
        setUpiError(null);
        setUpiNotice(DIRECT_UPI_QR_FALLBACK_NOTICE);
        return;
      }

      const message = error instanceof Error ? error.message : 'Payment failed';
      await markCurrentPaymentFailed(message, nextOrderId || undefined);
      if (nextOrderId) {
        navigateToError(getPaymentFailureMessage(isRentPayment));
        return;
      }
      navigateToError(message);
    } finally {
      setPaying(false);
      setRefreshingQr(false);
    }
  }, [
    appType,
    awaitingConfirmation,
    booking,
    cardComplete,
    cardError,
    cleanupPaymentUi,
    currentUser?.phone,
    isRentPayment,
    markCurrentPaymentFailed,
    navigate,
    navigateToError,
    payMethod,
    paying,
    effectiveRentMonth,
    availableUpiIntentApps,
    resolvedIntentApp,
    selectedUpiApp,
    rentGuardReady,
    rentGuardCanPay,
    rentGuardMessage,
    safeReturnBaseUrl,
    payableAmount,
    upiError,
    upiMode,
    upiReady,
    userData?.phone,
  ]);

  useEffect(() => {
    if (!awaitingConfirmation || activeFlowMode !== 'upi-qr' || qrCountdownMs === null) {
      return;
    }

    if (qrCountdownMs <= 0) {
      setDelayNotice('Payment failed. Start fresh payment.');
      return;
    }

    if (qrCountdownMs <= QR_COUNTDOWN_DANGER_MS) {
      setDelayNotice('Less than 30 seconds left. Complete payment now or start fresh.');
      return;
    }

    if (qrCountdownMs <= QR_COUNTDOWN_WARNING_MS) {
      setDelayNotice('This QR will expire soon. Complete payment before it closes.');
      return;
    }

    setDelayNotice(null);
  }, [activeFlowMode, awaitingConfirmation, qrCountdownMs]);

  const onPayNow = useCallback(() => {
    void startPayment();
  }, [startPayment]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 via-white to-orange-50">
        <div className="bg-white rounded-3xl shadow-xl border border-orange-100 px-8 py-10 text-center">
          <div className="flex items-center justify-center gap-3 text-orange-500 font-semibold">
            <FiClock className="animate-spin" /> Loading payment details...
          </div>
          <p className="mt-3 text-xs text-gray-400">Please keep this window open.</p>
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Booking not found.</div>
      </div>
    );
  }

  return (
    <div className={`${isMobileViewport ? 'min-h-[100dvh] overflow-y-auto bg-white' : 'h-[100dvh] overflow-hidden bg-white'} md:min-h-screen md:overflow-visible md:bg-gradient-to-b md:from-orange-50 md:via-white md:to-slate-50`}>
      {showProcessingOverlay && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-[2rem] border border-white/20 bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-orange-50 text-orange-500">
              <FiLoader className="text-3xl animate-spin" />
            </div>
            <h2 className="mt-5 text-2xl font-black text-gray-900">Processing Payment</h2>
            <p className="mt-2 text-sm font-medium text-gray-500">{processingMessage}</p>
            <p className="mt-5 text-xs uppercase tracking-[0.24em] text-gray-400">Do not close this page</p>
            {showFreshRetryButton && activeFlowMode !== 'upi-qr' && (
              <button
                type="button"
                onClick={() => void handleCancelAndRestartFresh()}
                className="mt-5 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black uppercase tracking-[0.18em] text-slate-700 transition-all hover:border-slate-300 hover:text-slate-900"
              >
                Start Fresh Payment
              </button>
            )}
          </div>
        </div>
      )}

      {showQrExpiredDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 px-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[2rem] border border-red-100 bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500">
              <FiAlertTriangle className="text-3xl" />
            </div>
            <h2 className="mt-5 text-2xl font-black text-gray-900">Payment Failed</h2>
            <p className="mt-2 text-sm font-medium leading-relaxed text-gray-500">
              Payment failed. Start fresh payment.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowQrExpiredDialog(false);
                navigateToFreshRetry();
              }}
              className="mt-6 w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-orange-600"
            >
              Start Fresh Payment
            </button>
          </div>
        </div>
      )}

      <div className={`mx-auto flex max-w-6xl flex-col px-2 py-2 sm:px-4 sm:py-6 lg:h-auto lg:overflow-visible lg:py-10 ${isMobileViewport ? 'min-h-[100dvh] overflow-visible pb-6' : 'h-full overflow-hidden'}`}>
        <div className={`flex min-h-0 flex-1 flex-col gap-2 lg:flex-row lg:gap-8 lg:overflow-visible ${isMobileViewport ? 'overflow-visible' : 'overflow-hidden'}`}>
          <div className="shrink-0 rounded-[22px] border border-orange-100 bg-white p-2.5 shadow-[0_18px_40px_rgba(15,23,42,0.10)] sm:rounded-3xl sm:p-6 lg:flex-1 lg:p-7">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold text-orange-500 uppercase tracking-widest">
                  Booking Summary
                </p>
                <h1 className="rfm-pg-title-single-line mt-1 text-[18px] font-black leading-[1.02] tracking-tight text-gray-900 sm:text-2xl" title={booking.propertyTitle}>{booking.propertyTitle}</h1>
                <p className="mt-1 text-[12px] text-gray-500 sm:text-sm">
                  Room {booking.roomNumber}
                  {requestedMonth ? ` | ${requestedMonth}` : ''}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 sm:h-12 sm:w-12">
                <FiShield />
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-4">
              <div className="rounded-2xl bg-gray-50 p-2 sm:p-4">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Check-in</p>
                <p className="mt-1 text-[13px] font-semibold leading-tight text-gray-900 sm:text-sm">{booking.startDate}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-2 sm:p-4">
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Check-out</p>
                <p className="mt-1 text-[13px] font-semibold leading-tight text-gray-900 sm:text-sm">{booking.endDate || 'Open'}</p>
              </div>
            </div>

            <div className="mt-2.5 rounded-2xl border border-orange-100 bg-orange-50/60 p-3 sm:mt-5 sm:p-5">
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Price Breakdown</p>
                <div className="mt-2 space-y-1.5 text-[12px] text-gray-600 sm:mt-4 sm:space-y-3 sm:text-sm">
                  <div className="flex items-center justify-between">
                  <span>{checkoutSummary?.roomChargeLabel || 'Room Charges'}</span>
                  <span className="font-semibold">{formatCurrency(checkoutSummary?.roomCharge || totalDue)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                  <span>Room GST</span>
                  <span className="font-semibold">{formatCurrency(checkoutSummary?.roomGst || 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Platform Fee</span>
                  <span className="font-semibold">{formatCurrency(checkoutSummary?.platformFee || 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>GST on Platform Fee</span>
                  <span className="font-semibold">{formatCurrency(checkoutSummary?.platformGst || 0)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-orange-100 pt-2 text-gray-900">
                  <span className="font-bold">Total Payable</span>
                  <span className="font-black">{formatCurrency(payableAmount)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-none flex-col rounded-[22px] border border-gray-100 bg-white p-2.5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] sm:rounded-3xl sm:p-6 lg:w-[420px] lg:self-start">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payment Method</p>
            <div className="mt-2 flex gap-2 sm:mt-4">
              <button
                className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-bold transition-all ${payMethod === 'upi' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-100 bg-gray-50 text-gray-600'}`}
                onClick={() => setPayMethod('upi')}
                type="button"
              >
                {upiMode === 'qr' ? 'QR Code' : 'UPI Apps'}
              </button>
              {showCardOption && (
                <button
                  className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-bold transition-all ${payMethod === 'card' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-100 bg-gray-50 text-gray-600'}`}
                  onClick={() => setPayMethod('card')}
                  type="button"
                >
                  Card
                </button>
              )}
            </div>

            <div className={`mt-2 pr-0 no-scrollbar sm:mt-4 ${isMobileViewport ? 'overflow-visible pb-4' : 'min-h-0 flex-1 overflow-y-auto pr-1'}`}>
            {payMethod === 'upi' && (
              <div className={isMobileViewport ? 'space-y-2' : 'space-y-3'}>
                {upiError ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                    {upiError}
                  </div>
                ) : null}
                {upiNotice ? (
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
                    {upiNotice}
                  </div>
                ) : null}
                {isRentPayment && rentGuardMessage ? (
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
                    {rentGuardMessage}
                  </div>
                ) : null}
                {upiMode === 'qr' ? (
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                    <div className={`gap-3 ${isMobileViewport ? 'flex flex-col items-start' : 'flex items-center justify-between'}`}>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-gray-400">Inline UPI QR</p>
                      <span className={`rounded-full border px-3 py-1 text-xs font-black tracking-[0.08em] ${qrCountdownUi.badgeClass}`}>
                        {qrCountdownUi.label}
                      </span>
                    </div>
                    <div className={`relative mt-4 flex items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-200 bg-white px-3 py-4 ${isMobileViewport ? 'min-h-[260px]' : 'min-h-[240px]'}`}>
                      <div id={upiMountId} className={`flex w-full items-center justify-center ${isMobileViewport ? 'min-h-[240px]' : 'min-h-[220px]'}`} />
                      {!isQrGenerated && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/95 px-6 text-center">
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                            <FiShield className="text-xl" />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900">QR activates after Pay Now</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className={`mt-4 ${isMobileViewport ? 'flex justify-stretch' : 'flex justify-end'}`}>
                      <button
                        type="button"
                        onClick={() => void startPayment({ autoRefresh: true })}
                        disabled={paying || refreshingQr || !upiReady || !isQrGenerated}
                        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 transition-all hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 ${isMobileViewport ? 'w-full' : ''}`}
                      >
                        <FiRefreshCw className={refreshingQr ? 'animate-spin' : ''} />
                        Refresh QR
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      {availableUpiIntentApps.map((appKey) => {
                        const isSelected = selectedUpiApp === appKey;
                        return (
                          <button
                            key={appKey}
                            type="button"
                            onClick={() => setSelectedUpiApp(appKey)}
                            className={`rounded-[18px] border px-2 py-2 text-center transition-all ${
                              isSelected
                                ? 'border-transparent bg-slate-950 text-white shadow-[0_16px_28px_rgba(15,23,42,0.22)]'
                                : 'border-slate-200 bg-white text-slate-700'
                            }`}
                          >
                            <div className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br text-white ${UPI_APP_ACCENTS[appKey]}`}>
                              <FiSmartphone size={14} />
                            </div>
                            <p className="mt-1 text-[10px] font-black leading-none">{UPI_APP_LABELS[appKey]}</p>
                            <p className="mt-1 text-[8px] font-semibold uppercase tracking-[0.12em] opacity-70">
                              {isSelected ? 'Selected' : 'Tap to use'}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    {!isMobileViewport && (
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      Selected app:
                      <span className="ml-2 font-black text-slate-900">
                        {selectedUpiApp ? UPI_APP_LABELS[selectedUpiApp] : 'None'}
                      </span>
                    </div>
                    )}
                    <div className="relative h-0 overflow-hidden">
                      <div
                        id={upiMountId}
                        className="absolute inset-0 opacity-0 pointer-events-none"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className={payMethod === 'card' ? 'mt-4 space-y-3' : 'mt-4 hidden'} aria-hidden={payMethod !== 'card'}>
              <div>
                <label className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Card Number</label>
                <div id={cardNumberMountId} className="mt-1 min-h-12 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Card Holder Name</label>
                <div id={cardHolderMountId} className="mt-1 min-h-12 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Expiry</label>
                  <div id={cardExpiryMountId} className="mt-1 min-h-12 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">CVV</label>
                  <div id={cardCvvMountId} className="mt-1 min-h-12 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3" />
                </div>
              </div>

              {cardError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {cardError}
                </div>
              )}

            </div>
            </div>

            {awaitingConfirmation && (
              <div className={`${isMobileViewport ? 'mt-3' : 'mt-4'} rounded-2xl border px-4 py-3 text-sm font-medium ${qrCountdownUi.noticeClass}`}>
                {processingMessage}
              </div>
            )}

            {delayNotice && (
              <div className={`${isMobileViewport ? 'mt-3' : 'mt-4'} rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800`}>
                {delayNotice}
              </div>
            )}

            {showFreshRetryButton && activeFlowMode === 'upi-qr' && (
              <button
                type="button"
                onClick={() => void handleCancelAndRestartFresh()}
                className={`${isMobileViewport ? 'mt-3' : 'mt-4'} w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black uppercase tracking-[0.18em] text-slate-700 transition-all hover:border-slate-300 hover:text-slate-900`}
              >
                Start Fresh Payment
              </button>
            )}

            <div className={isMobileViewport ? 'mt-2' : 'mt-3 shrink-0 border-t border-slate-100 pt-3 sm:mt-6 sm:border-t-0 sm:pt-0'}>
              <button
                onClick={onPayNow}
                disabled={
                  paying ||
                  awaitingConfirmation ||
                  payableAmount <= 0 ||
                  (isRentPayment && !rentGuardReady) ||
                  (isRentPayment && !rentGuardCanPay) ||
                  (payMethod === 'upi' ? !upiReady || !!upiError : !cardComplete || !!cardError)
                }
                className="h-12 w-full rounded-2xl bg-orange-500 text-white font-black shadow-lg shadow-orange-200 transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
              >
                {payNowLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentPage;
