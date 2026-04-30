import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';
import type { IconType } from 'react-icons';
import { IoBusinessOutline, IoDiamondOutline, IoFemaleOutline, IoHomeOutline, IoMaleOutline, IoStarOutline } from 'react-icons/io5';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    FiArrowLeft, FiMapPin, FiWifi, FiCheck, FiImage, FiHome, FiChevronRight, FiTag,
    FiZap, FiShield, FiDroplet, FiSun, FiCamera, FiTruck, FiCoffee, FiRepeat, FiWind
} from 'react-icons/fi';
import { ImageUploader } from '../components/properties/ImageUploader';
import { propertyService } from '../services/property.service';
import { useAuth } from '../hooks/useAuth';
import { useOwner } from '../hooks/useOwner';
import type { Property, PropertyFeatures } from '../types/property.types';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import { RUPEE_SYMBOL } from '../utils/currency';
import {
    preventNumberInputStepperKeys,
    preventNumberInputWheelChange,
    sanitizeAmountValue
} from '../utils/amountInput';

const STEPS = [
    { number: 1, title: 'Property Details' },
    { number: 2, title: 'Offers' }
];

const INITIAL_FEATURES: PropertyFeatures = {
    wifi: true, ac: false, meals: false, laundry: false,
    security: false, parking: false, cctv: false,
    powerBackup: false, waterSupply: true, housekeeping: false
};



const INITIAL_PROPERTY_STATE = (ownerId: string): Partial<Property> => ({
    ownerId,
    title: '',
    description: '',
    address: { text: '', lat: 0, lng: 0, pincode: '' },
    city: 'Bengaluru',
    tags: [],
    features: { ...INITIAL_FEATURES },
    pricePerMonth: 0,
    foodPrice: 0,
    advanceAmount: 500,
    currency: 'INR',
    images: [],
    foodMenu: [],
    nearbyPlaces: [],
    vacancies: 0,
    propertyId: crypto.randomUUID() // Temp ID for uploads
});

const PROPERTY_CATEGORIES: Array<{ id: string; label: string; icon: IconType }> = [
    { id: 'Boys', label: 'Boys PG', icon: IoMaleOutline },
    { id: 'Girls', label: 'Girls PG', icon: IoFemaleOutline },
    { id: 'Hostel', label: 'Hostel', icon: IoBusinessOutline },
    { id: 'Co-living', label: 'Co-living', icon: IoHomeOutline }
];

const PROPERTY_TIERS: Array<{ id: string; label: string; icon: IconType }> = [
    { id: 'Premium', label: 'Premium', icon: IoStarOutline },
    { id: 'Luxury', label: 'Luxury', icon: IoDiamondOutline }
];

const FEATURE_CONFIG: Record<string, { icon: React.ReactNode; label: string; activeColor: string; activeBg: string; activeShadow: string; hoverColor: string; hoverBg: string }> = {
    wifi:         { icon: <FiWifi size={20} />,     label: 'WiFi',          activeColor: 'text-white', activeBg: 'bg-blue-500 border-blue-500',   activeShadow: 'shadow-[0_8px_20px_rgba(59,130,246,0.35)]',  hoverColor: 'hover:text-blue-600',   hoverBg: 'hover:bg-blue-50 hover:border-blue-200' },
    ac:           { icon: <FiWind size={20} />,     label: 'AC',            activeColor: 'text-white', activeBg: 'bg-cyan-500 border-cyan-500',    activeShadow: 'shadow-[0_8px_20px_rgba(6,182,212,0.35)]',   hoverColor: 'hover:text-cyan-600',   hoverBg: 'hover:bg-cyan-50 hover:border-cyan-200' },
    meals:        { icon: <FiCoffee size={20} />,   label: 'Meals',         activeColor: 'text-white', activeBg: 'bg-amber-500 border-amber-500',  activeShadow: 'shadow-[0_8px_20px_rgba(245,158,11,0.35)]',  hoverColor: 'hover:text-amber-600',  hoverBg: 'hover:bg-amber-50 hover:border-amber-200' },
    laundry:      { icon: <FiRepeat size={20} />,   label: 'Laundry',       activeColor: 'text-white', activeBg: 'bg-violet-500 border-violet-500',activeShadow: 'shadow-[0_8px_20px_rgba(139,92,246,0.35)]',  hoverColor: 'hover:text-violet-600', hoverBg: 'hover:bg-violet-50 hover:border-violet-200' },
    security:     { icon: <FiShield size={20} />,   label: 'Security',      activeColor: 'text-white', activeBg: 'bg-green-500 border-green-500',  activeShadow: 'shadow-[0_8px_20px_rgba(34,197,94,0.35)]',   hoverColor: 'hover:text-green-600',  hoverBg: 'hover:bg-green-50 hover:border-green-200' },
    parking:      { icon: <FiTruck size={20} />,    label: 'Parking',       activeColor: 'text-white', activeBg: 'bg-slate-600 border-slate-600',  activeShadow: 'shadow-[0_8px_20px_rgba(71,85,105,0.35)]',   hoverColor: 'hover:text-slate-600',  hoverBg: 'hover:bg-slate-50 hover:border-slate-200' },
    cctv:         { icon: <FiCamera size={20} />,   label: 'CCTV',          activeColor: 'text-white', activeBg: 'bg-red-500 border-red-500',      activeShadow: 'shadow-[0_8px_20px_rgba(239,68,68,0.35)]',   hoverColor: 'hover:text-red-500',    hoverBg: 'hover:bg-red-50 hover:border-red-200' },
    powerBackup:  { icon: <FiZap size={20} />,      label: 'Power Backup',  activeColor: 'text-white', activeBg: 'bg-yellow-500 border-yellow-500',activeShadow: 'shadow-[0_8px_20px_rgba(234,179,8,0.35)]',   hoverColor: 'hover:text-yellow-600', hoverBg: 'hover:bg-yellow-50 hover:border-yellow-200' },
    waterSupply:  { icon: <FiDroplet size={20} />,  label: 'Water Supply',  activeColor: 'text-white', activeBg: 'bg-sky-500 border-sky-500',      activeShadow: 'shadow-[0_8px_20px_rgba(14,165,233,0.35)]',  hoverColor: 'hover:text-sky-600',    hoverBg: 'hover:bg-sky-50 hover:border-sky-200' },
    housekeeping: { icon: <FiSun size={20} />,      label: 'Housekeeping',  activeColor: 'text-white', activeBg: 'bg-rose-500 border-rose-500',    activeShadow: 'shadow-[0_8px_20px_rgba(244,63,94,0.35)]',   hoverColor: 'hover:text-rose-600',   hoverBg: 'hover:bg-rose-50 hover:border-rose-200' },
};

const AddProperty: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const { currentUser } = useAuth();
    const { verificationStatus } = useOwner();

    // Default to step 1
    const currentStep = parseInt(searchParams.get('step') || '1');

    // Initialize with default values to prevent "uncontrolled input" warnings
    const [formData, setFormData] = useState<Partial<Property>>({
        title: '',
        description: '',
        address: { text: '', lat: 0, lng: 0, pincode: '' },
        pricePerMonth: 0,
        advanceAmount: 0,
        features: { ...INITIAL_FEATURES },
        images: [],
        ownerId: currentUser?.uid
    });
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(!!id);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const loadedPropertyRef = useRef<string | null>(null);
    const loadingPropertyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!currentUser) {
            navigate('/login');
            return;
        }

        if (!verificationStatus) {
            toast.error('Complete verification before creating properties');
            navigate('/dashboard');
            return;
        }

        const initForm = async () => {
            if (id) {
                if (loadedPropertyRef.current === id || loadingPropertyRef.current === id) {
                    setFetching(false);
                    return;
                }
                try {
                    loadingPropertyRef.current = id;
                    setFetching(true);
                    const property = await propertyService.getPropertyById(id);
                    if (property && property.ownerId === currentUser.uid) {
                        setFormData(property);
                        loadedPropertyRef.current = id;
                    } else {
                        toast.error("Property not found or access denied");
                        navigate('/properties');
                    }
                } catch (error) {
                    console.error(error);
                    toast.error("Failed to load property details");
                } finally {
                    if (loadingPropertyRef.current === id) {
                        loadingPropertyRef.current = null;
                    }
                    setFetching(false);
                }
            } else {
                loadedPropertyRef.current = null;
                loadingPropertyRef.current = null;
                setFormData(INITIAL_PROPERTY_STATE(currentUser.uid));
            }
        };

        initForm();
    }, [currentUser, navigate, id, verificationStatus]);


    const handleChange = <K extends keyof Property>(field: K, value: Property[K]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const amountInputProps = {
        min: 0,
        step: '0.01',
        inputMode: 'decimal' as const,
        onWheel: preventNumberInputWheelChange,
        onKeyDown: preventNumberInputStepperKeys
    };

    const handleFeatureToggle = (key: string) => {
        setFormData(prev => ({
            ...prev,
            features: {
                ...prev.features!,
                [key]: !prev.features![key]
            }
        }));
    };

    const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({
            ...prev,
            address: { ...prev.address!, text: e.target.value }
        }));
    };

    // Helper function to remove undefined values (Firebase doesn't allow them)
    const removeUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
        const cleaned: Record<string, unknown> = {};
        Object.keys(obj).forEach(key => {
            if (obj[key] !== undefined) {
                cleaned[key] = obj[key];
            }
        });
        return cleaned;
    };

    const handleNextStep = async () => {
        if (!currentUser) return;

        // Handle next step

        // Validation Step 1
        if (currentStep === 1) {
            if (!formData.title || !formData.address?.text || !formData.pricePerMonth) {
                toast.error("Please fill in required fields (Title, Address, Price)");
                return;
            }
        }

        setLoading(true);
        try {
            const dataToSave = removeUndefined({
                ...(formData as Record<string, unknown>),
                ownerId: currentUser.uid
            });

            // Saving property data

            let targetId = id;

            if (targetId) {
                await propertyService.updateProperty(targetId, dataToSave);
            } else {
                const newProp = await propertyService.createProperty(currentUser.uid, dataToSave);
                targetId = newProp.propertyId;
                // Property created successfully
            }

            if (currentStep < 2) {
                // Determine if we are creating new (and redirecting to edit URL) or just moving step
                if (!id) {
                    navigate(`/properties/edit/${targetId}?step=${currentStep + 1}`, { replace: true });
                } else {
                    setSearchParams({ step: (currentStep + 1).toString() });
                }
                toast.success("Details saved! Let's set up an offer.");
            } else {
                // Final Step (Offers) -> Go to Dashboard
                // Final step completed, redirecting
                toast.success("Setup Complete! Redirecting to Dashboard...");
                navigate(`/properties/${targetId}`);
            }

        } catch (error: unknown) {
            const err = error as Error;
            console.error('[AddProperty] Error in handleNextStep:', err);
            toast.error(err.message || "Failed to create property.");
        } finally {
            setLoading(false);
        }
    };


    const inputClasses = "w-full h-[52px] md:h-[48px] px-4 rounded-2xl border-2 border-gray-200 bg-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all duration-300 text-gray-900 placeholder:text-gray-400 text-[15px] font-semibold";
    const labelClasses = "block text-[11px] font-black text-gray-700 uppercase tracking-[0.1em] mb-2.5 ml-1";
    const cardClasses = "bg-white rounded-[24px] md:rounded-[32px] shadow-[0_4px_24px_rgba(0,0,0,0.06)] border border-gray-100 p-5 md:p-8 space-y-6 hover:shadow-[0_12px_40px_rgba(0,0,0,0.10)] hover:-translate-y-1 transition-all duration-500";

    return (
        <div className="min-h-screen bg-gradient-to-br from-orange-50/60 via-white to-purple-50/40 pb-32 md:pb-8">
            {/* Header with Stepper */}
            <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200/40 md:border-none md:static px-4 py-4 md:pt-10 md:pb-8 transition-all">
                <div className="container mx-auto max-w-4xl px-2">
                    <div className="flex items-center gap-4 md:gap-5 mb-6 md:mb-8">
                        <button
                            onClick={() => setShowCancelConfirm(true)}
                            className="w-12 h-12 flex items-center justify-center bg-white rounded-2xl border border-gray-100 shadow-[0_4px_12px_rgba(0,0,0,0.05)] hover:bg-gray-50 hover:border-orange-100 hover:text-orange-600 hover:shadow-[0_8px_20px_rgba(249,115,22,0.1)] transition-all duration-300 group"
                        >
                            <FiArrowLeft size={22} className="text-gray-500 group-hover:-translate-x-1 transition-transform" />
                        </button>
                        <div className="min-w-0">
                            <h1 className="text-[1.75rem] leading-tight md:text-3xl font-black text-[#1a1c2e] tracking-tight">
                                {id ? 'Refine Property' : 'Add New Property'}
                            </h1>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded-md text-[10px] font-black uppercase tracking-wider">Step {currentStep} of {STEPS.length}</span>
                                <p className="text-xs leading-tight md:text-sm text-gray-400 font-bold">{STEPS[currentStep - 1]?.title}</p>
                            </div>
                        </div>
                    </div>

                    {/* Stepper UI */}
                    <div className="flex items-start justify-between relative mb-4 max-w-md mx-auto px-1 md:px-4 gap-3">
                        <div className="absolute left-6 right-6 md:left-8 md:right-8 top-[1rem] md:top-[1.15rem] h-[3px] bg-gray-100 -z-10 rounded-full">
                            <div
                                className="h-full bg-gradient-to-r from-[var(--rf-color-action)] to-[var(--rf-color-primary-green-dark)] transition-all duration-700 ease-out"
                                style={{ width: `${((currentStep - 1) / (STEPS.length - 1)) * 100}%` }}
                            />
                        </div>
                        {STEPS.map((s) => {
                            const isCompleted = s.number < currentStep;
                            const isCurrent = s.number === currentStep;
                            return (
                                <div key={s.number} className="flex flex-col items-center relative flex-1 min-w-0">
                                    <div className={`w-9 h-9 md:w-10 md:h-10 rounded-2xl flex items-center justify-center font-black text-sm transition-all duration-500 transform
                                        ${isCompleted ? 'bg-orange-500 text-white scale-90' : isCurrent ? 'bg-white text-orange-600 shadow-[0_10px_25px_rgba(249,115,22,0.16)] border-2 border-orange-500 scale-105 md:scale-110' : 'bg-white text-gray-300 border-2 border-gray-100'}
                                    `}>
                                        {isCompleted ? <FiCheck size={18} strokeWidth={3} /> : s.number}
                                    </div>
                                    <span className={`mt-2 w-full text-center text-[9px] leading-[1.15] md:text-[10px] md:leading-tight font-black uppercase tracking-[0.08em] md:tracking-widest transition-colors duration-500 ${isCurrent ? 'text-orange-600' : 'text-gray-300'}`}>
                                        {s.title}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {fetching ? (
                <div className="container mx-auto px-4 max-w-4xl py-20 text-center">
                    <div className="inline-block w-12 h-12 border-4 border-primary-100 border-t-primary-600 rounded-full animate-spin mb-4"></div>
                    <p className="text-gray-500 font-medium">Loading...</p>
                </div>
            ) : (
                <div className="container mx-auto px-4 max-w-4xl space-y-6 pb-12">

                    {/* STEP 1: Property Details */}
                    {currentStep === 1 && (
                        <>
                            {/* 1. Basic Info */}
                            <section className={cardClasses}>
                                <div className="flex items-center gap-4 border-b border-gray-100/50 pb-5 mb-2">
                                    <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-600 shadow-sm border border-orange-100/50">
                                        <FiHome size={24} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black text-gray-900">Basic Information</h2>
                                        <p className="text-xs text-gray-600 font-semibold uppercase tracking-widest mt-0.5">Core property details</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
                                    <div className="md:col-span-2">
                                        <p className={labelClasses}>Property Category</p>
                                        <div className="flex flex-wrap gap-3 mt-1">
                                            {PROPERTY_CATEGORIES.map((cat) => {
                                                const Icon = cat.icon;
                                                return (
                                                <button
                                                    key={cat.id}
                                                    type="button"
                                                    aria-label={cat.label}
                                                    onClick={() => {
                                                        const currentTags = formData.tags || [];
                                                        const otherCats = ['Boys', 'Girls', 'Hostel', 'Co-living'].filter(c => c !== cat.id);
                                                        const filteredTags = currentTags.filter(t => !otherCats.includes(t));
                                                        if (!filteredTags.includes(cat.id)) {
                                                            filteredTags.push(cat.id);
                                                        }
                                                        handleChange('tags', filteredTags);
                                                    }}
                                                    className={`group relative flex items-center gap-3 px-5 py-3.5 rounded-[20px] border-2 transition-all duration-300 font-bold text-sm active:scale-95 ${formData.tags?.includes(cat.id)
                                                        ? 'bg-orange-600 border-orange-600 text-white shadow-[0_10px_24px_rgba(249,115,22,0.30)] scale-[1.03]'
                                                        : 'bg-white border-gray-200 text-gray-800 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 hover:scale-[1.02] hover:shadow-[0_4px_12px_rgba(249,115,22,0.15)]'
                                                        }`}
                                                >
                                                    <span className={`text-xl transition-transform duration-300 ${formData.tags?.includes(cat.id) ? 'scale-125' : 'group-hover:scale-110'}`}>
                                                        <Icon />
                                                    </span>
                                                    {cat.label}
                                                </button>
                                                );
                                            })}
                                        </div>
                                        <p className="text-[11px] text-gray-600 mt-3 font-semibold ml-1">🎯 Target audience helps us optimize your listing visibility.</p>
                                    </div>
                                    <div className="md:col-span-2">
                                        <p className={labelClasses}>Property Tier (Optional)</p>
                                        <div className="flex flex-wrap gap-3 mt-1">
                                            {PROPERTY_TIERS.map((tier) => {
                                                const Icon = tier.icon;
                                                return (
                                                <button
                                                    key={tier.id}
                                                    type="button"
                                                    aria-label={tier.label}
                                                    onClick={() => {
                                                        const currentTags = formData.tags || [];
                                                        const otherTiers = ['Premium', 'Luxury'].filter(t => t !== tier.id);
                                                        const filteredTags = currentTags.filter(t => !otherTiers.includes(t));
                                                        if (!filteredTags.includes(tier.id)) {
                                                            filteredTags.push(tier.id);
                                                        }
                                                        handleChange('tags', filteredTags);
                                                    }}
                                                    className={`group relative flex items-center gap-3 px-5 py-3.5 rounded-[20px] border-2 transition-all duration-300 font-bold text-sm active:scale-95 ${formData.tags?.includes(tier.id)
                                                        ? 'bg-amber-500 border-amber-500 text-white shadow-[0_10px_24px_rgba(245,158,11,0.35)] scale-[1.03]'
                                                        : 'bg-white border-gray-200 text-gray-800 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700 hover:scale-[1.02] hover:shadow-[0_4px_12px_rgba(245,158,11,0.15)]'
                                                        }`}
                                                >
                                                    <span className={`text-xl transition-transform duration-300 ${formData.tags?.includes(tier.id) ? 'scale-125' : 'group-hover:scale-110'}`}>
                                                        <Icon />
                                                    </span>
                                                    {tier.label}
                                                </button>
                                                );
                                            })}
                                        </div>
                                        <p className="text-[11px] text-gray-600 mt-3 font-semibold ml-1">⭐ Premium tiers attract higher-value bookings and better tenants.</p>
                                    </div>
                                    <div className="md:col-span-2">
                                        <label htmlFor="propertyTitle" className={labelClasses}>Property Title</label>
                                        <input
                                            id="propertyTitle"
                                            name="title"
                                            type="text"
                                            autoComplete="off"
                                            className={inputClasses}
                                            placeholder="e.g. Modern Student Living"
                                            value={formData.title}
                                            onChange={(e) => handleChange('title', e.target.value)}
                                        />
                                    </div>
                                    <div className="md:col-span-2">
                                        <label htmlFor="propertyDescription" className={labelClasses}>Description</label>
                                        <textarea
                                            id="propertyDescription"
                                            name="description"
                                            autoComplete="off"
                                            rows={4}
                                            className={inputClasses}
                                            placeholder="Tell potential tenants what makes your property special..."
                                            value={formData.description}
                                            onChange={(e) => handleChange('description', e.target.value)}
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* 2. Location & Pricing */}
                            <section className={cardClasses}>
                                <div className="flex items-center gap-4 border-b border-gray-100/50 pb-5 mb-2">
                                    <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shadow-sm border border-amber-100/50">
                                        <FiMapPin size={24} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black text-gray-900">Location & Pricing</h2>
                                        <p className="text-xs text-gray-600 font-semibold uppercase tracking-widest mt-0.5">Where and how much</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                                    <div className="md:col-span-2">
                                        <label htmlFor="propertyAddress" className={labelClasses}>Full Address</label>
                                        <div className="group relative">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-gray-100/50 flex items-center justify-center text-gray-400 group-focus-within:bg-orange-50 group-focus-within:text-orange-500 transition-all duration-300">
                                                <FiMapPin size={18} />
                                            </div>
                                            <input
                                                id="propertyAddress"
                                                name="address"
                                                type="text"
                                                autoComplete="street-address"
                                                className={`${inputClasses} pl-14`}
                                                placeholder="Street address, Area, City"
                                                value={formData.address?.text}
                                                onChange={handleAddressChange}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label htmlFor="propertyPincode" className={labelClasses}>Pincode</label>
                                        <input
                                            id="propertyPincode"
                                            name="pincode"
                                            type="text"
                                            autoComplete="postal-code"
                                            maxLength={6}
                                            className={inputClasses}
                                            placeholder="e.g. 560001"
                                            value={formData.address?.pincode || ''}
                                            onChange={(e) => {
                                                const value = e.target.value.replace(/\D/g, ''); // Only digits
                                                setFormData(prev => ({
                                                    ...prev,
                                                    address: { ...prev.address!, pincode: value }
                                                }));
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="propertyPricePerMonth" className={labelClasses}>Starting Price (Monthly)</label>
                                        <div className="group relative">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-gray-100/50 flex items-center justify-center text-gray-400 group-focus-within:bg-orange-50 group-focus-within:text-orange-500 transition-all duration-300">
                                                <span className="font-black text-sm">{RUPEE_SYMBOL}</span>
                                            </div>
                                            <input
                                                id="propertyPricePerMonth"
                                                name="pricePerMonth"
                                                type="number"
                                                autoComplete="off"
                                                {...amountInputProps}
                                                className={`${inputClasses} pl-14`}
                                                placeholder="5000"
                                                value={formData.pricePerMonth || ''}
                                                onFocus={(e) => e.target.select()}
                                                onChange={(e) => handleChange('pricePerMonth', sanitizeAmountValue(e.target.value))}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label htmlFor="propertyAdvanceAmount" className={labelClasses}>Advance / Deposit</label>
                                        <div className="group relative">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-gray-100/50 flex items-center justify-center text-gray-400 group-focus-within:bg-orange-50 group-focus-within:text-orange-500 transition-all duration-300">
                                                <span className="font-black text-sm">{RUPEE_SYMBOL}</span>
                                            </div>
                                            <input
                                                id="propertyAdvanceAmount"
                                                name="advanceAmount"
                                                type="number"
                                                autoComplete="off"
                                                {...amountInputProps}
                                                className={`${inputClasses} pl-14`}
                                                placeholder="10000"
                                                value={formData.advanceAmount || ''}
                                                onFocus={(e) => e.target.select()}
                                                onChange={(e) => handleChange('advanceAmount', sanitizeAmountValue(e.target.value))}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* 3. Amenities */}
                            <section className={cardClasses}>
                                <div className="flex items-center gap-4 border-b border-gray-100/50 pb-5 mb-2">
                                    <div className="w-12 h-12 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-600 shadow-sm border border-purple-100/50">
                                        <FiWifi size={24} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black text-gray-900">Amenities</h2>
                                        <p className="text-xs text-gray-600 font-semibold uppercase tracking-widest mt-0.5">Facilities offered</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
                                    {Object.entries(formData.features || {}).map(([key, value]) => {
                                        const cfg = FEATURE_CONFIG[key];
                                        const icon = cfg?.icon ?? <FiCheck size={20} />;
                                        const label = cfg?.label ?? key.replace(/([A-Z])/g, ' $1').trim();
                                        return (
                                        <button
                                            key={key}
                                            onClick={() => handleFeatureToggle(key)}
                                            className={`group relative flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all duration-300 transform active:scale-95 ${
                                                value
                                                ? `${cfg?.activeBg ?? 'bg-orange-500 border-orange-500'} ${cfg?.activeColor ?? 'text-white'} ${cfg?.activeShadow ?? ''} scale-[1.04]`
                                                : `bg-white border-gray-200 text-gray-700 ${cfg?.hoverColor ?? 'hover:text-orange-600'} ${cfg?.hoverBg ?? 'hover:bg-orange-50 hover:border-orange-200'} hover:scale-[1.03] hover:shadow-md`
                                                }`}
                                        >
                                            <span className={`transition-transform duration-300 ${value ? 'scale-110' : 'group-hover:scale-110'}`}>
                                                {icon}
                                            </span>
                                            <span className="text-[12px] font-bold text-center leading-tight">
                                                {label}
                                            </span>
                                            {value && <FiCheck size={13} strokeWidth={3} className="opacity-80" />}
                                        </button>
                                        );
                                    })}
                                </div>
                                {/* Custom Amenity Input */}
                                <div className="mt-6 pt-6 border-t border-gray-100/50">
                                    <label htmlFor="customAmenity" className={labelClasses}>Add Custom Amenity</label>
                                    <div className="flex gap-3">
                                        <div className="flex-1 group relative">
                                            <input
                                                type="text"
                                                id="customAmenity"
                                                name="customAmenity"
                                                autoComplete="off"
                                                className={inputClasses}
                                                placeholder="e.g. Swimming Pool, Gym, Garden"
                                                onKeyPress={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        const input = e.currentTarget;
                                                        const value = input.value.trim();
                                                        if (value) {
                                                            const camelCaseKey = value.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, chr) => chr.toUpperCase()).replace(/[^a-z0-9]/gi, '');
                                                            setFormData(prev => ({
                                                                ...prev,
                                                                features: { ...prev.features!, [camelCaseKey]: true }
                                                            }));
                                                            input.value = '';
                                                            toast.success(`Broadcasting "${value}"`);
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const input = document.getElementById('customAmenity') as HTMLInputElement;
                                                const value = input?.value.trim();
                                                if (value) {
                                                    const camelCaseKey = value.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, chr) => chr.toUpperCase()).replace(/[^a-z0-9]/gi, '');
                                                    setFormData(prev => ({
                                                        ...prev,
                                                        features: { ...prev.features!, [camelCaseKey]: true }
                                                    }));
                                                    input.value = '';
                                                    toast.success(`Broadcasting "${value}"`);
                                                }
                                            }}
                                            className="px-8 flex items-center justify-center bg-[var(--rf-color-action)] text-white rounded-2xl font-black text-sm hover:bg-[var(--rf-color-action-hover)] transition-all duration-300 shadow-[0_4px_12px_rgba(249,115,22,0.22)] hover:shadow-[0_8px_20px_rgba(249,115,22,0.3)] active:scale-95"
                                        >
                                            Add
                                        </button>
                                    </div>
                                    <p className="text-[11px] text-gray-600 mt-3 font-semibold ml-1">✨ Unique features make your listing stand out from the crowd.</p>
                                </div>
                            </section>

                            {/* 4. Property Images */}
                            <section className={cardClasses}>
                                <div className="flex items-center gap-4 border-b border-gray-100/50 pb-5 mb-2">
                                    <div className="w-12 h-12 rounded-2xl bg-pink-50 flex items-center justify-center text-pink-600 shadow-sm border border-pink-100/50">
                                        <FiImage size={24} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-black text-gray-900">Gallery</h2>
                                        <p className="text-xs text-gray-600 font-semibold uppercase tracking-widest mt-0.5">Visual representation</p>
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <ImageUploader
                                        propertyId={formData.propertyId || ''}
                                        images={formData.images || []}
                                        onImagesChange={(imgs) => handleChange('images', imgs)}
                                        onUpload={(files) => propertyService.uploadPropertyImages(formData.propertyId || '', files)}
                                        maxImages={1}
                                    />
                                </div>
                            </section>
                        </>
                    )}

                    {/* Step 2: Offers */}
                    {currentStep === 2 && (
                        <section className={cardClasses}>
                            <div className="flex items-center gap-4 border-b border-gray-100/50 pb-5 mb-2">
                                <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-orange-600 shadow-sm border border-orange-100/50">
                                    <FiTag size={24} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-gray-900">Promotional Offer</h2>
                                    <p className="text-xs text-gray-600 font-semibold uppercase tracking-widest mt-0.5">Boost your conversions</p>
                                </div>
                            </div>
                            {/* ... (rest of the Offers UI remains same) */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
                                <div className="space-y-3">
                                    <div>
                                        <label htmlFor="autoOfferCode" className={labelClasses}>Coupon Code</label>
                                        <input
                                            id="autoOfferCode"
                                            name="autoOfferCode"
                                            type="text"
                                            autoComplete="off"
                                            placeholder="e.g. WELCOME10"
                                            className={inputClasses}
                                            value={formData.autoOffer?.code || ''}
                                            onChange={(e) => {
                                                const offer = formData.autoOffer || {
                                                    offerId: 'auto_' + (id || formData.propertyId),
                                                    code: '', type: 'flat', value: 0, active: true,
                                                    appliesTo: ['all'], maxDiscount: 500, minBookingAmount: 1,
                                                    expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), usedCount: 0, usageLimit: 10000
                                                };
                                                handleChange('autoOffer', { ...offer, code: e.target.value.toUpperCase() });
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <p className={labelClasses}>Discount Type</p>
                                        <div className="flex gap-2">
                                            {['flat', 'percentage'].map((type) => (
                                                <button
                                                    key={type}
                                                    type="button"
                                                    onClick={() => {
                                                        const offer = formData.autoOffer || {
                                                            offerId: 'auto_' + (id || formData.propertyId),
                                                            code: '', type: 'flat', value: 0, active: true,
                                                            appliesTo: ['all'], maxDiscount: 500, minBookingAmount: 1,
                                                            expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), usedCount: 0, usageLimit: 10000
                                                        };
                                                        handleChange('autoOffer', { ...offer, type: type as 'flat' | 'percentage' });
                                                    }}
                                                    className={`flex-1 py-2.5 rounded-xl border-2 font-bold text-sm transition-all active:scale-95 ${formData.autoOffer?.type === type
                                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                                                        : 'bg-white border-gray-200 text-gray-800 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700'}`}
                                                >
                                                    {type === 'flat' ? `Flat ${RUPEE_SYMBOL}` : 'Percentage %'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="autoOfferValue" className={labelClasses}>Discount Value</label>
                                        <div className="group relative">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-gray-100/50 flex items-center justify-center text-gray-400 group-focus-within:bg-indigo-50 group-focus-within:text-indigo-500 transition-all duration-300">
                                                <span className="font-black text-sm">
                                                    {formData.autoOffer?.type === 'percentage' ? '%' : RUPEE_SYMBOL}
                                                </span>
                                            </div>
                                            <input
                                                id="autoOfferValue"
                                                name="autoOfferValue"
                                                type="number"
                                                autoComplete="off"
                                                {...amountInputProps}
                                                placeholder="0"
                                                className={`${inputClasses} pl-14`}
                                                value={formData.autoOffer?.value || ''}
                                                onFocus={(e) => e.target.select()}
                                                onChange={(e) => {
                                                    const offer = formData.autoOffer || {
                                                        offerId: 'auto_' + (id || formData.propertyId),
                                                        code: '', type: 'flat', value: 0, active: true,
                                                        appliesTo: ['all'], maxDiscount: 500, minBookingAmount: 1,
                                                        expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), usedCount: 0, usageLimit: 10000
                                                    };
                                                    handleChange('autoOffer', { ...offer, value: sanitizeAmountValue(e.target.value) });
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-indigo-50/50 rounded-[30px] p-8 flex flex-col justify-center border-2 border-indigo-100/50 relative overflow-hidden group">
                                    <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-500/10 rounded-full blur-2xl group-hover:bg-indigo-500/20 transition-all duration-700" />

                                    <h4 className="font-black text-[#1a1c2e] mb-4 text-center uppercase tracking-[0.15em] text-xs opacity-60">Offer Preview</h4>

                                    <div className="bg-white p-6 rounded-[24px] shadow-[0_12px_30px_rgba(79,70,229,0.12)] border border-indigo-50 flex items-center justify-between">
                                        <div>
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 opacity-80">Coupon Code</p>
                                            <p className="font-black text-indigo-600 text-2xl leading-none tracking-tight">{formData.autoOffer?.code || 'WELCOME'}</p>
                                        </div>
                                        <div className="h-10 w-px bg-gray-100" />
                                        <div className="text-right">
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 opacity-80">Benefit</p>
                                            <p className="font-black text-gray-900 text-2xl leading-none uppercase">
                                                {formData.autoOffer?.type === 'percentage' ? '' : RUPEE_SYMBOL}
                                                {formData.autoOffer?.value || 0}
                                                {formData.autoOffer?.type === 'percentage' ? '%' : ''} <span className="text-indigo-600">OFF</span>
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 justify-center mt-5 text-[11px] text-gray-400 font-bold uppercase tracking-wider italic">
                                        <FiCheck className="text-indigo-500" />
                                        Auto-suggested to customers
                                    </div>
                                </div>
                            </div>
                        </section>
                    )}

                </div>
            )}

            {/* Footer Actions */}
            {!fetching && (
                <div
                    className="fixed bottom-0 left-0 right-0 p-5 bg-white/60 backdrop-blur-2xl border-t border-white shadow-[0_-20px_50px_rgba(0,0,0,0.08)] md:relative md:bg-transparent md:border-none md:shadow-none md:p-0 md:mt-10 z-40 transition-all duration-500"
                    style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
                >
                    <div className="container mx-auto max-w-4xl flex flex-col md:flex-row justify-end items-center gap-4 md:gap-6">
                        <button
                            onClick={() => setShowCancelConfirm(true)}
                            className="hidden md:block px-8 py-4 text-gray-400 font-black uppercase tracking-widest text-xs hover:text-[#1a1c2e] hover:bg-white hover:shadow-sm rounded-2xl transition-all duration-300"
                            disabled={loading}
                        >
                            Discard Changes
                        </button>

                        <div className="flex w-full md:w-auto gap-4">
                            {currentStep > 1 && (
                                <button
                                    onClick={() => setSearchParams({ step: (currentStep - 1).toString() })}
                                    className="flex-1 md:flex-none px-8 py-4 bg-white border-2 border-gray-100 text-gray-600 rounded-[22px] font-black uppercase tracking-widest text-xs shadow-sm hover:bg-gray-50 hover:border-indigo-100 hover:text-indigo-600 transition-all duration-300"
                                    disabled={loading}
                                >
                                    Back
                                </button>
                            )}

                            <button
                                onClick={handleNextStep}
                                disabled={loading}
                                className="flex-[2] md:flex-none px-12 py-4 bg-gradient-to-r from-[#1a1c2e] to-[#2a2d45] text-white rounded-[22px] font-black uppercase tracking-widest text-xs shadow-[0_15px_30px_rgba(26,28,46,0.25)] flex justify-center items-center gap-3 hover:scale-[1.03] active:scale-95 transition-all duration-300 group"
                            >
                                {loading ? (
                                    <span className="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin"></span>
                                ) : (
                                    <>
                                        {currentStep < 2 ? 'Save & Continue' : 'Unleash Property'}
                                        <FiChevronRight className="group-hover:translate-x-1 transition-transform" />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmationModal
                isOpen={showCancelConfirm}
                onClose={() => setShowCancelConfirm(false)}
                onConfirm={() => navigate('/properties')}
                title="Discard Changes?"
                message="You have unsaved changes. Are you sure you want to leave this page?"
                confirmText="Discard & Leave"
                variant="warning"
            />
        </div>
    );
};

export default AddProperty;


