import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface OnboardingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const slides = [
    {
        title: "Welcome to RoomFindR!",
        description: "Search PGs, hostels, and co-living spaces with ease. Your perfect stay is just a click away.",
        image: "https://placehold.co/600x400/2070E0/F0F0F0?text=Welcome+to+RoomFindR"
    },
    {
        title: "Easy Booking",
        description: "Book with just a small advance payment and pay the rest monthly. No hidden charges.",
        image: "https://placehold.co/600x400/1060D0/F0F0F0?text=Easy+Booking"
    },
    {
        title: "Stay Connected",
        description: "Chat directly with owners, get instant updates on your booking status, and more.",
        image: "https://placehold.co/600x400/F0D030/102340?text=Stay+Connected"
    },
    {
        title: "Track Everything",
        description: "Manage your bookings, payments, and notifications from your personalized dashboard.",
        image: "https://placehold.co/600x400/F05040/F0F0F0?text=Track+Everything"
    }
];

const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
    const [currentSlide, setCurrentSlide] = useState(0);
    const navigate = useNavigate();

    if (!isOpen) return null;

    const handleNext = () => {
        if (currentSlide < slides.length - 1) {
            setCurrentSlide(prev => prev + 1);
        } else {
            handleFinish();
        }
    };

    const handleFinish = () => {
        localStorage.setItem('onboarding_completed', 'true');
        onClose();
        navigate('/');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl overflow-hidden shadow-2xl max-w-md w-full animate-in fade-in zoom-in duration-300">
                <div className="relative h-64 overflow-hidden">
                    <img
                        src={slides[currentSlide].image}
                        alt={slides[currentSlide].title}
                        className="w-full h-full object-cover"
                    />
                </div>

                <div className="p-8 text-center">
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">
                        {slides[currentSlide].title}
                    </h2>
                    <p className="text-gray-600 mb-8 h-18">
                        {slides[currentSlide].description}
                    </p>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={handleNext}
                            className="w-full rounded-full bg-gradient-to-r from-[#1060D0] to-[#4090F0] py-3.5 font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg active:scale-95"
                        >
                            {currentSlide === slides.length - 1 ? 'Get Started' : 'Next'}
                        </button>

                        {currentSlide < slides.length - 1 && (
                            <button
                                onClick={handleFinish}
                                className="w-full py-2 text-gray-400 font-medium hover:text-gray-600 transition-colors"
                            >
                                Skip
                            </button>
                        )}
                    </div>

                    <div className="flex justify-center gap-2 mt-8">
                        {slides.map((_, i) => (
                            <div
                                key={i}
                                className={`h-2 rounded-full transition-all duration-300 ${i === currentSlide ? 'w-8 bg-gradient-to-r from-[#1060D0] to-[#4090F0] shadow-md' : 'w-2 bg-gray-200'
                                    }`}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OnboardingModal;
