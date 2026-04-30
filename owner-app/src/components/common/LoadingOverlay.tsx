import React from 'react';
// import LoadingSpinner from './LoadingSpinner';

interface LoadingOverlayProps {
    message?: string;
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ message = 'Loading...' }) => {
    const dots = Array.from({ length: 12 });

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_14%_12%,rgba(37,99,235,0.16),transparent_28%),radial-gradient(circle_at_84%_16%,rgba(249,115,22,0.14),transparent_24%),linear-gradient(180deg,#ffffff_0%,#eef5ff_100%)] backdrop-blur-[16px] transition-all duration-300">
            <span className="sr-only">{message}</span>
            <div className="rfm-circle-loader-scene rfm-screen-enter">
                <div className="rfm-circle-loader-glow rfm-circle-loader-glow--blue" />
                <div className="rfm-circle-loader-glow rfm-circle-loader-glow--orange" />
                <div className="rfm-circle-loader-core" />
                <div className="rfm-circle-loader-wheel" aria-hidden="true">
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

export default LoadingOverlay;
