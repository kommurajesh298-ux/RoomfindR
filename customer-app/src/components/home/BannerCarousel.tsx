import React, { memo, useEffect, useState, type CSSProperties } from 'react';

interface BannerCarouselProps {
    onBannerClick?: (_offer: { title: string; subtitle: string }) => void;
}

type BannerSlide = {
    id: string;
    variant: 'minimal' | 'badge' | 'gradient' | 'stacked';
    lines: string[];
    anchor: 'left-center' | 'top-left' | 'left-bottom';
    imageSrc: string;
};

const BANNER_THEME = {
    primary: '13 37 108',
    secondary: '82 78 196',
    tertiary: '108 204 255',
    warm: '255 191 114',
    glow: '120 214 255',
    text: '234 242 255',
};

const BANNER_SLIDES: BannerSlide[] = [
    {
        id: 'speed',
        variant: 'minimal',
        lines: ['Move in', 'faster'],
        anchor: 'left-center',
        imageSrc: `${import.meta.env.BASE_URL}assets/images/banners/banner4.png`,
    },
    {
        id: 'trust',
        variant: 'badge',
        lines: ['Find Your', 'Perfect', 'PG'],
        anchor: 'left-center',
        imageSrc: `${import.meta.env.BASE_URL}assets/images/banners/banner1.png`,
    },
    {
        id: 'comfort',
        variant: 'gradient',
        lines: ['Best PGs in', 'Bengaluru'],
        anchor: 'top-left',
        imageSrc: `${import.meta.env.BASE_URL}assets/images/banners/banner2.png`,
    },
    {
        id: 'discovery',
        variant: 'stacked',
        lines: ['Student', 'Friendly', 'PG Rooms'],
        anchor: 'left-center',
        imageSrc: `${import.meta.env.BASE_URL}assets/images/banners/banner3.png`,
    },
];

const getBannerStyle = (): CSSProperties =>
    ({
        '--rfm-banner-primary-rgb': BANNER_THEME.primary,
        '--rfm-banner-secondary-rgb': BANNER_THEME.secondary,
        '--rfm-banner-tertiary-rgb': BANNER_THEME.tertiary,
        '--rfm-banner-warm-rgb': BANNER_THEME.warm,
        '--rfm-banner-glow-rgb': BANNER_THEME.glow,
        '--rfm-banner-text-rgb': BANNER_THEME.text,
    }) as CSSProperties;

export const BannerCarousel: React.FC<BannerCarouselProps> = memo(({ onBannerClick }) => {
    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
        const interval = window.setInterval(() => {
            setActiveIndex((prev) => (prev + 1) % BANNER_SLIDES.length);
        }, 3200);

        return () => window.clearInterval(interval);
    }, []);

    const activeSlide = BANNER_SLIDES[activeIndex];
    const slideTitle = activeSlide.lines.join(' ');

    const renderBannerHeading = (slide: BannerSlide) => {
        if (slide.variant === 'badge') {
            return (
                <div className="rfm-banner-promo">
                    <p className="rfm-banner-promo-kicker">{slide.lines[0]}</p>
                    <div className="rfm-banner-promo-badge">
                        <span className="rfm-banner-promo-main">{slide.lines[1]}</span>
                        <span className="rfm-banner-promo-highlight">{slide.lines[2]}</span>
                        <span className="rfm-banner-promo-sparkle rfm-banner-promo-sparkle--one" aria-hidden="true" />
                        <span className="rfm-banner-promo-sparkle rfm-banner-promo-sparkle--two" aria-hidden="true" />
                    </div>
                    <span className="rfm-banner-promo-swoosh" aria-hidden="true" />
                </div>
            );
        }

        if (slide.variant === 'stacked') {
            return (
                <div className="rfm-banner-stack">
                    <span className="rfm-banner-stack-chip rfm-banner-stack-chip--top">
                        <span className="rfm-banner-stack-text rfm-banner-stack-text--top">{slide.lines[0]}</span>
                    </span>
                    <span className="rfm-banner-stack-chip rfm-banner-stack-chip--middle">
                        <span className="rfm-banner-stack-text rfm-banner-stack-text--middle">{slide.lines[1]}</span>
                    </span>
                    <span className="rfm-banner-stack-chip rfm-banner-stack-chip--bottom">
                        <span className="rfm-banner-stack-text rfm-banner-stack-text--bottom">{slide.lines[2]}</span>
                    </span>
                    <span className="rfm-banner-stack-sparkle rfm-banner-stack-sparkle--one" aria-hidden="true" />
                    <span className="rfm-banner-stack-sparkle rfm-banner-stack-sparkle--two" aria-hidden="true" />
                </div>
            );
        }

        if (slide.variant === 'gradient') {
            return (
                <div className="rfm-banner-promo rfm-banner-promo--city">
                    <p className="rfm-banner-promo-kicker rfm-banner-promo-kicker--city">{slide.lines[0]}</p>
                    <div className="rfm-banner-promo-badge rfm-banner-promo-badge--city">
                        <span className="rfm-banner-promo-city-word">{slide.lines[1]}</span>
                        <span className="rfm-banner-promo-sparkle rfm-banner-promo-sparkle--one" aria-hidden="true" />
                        <span className="rfm-banner-promo-sparkle rfm-banner-promo-sparkle--two" aria-hidden="true" />
                    </div>
                    <span className="rfm-banner-promo-swoosh rfm-banner-promo-swoosh--city" aria-hidden="true" />
                </div>
            );
        }

        return (
            <p className={`rfm-banner-title rfm-banner-title--${slide.id}`}>
                <span className="rfm-banner-title-line rfm-banner-title-line--top">{slide.lines[0]}</span>
                <span className="rfm-banner-title-line rfm-banner-title-line--bottom">{slide.lines[1]}</span>
            </p>
        );
    };

    return (
        <div
            className={[
                'rfm-banner-surface',
                'rfm-banner-premium',
                'rfm-banner-animate',
                `rfm-banner-surface--${activeSlide.id}`,
                'relative w-full overflow-hidden',
            ].join(' ')}
            style={getBannerStyle()}
            role="button"
            tabIndex={0}
            aria-label={slideTitle}
            onClick={() =>
                onBannerClick?.({
                    title: slideTitle,
                    subtitle: '',
                })
            }
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onBannerClick?.({
                        title: slideTitle,
                        subtitle: '',
                    });
                }
            }}
        >
            <div className={`rfm-banner-backdrop rfm-banner-backdrop--${activeSlide.id}`} aria-hidden="true">
                <span className="rfm-banner-orb rfm-banner-orb--warm" />
                <span className="rfm-banner-orb rfm-banner-orb--cool" />
                <span className="rfm-banner-orb rfm-banner-orb--glass" />
                {Array.from({ length: 5 }, (_, index) => (
                    <span
                        key={`particle-${index + 1}`}
                        className={`rfm-banner-particle rfm-banner-particle--${index + 1} rfm-banner-particle--${activeSlide.id}-${index + 1}`}
                    />
                ))}
            </div>

            <div key={activeSlide.id} className={`rfm-banner-content rfm-banner-content--${activeSlide.id}`}>
                <div
                    className={[
                        'rfm-banner-copy',
                        `rfm-banner-copy--${activeSlide.anchor}`,
                        `rfm-banner-copy--${activeSlide.id}`,
                    ].join(' ')}
                >
                    <div className={`rfm-banner-copy-block rfm-banner-copy-block--${activeSlide.id}`}>
                        {renderBannerHeading(activeSlide)}
                    </div>
                </div>

                <div className={`rfm-banner-image-wrap rfm-banner-image-wrap--${activeSlide.id}`} aria-hidden="true">
                    <div className="rfm-banner-room">
                        <img
                            className={`rfm-banner-room-image rfm-banner-room-image--${activeSlide.id}`}
                            src={activeSlide.imageSrc}
                            alt=""
                            loading="eager"
                            decoding="async"
                            draggable={false}
                        />
                    </div>
                </div>
            </div>

            <div className="rfm-banner-indicators" aria-hidden="true">
                {BANNER_SLIDES.map((slide, index) => (
                    <span
                        key={slide.id}
                        className={`rfm-banner-indicator${index === activeIndex ? ' is-active' : ''}`}
                    />
                ))}
            </div>
        </div>
    );
});

BannerCarousel.displayName = 'BannerCarousel';

export default BannerCarousel;
