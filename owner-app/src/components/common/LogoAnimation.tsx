import React, { useState } from 'react';
import Lottie from 'lottie-react';

interface LogoAnimationProps {
    animationData?: object;
    staticLogo?: string;
    className?: string;
}

const LogoAnimation: React.FC<LogoAnimationProps> = ({
    animationData,
    staticLogo = `${import.meta.env.BASE_URL}assets/images/logos/logo-inline.png`,
    className = 'h-12 w-auto'
}) => {
    // Use lazy initialization to check sessionStorage only once
    const [hasPlayed, setHasPlayed] = useState(() => {
        const played = sessionStorage.getItem('logoAnimationPlayed');
        return played === 'true';
    });

    const handleAnimationComplete = () => {
        setHasPlayed(true);
        sessionStorage.setItem('logoAnimationPlayed', 'true');
    };

    // If animation has played or no animation data, show static logo
    if (hasPlayed || !animationData) {
        return (
            <img
                src={staticLogo}
                alt="RoomFindR Logo"
                className={className}
            />
        );
    }

    // Show Lottie animation
    return (
        <Lottie
            animationData={animationData}
            loop={false}
            autoplay={true}
            onComplete={handleAnimationComplete}
            className={className}
        />
    );
};

export default LogoAnimation;
