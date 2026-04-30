import React from 'react';

const BookingCardSkeleton: React.FC = () => {
    const dots = Array.from({ length: 12 });

    return (
        <div className="flex min-h-[280px] items-center justify-center overflow-hidden">
            <div className="rfm-circle-loader-scene rfm-circle-loader-scene--compact">
                <div className="rfm-circle-loader-glow rfm-circle-loader-glow--blue" />
                <div className="rfm-circle-loader-glow rfm-circle-loader-glow--orange" />
                <div className="rfm-circle-loader-core" />
                <div className="rfm-circle-loader-wheel rfm-circle-loader-wheel--compact" aria-hidden="true">
                    {dots.map((_, index) => (
                        <span
                            key={index}
                            className={`rfm-circle-loader-dot ${index % 3 === 0 ? 'rfm-circle-loader-dot--orange' : ''}`}
                            style={{ ['--i' as const]: index } as React.CSSProperties}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

export default BookingCardSkeleton;
