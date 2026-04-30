import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiCheckCircle } from 'react-icons/fi';

const PaymentConfirmedPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const bookingId = searchParams.get('bookingId') || searchParams.get('booking_id') || '';
  const appParam = String(searchParams.get('app') || '').toLowerCase();
  const currentApp = String(import.meta.env.VITE_APP_TYPE || 'admin').toLowerCase();
  const targetApp = appParam || currentApp;

  useEffect(() => {
    const blockBack = () => {
      window.history.pushState(null, '', window.location.href);
    };
    blockBack();
    window.addEventListener('popstate', blockBack);

    const timer = setTimeout(() => {
      const suffix = bookingId ? `?highlight=${bookingId}&app=${encodeURIComponent(targetApp)}` : `?app=${encodeURIComponent(targetApp)}`;
      navigate(`/bookings${suffix}`);
    }, 2500);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('popstate', blockBack);
    };
  }, [bookingId, navigate, targetApp]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 via-white to-blue-50 p-6">
      <div className="bg-white rounded-[2.5rem] shadow-2xl border border-blue-100 p-10 w-full max-w-md text-center">
        <div className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
          <FiCheckCircle className="text-blue-600 text-6xl" />
        </div>
        <h1 className="text-2xl font-black text-gray-900 mt-6">Payment Successful</h1>
        <p className="text-gray-500 font-medium mt-2">Booking payment is confirmed.</p>
        <p className="text-xs text-gray-400 mt-6">Redirecting to bookings...</p>
      </div>
    </div>
  );
};

export default PaymentConfirmedPage;

