import React, { memo } from 'react';

export const PropertyCardSkeleton: React.FC = memo(() => {
    const dots = Array.from({ length: 12 });

    return (
        <div className="flex min-h-[270px] w-full items-center justify-center overflow-hidden lg:max-w-[304px]">
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
});

PropertyCardSkeleton.displayName = 'PropertyCardSkeleton';
