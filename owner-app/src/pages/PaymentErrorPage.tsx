import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiAlertTriangle } from 'react-icons/fi';

const PaymentErrorPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const context = (searchParams.get('context') || 'payment').toLowerCase();
  const isRefund = context.includes('refund');
  const isVerification = context.includes('verification');
  const defaultMessage = isRefund
    ? 'A refund has been initiated and will be credited to the original payment method.'
    : isVerification
      ? 'Payment verification is taking longer than expected.'
      : 'Payment could not be completed. Please try again.';
  const message = searchParams.get('message') || defaultMessage;
  const appParam = String(searchParams.get('app') || '').toLowerCase();
  const currentApp = String(import.meta.env.VITE_APP_TYPE || 'owner').toLowerCase();
  const targetApp = appParam || currentApp;

  useEffect(() => {
    const blockBack = () => {
      window.history.pushState(null, '', window.location.href);
    };
    blockBack();
    window.addEventListener('popstate', blockBack);
    return () => window.removeEventListener('popstate', blockBack);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-[2rem] shadow-2xl border border-gray-100 p-10 w-full max-w-lg text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-5">
          <FiAlertTriangle className="text-red-500 text-2xl" />
        </div>
        <h1 className="text-2xl font-black text-gray-900 mb-3">{isRefund ? 'Refund Issued' : 'Payment Failed'}</h1>
        <p className="text-gray-600 font-medium leading-relaxed">{message}</p>
        <p className="text-xs text-gray-400 mt-3 uppercase tracking-widest">Context: {context}</p>

        <div className="mt-8 grid grid-cols-1 gap-3">
          <button
            onClick={() => navigate(`/bookings?app=${encodeURIComponent(targetApp)}`)}
            className="w-full py-4 bg-gray-900 text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-all"
          >
            Go to Bookings
          </button>
        </div>
      </div>
    </div>
  );
};

export default PaymentErrorPage;
