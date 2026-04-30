import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import Modal from '../common/Modal'; // Ensure this path is correct
import { offerService } from '../../services/offer.service';
import { toast } from 'react-hot-toast';
import { FiTag, FiCalendar, FiDollarSign, FiPercent, FiLayers } from 'react-icons/fi';
// Removed legacy firebase imports

interface CreateOfferModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

interface OfferFormData {
    code: string;
    title: string;
    subtitle: string;
    type: 'percentage' | 'flat';
    value: number;
    appliesTo: string[];
    maxDiscount: number;
    minBookingAmount: number;
    expiryDate: string;
    usageLimit: number;
}

const CreateOfferModal: React.FC<CreateOfferModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const { register, handleSubmit, formState: { errors }, reset, watch } = useForm<OfferFormData>({
        defaultValues: {
            type: 'percentage',
            appliesTo: ['all'],
            usageLimit: 100,
            minBookingAmount: 0
        }
    });
    const [loading, setLoading] = useState(false);

    const offerType = watch('type');

    const onSubmit = async (data: OfferFormData) => {
        setLoading(true);
        try {
            await offerService.createOffer({
                code: data.code,
                title: data.title,
                description: data.subtitle, // schema uses description
                discount_type: data.type === 'flat' ? 'fixed' : 'percentage', // schema check constraint uses 'fixed'
                discount_value: Number(data.value),
                max_discount: Number(data.maxDiscount),
                min_booking_amount: Number(data.minBookingAmount),
                valid_until: new Date(data.expiryDate).toISOString(),
                max_uses: Number(data.usageLimit),
                current_uses: 0,
                is_active: true
            });
            toast.success('Offer created successfully!');
            reset();
            onSuccess();
            onClose();
        } catch (error: unknown) {
            toast.error((error as Error).message || 'Failed to create offer');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create New Offer" maxWidth="max-w-2xl">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

                {/* Code & Title */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-gray-700">Offer Code</label>
                        <div className="relative">
                            <FiTag className="absolute left-3 top-3 text-gray-400" />
                            <input
                                {...register('code', { required: 'Code is required', minLength: 3 })}
                                type="text"
                                className="w-full pl-10 pr-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 uppercase font-mono"
                                placeholder="SUMMER20"
                            />
                        </div>
                        {errors.code && <span className="text-xs text-red-500">{errors.code.message}</span>}
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-gray-700">Title</label>
                        <input
                            {...register('title', { required: 'Title is required' })}
                            type="text"
                            className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500"
                            placeholder="Summer Sale"
                        />
                    </div>
                </div>

                {/* Subtitle */}
                <div className="space-y-1">
                    <label className="text-sm font-semibold text-gray-700">Subtitle / Description</label>
                    <input
                        {...register('subtitle', { required: 'Subtitle is required' })}
                        type="text"
                        className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500"
                        placeholder="Get 20% off on your first booking"
                    />
                </div>

                {/* Type & Value */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-gray-700">Discount Type</label>
                        <select
                            {...register('type')}
                            className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                            <option value="percentage">Percentage (%)</option>
                            <option value="flat">Flat Amount (₹)</option>
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-gray-700">Value</label>
                        <div className="relative">
                            {offerType === 'percentage' ?
                                <FiPercent className="absolute left-3 top-3 text-gray-400" /> :
                                <FiDollarSign className="absolute left-3 top-3 text-gray-400" />
                            }
                            <input
                                {...register('value', { required: true, min: 1 })}
                                type="number"
                                className="w-full pl-10 pr-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500"
                                placeholder="20"
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-gray-700">Max Discount (₹)</label>
                        <div className="relative">
                            <span className="absolute left-3 top-2.5 text-gray-400 font-bold">₹</span>
                            <input
                                {...register('maxDiscount', { required: true, min: 0 })}
                                type="number"
                                className="w-full pl-10 pr-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500"
                                placeholder="500"
                            />
                        </div>
                    </div>
                </div>

                {/* Constraints */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-gray-700">Min Booking (₹)</label>
                        <input
                            {...register('minBookingAmount')}
                            type="number"
                            className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500"
                            placeholder="0"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-gray-700">Usage Limit</label>
                        <input
                            {...register('usageLimit')}
                            type="number"
                            className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500"
                            placeholder="100"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-gray-700">Expiry Date</label>
                        <div className="relative">
                            <FiCalendar className="absolute left-3 top-3 text-gray-400" />
                            <input
                                {...register('expiryDate', { required: true })}
                                type="date"
                                className="w-full pl-10 pr-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Warning / Note */}
                <div className="bg-blue-50 p-4 rounded-xl text-sm text-blue-700 border border-blue-100 flex items-start gap-2">
                    <FiLayers className="mt-0.5" />
                    <p>Offers are automatically synced to the Customer App. Users can redeem them immediately after creation. Ensure the code is unique.</p>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-5 py-2 text-gray-600 font-semibold hover:bg-gray-100 rounded-xl transition-colors"
                        disabled={loading}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="px-6 py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition-all disabled:opacity-50"
                        disabled={loading}
                    >
                        {loading ? 'Creating...' : 'Create Offer'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default CreateOfferModal;
