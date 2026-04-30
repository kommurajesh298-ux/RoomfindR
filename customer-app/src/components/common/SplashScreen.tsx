import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SplashScreen as CapacitorSplashScreen } from '@capacitor/splash-screen';

export const SplashScreen: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
    const [isVisible, setIsVisible] = useState(true);
    const dots = Array.from({ length: 12 });

    useEffect(() => {
        const runAnimation = async () => {
            // Wait a moment to ensure React has rendered (prevent white flash gap)
            // Then hide the native splash screen
            try {
                // Keep native splash visible for a tiny bit to ensure we are ready
                await CapacitorSplashScreen.hide();
            } catch (e) {
                console.warn('Splash Screen plugin not available', e);
            }

            // The JS animation runs now
            setTimeout(() => {
                setIsVisible(false);
                setTimeout(onComplete, 500); // Wait for exit animation
            }, 2000); // Hold for 2 seconds (Logo Hold)
        };

        runAnimation();
    }, [onComplete]);

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    className="fixed inset-0 z-[99999] flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_14%_12%,rgba(37,99,235,0.16),transparent_28%),radial-gradient(circle_at_84%_16%,rgba(249,115,22,0.14),transparent_24%),linear-gradient(180deg,#ffffff_0%,#eef5ff_100%)] backdrop-blur-[16px]"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: "easeInOut" }}
                >
                    <motion.div
                        initial={{ scale: 0.85, opacity: 0 }}
                        animate={{
                            scale: [0.85, 1.05, 1],
                            opacity: 1
                        }}
                        transition={{
                            duration: 0.8,
                            times: [0, 0.6, 1],
                            ease: "easeOut"
                        }}
                        className="rfm-screen-enter flex flex-col items-center justify-center p-4"
                    >
                        <div className="rfm-circle-loader-scene">
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
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
