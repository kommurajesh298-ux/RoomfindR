import React from 'react';
import { FiAlertTriangle } from 'react-icons/fi';

interface VacateWarningModalProps {
    open: boolean;
    remainingDays: number | null;
    onClose: () => void;
    onConfirm: () => void;
    isSubmitting?: boolean;
}

const VacateWarningModal: React.FC<VacateWarningModalProps> = ({
    open,
    remainingDays,
    onClose,
    onConfirm,
    isSubmitting = false
}) => {
    if (!open) return null;

    const hasRemainingDays = typeof remainingDays === 'number' && remainingDays > 0;

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-[390px] overflow-hidden rounded-[28px] border border-orange-100 bg-white shadow-2xl">
                <div className="bg-gradient-to-b from-orange-50 to-white px-5 py-5 sm:px-7 sm:py-6">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                        <FiAlertTriangle size={26} />
                    </div>
                    <div className="text-center">
                        <h3 className="text-[20px] font-black leading-tight text-slate-900 sm:text-[22px]">
                            {hasRemainingDays ? 'Vacating Before Due Date' : 'Confirm Vacate Request'}
                        </h3>
                        <p className="mt-2 text-[13px] font-medium leading-6 text-slate-600 sm:text-sm">
                            {hasRemainingDays
                                ? `${remainingDays} day${remainingDays === 1 ? '' : 's'} are still remaining before your next due date.`
                                : 'Your request will be sent to the owner for approval.'}
                        </p>
                    </div>
                </div>

                <div className="space-y-2 px-5 pb-2 pt-1 sm:px-7">
                    <div className="rounded-[20px] border border-orange-100 bg-orange-50/70 p-3.5">
                        <p className="text-[12px] font-bold leading-5 text-slate-700 sm:text-[13px]">
                            RoomFindR only forwards your vacate request to the owner.
                        </p>
                        <p className="mt-1.5 text-[12px] font-medium leading-5 text-slate-600 sm:text-[13px]">
                            Any exit settlement, maintenance deduction, or remaining advance refund must be discussed and collected directly from the owner.
                        </p>
                        <p className="mt-1.5 text-[12px] font-semibold leading-5 text-slate-700 sm:text-[13px]">
                            RoomFindR and RoomFindR admin are not responsible for those owner-side adjustments.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 px-5 pb-5 pt-3 sm:px-7 sm:pb-6">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="rounded-2xl border border-slate-200 bg-slate-50 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600 transition-all hover:bg-slate-100 disabled:opacity-60 sm:text-[12px]"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={isSubmitting}
                        className="rounded-2xl bg-red-500 py-3 text-[11px] font-black uppercase tracking-[0.16em] text-white transition-all hover:bg-red-600 disabled:opacity-60 sm:text-[12px]"
                    >
                        {isSubmitting ? 'Sending...' : 'Continue'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VacateWarningModal;
