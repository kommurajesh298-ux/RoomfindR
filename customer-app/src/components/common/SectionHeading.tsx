import React, { memo } from 'react';

interface SectionHeadingProps {
    title: string;
    subtitle?: React.ReactNode;
    icon?: React.ReactNode;
    variant?: 'default' | 'listing';
}

export const SectionHeading: React.FC<SectionHeadingProps> = memo(({
    title,
    subtitle,
    icon,
    variant = 'default'
}) => {
    const isListingVariant = variant === 'listing';

    return (
        <div
            className={[
                'rfm-section-heading',
                isListingVariant
                    ? 'rfm-section-heading--listing'
                    : ''
            ].join(' ')}
        >
            <div className={`rfm-section-heading-row flex gap-3 ${isListingVariant ? 'items-center' : 'items-start'}`}>
                {icon && (
                    <div className={`rfm-section-heading-icon flex shrink-0 items-center justify-center text-[#2B63D9] ${isListingVariant ? '' : 'h-12 w-12 rounded-[16px]'}`}>
                        <div className={`rfm-section-heading-icon-inner flex items-center justify-center [&_svg]:h-full [&_svg]:w-full ${isListingVariant ? '' : 'h-6 w-6'}`}>
                            {icon}
                        </div>
                    </div>
                )}
                <div className={`rfm-section-heading-copy min-w-0 flex-1 ${isListingVariant ? 'rfm-section-heading-copy--listing' : ''}`}>
                    <h2 className={`rfm-section-heading-title text-[#0B132B] ${isListingVariant ? '' : 'font-extrabold text-[20px] leading-[1.08]'}`}>
                        {title}
                    </h2>
                    {subtitle && (
                        <p className={`rfm-section-heading-subtitle font-medium text-[#4C5567] ${isListingVariant ? '' : 'mt-1 text-[16px]'}`}>
                            {subtitle}
                        </p>
                    )}
                    {isListingVariant && <div className="rfm-section-heading-accent" />}
                </div>
            </div>
        </div>
    );
});

SectionHeading.displayName = 'SectionHeading';
