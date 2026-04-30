import React from 'react';
import { FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';

interface PaymentResultOverlayProps {
  open: boolean;
  variant: 'success' | 'failed';
  title: string;
  message: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  onClose: () => void;
}

const PaymentResultOverlay: React.FC<PaymentResultOverlayProps> = ({
  open,
  variant,
  title,
  message,
  primaryLabel = 'Okay, Got It',
  onPrimary,
  onClose,
}) => {
  if (!open) return null;

  const isSuccess = variant === 'success';

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-[30px] bg-white shadow-2xl border border-slate-100">
        <div className={`px-8 py-8 text-center ${isSuccess ? 'bg-blue-50' : 'bg-red-50'}`}>
          <div className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full ${isSuccess ? 'bg-blue-100 text-blue-600' : 'bg-red-100 text-red-600'}`}>
            {isSuccess ? <FiCheckCircle size={42} /> : <FiAlertTriangle size={38} />}
          </div>
          <h3 className="text-2xl font-black text-slate-900">{title}</h3>
          <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{message}</p>
        </div>

        <div className="px-8 py-7">
          <button
            type="button"
            onClick={onPrimary || onClose}
            className={`w-full rounded-2xl py-4 text-sm font-black uppercase tracking-[0.18em] text-white transition-all active:scale-95 ${isSuccess ? 'bg-blue-600 hover:bg-blue-700' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PaymentResultOverlay;
