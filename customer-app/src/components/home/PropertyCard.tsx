import React, { memo, useMemo, useState } from 'react';
import { buttonStyles, cardStyles, typography } from '../../../../design-system';
import type { Offer } from '../../types/offer.types';
import type { Property } from '../../types/property.types';
import RatingStars from '../common/RatingStars';
import { getVacancySummary, resolveVacancyCount } from '../../../../shared/vacancy';

interface PropertyCardProps {
    property: Property;
    onView: (id: string) => void;
    onBook: (id: string) => void;
    onToggleFavorite: (id: string) => void;
    isFavorite: boolean;
    compact?: boolean;
    appliedOffer?: Offer;
}

export const PropertyCard: React.FC<PropertyCardProps> = memo(({
    property,
    onView,
    onBook: _onBook,
    onToggleFavorite,
    isFavorite,
    compact = false,
    appliedOffer
}) => {
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    const displayImages = useMemo(() => {
        const allImages = [
            ...(property.images || []),
            ...Object.values(property.rooms || {}).flatMap((room) => (room as { images?: string[] }).images || [])
        ];

        return allImages.filter(
            (url) => url && typeof url === 'string' && url.length > 5 && !url.includes('1522771753033')
        );
    }, [property.images, property.rooms]);

    const truncatedAddress = useMemo(() => {
        return typeof property.address === 'string' ? property.address : property.address.text;
    }, [property.address]);

    const distInfo = useMemo(() => {
        if (property.distance === undefined) return null;

        const distance = property.distance;
        let label = 'Far';
        let color = 'text-slate-600';
        let bgColor = 'bg-slate-100';

        if (distance <= 2) {
            label = 'Very Near';
            color = 'text-blue-700';
            bgColor = 'bg-blue-100';
        } else if (distance <= 5) {
            label = 'Near';
            color = 'text-orange-700';
            bgColor = 'bg-orange-100';
        } else if (distance <= 10) {
            label = 'Around you';
            color = 'text-[#225EC9]';
            bgColor = 'bg-[#DDE9FF]';
        }

        return { label, text: `${distance} km away`, color, bgColor };
    }, [property.distance]);

    const offerAmount = useMemo(() => {
        const offer = appliedOffer || property.autoOffer;
        if (!offer) return null;

        if (offer.type === 'percentage') {
            return Math.round((property.pricePerMonth || 0) * offer.value! / 100).toLocaleString();
        }

        return offer.value!.toLocaleString();
    }, [appliedOffer, property.autoOffer, property.pricePerMonth]);

    const hasRatings = Number(property.totalRatings || 0) > 0 && Number(property.avgRating || 0) > 0;
    const showNewBadge = !hasRatings;
    const vacancyCount = useMemo(
        () => resolveVacancyCount(property.vacancies, property.rooms),
        [property.vacancies, property.rooms]
    );
    const vacancySummary = getVacancySummary(vacancyCount);
    const ratingLabel = hasRatings
        ? `${Number(property.avgRating || 0).toFixed(1)} (${property.totalRatings} ${property.totalRatings === 1 ? 'rating' : 'ratings'})`
        : 'No ratings yet';

    const handleNextImage = (event: React.MouseEvent) => {
        event.stopPropagation();
        setCurrentImageIndex((prev) => (prev + 1) % displayImages.length);
    };

    const handlePrevImage = (event: React.MouseEvent) => {
        event.stopPropagation();
        setCurrentImageIndex((prev) => (prev - 1 + displayImages.length) % displayImages.length);
    };

    const handleSaveClick = (event: React.MouseEvent) => {
        event.stopPropagation();
        onToggleFavorite(property.propertyId);
    };

    const cardWidthClass = compact
        ? 'rfm-card-compact w-[168px] sm:w-[196px] md:w-[272px] lg:w-[288px] flex-shrink-0'
        : 'w-full';

    const mediaHeightClass = compact
        ? 'h-[108px] sm:h-[124px] md:h-[148px] lg:h-[168px]'
        : 'h-[108px] sm:h-[144px] md:h-auto md:aspect-[4/3] lg:h-[160px] lg:aspect-auto';

    const titleClass = compact
        ? 'line-clamp-1 text-[12px] leading-[1.2] text-[#1D4ED8] lg:text-[16px] lg:leading-[1.15]'
        : 'rfm-pg-title-single-line title-underline w-full text-[13px] leading-[1.14] tracking-[-0.02em] text-[#1F3B73] transition-colors group-hover:text-[#F97316] sm:text-[14px] sm:leading-[1.16] md:text-[17px] md:leading-[1.2] lg:text-[17px] lg:leading-[1.18]';

    return (
        <div
            className={[
                cardStyles.interactive,
                'property-card rfm-card group relative flex h-full flex-col overflow-hidden border border-[#E5E7EB] bg-white !p-0 !rounded-[18px] shadow-[0_10px_24px_rgba(15,23,42,0.06)] will-change-transform hover:shadow-[0_18px_32px_rgba(15,23,42,0.10)] lg:!rounded-[22px]',
                cardWidthClass
            ].join(' ')}
            onClick={() => onView(property.propertyId)}
        >
            <div className={`rfm-card-media relative overflow-hidden ${mediaHeightClass}`}>
                <div className={`pointer-events-none absolute z-30 flex max-w-[calc(100%-3rem)] flex-wrap items-center gap-1.5 md:max-w-none md:flex-col md:items-start ${compact ? 'left-2 top-2' : 'left-2 top-2 md:left-2.5 md:top-2.5'}`}>
                    {property.verified && (
                        <span className="rfm-card-verified-badge rounded-full border border-[#D8E4FF] bg-white/96 px-2.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-[#255CF0] shadow-[0_6px_14px_rgba(37,99,235,0.10)] sm:text-[9px] md:px-3 md:py-1 md:text-[11px]">
                            Verified
                        </span>
                    )}

                    {offerAmount && (
                        <div>
                            <div className="flex items-center gap-1 rounded-full border border-[#FFD0AE] bg-[#F47A20] px-2 py-1 text-white shadow-[0_10px_18px_rgba(244,122,32,0.24)] sm:gap-1.5 md:gap-2 md:px-3 md:py-1.5">
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[9px] font-black sm:text-[10px] md:h-5 md:w-5 md:text-[12px]">%</span>
                                <span className="text-[9px] font-black uppercase leading-none tracking-[0.05em] sm:text-[10px] md:text-[13px]">
                                    {offerAmount} Off
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                <button
                    onClick={handleSaveClick}
                    className={`rfm-card-fav group/heart absolute z-30 flex items-center justify-center rounded-full border border-[#E5E7EB] bg-white/96 text-[#255CF0] shadow-[0_6px_14px_rgba(15,23,42,0.08)] transition-all hover:scale-105 hover:border-[#FFD0AE] hover:text-[#F47A20] ${compact ? 'right-2 top-2 h-7 w-7' : 'right-2 top-2 h-7 w-7 sm:right-2.5 sm:top-2.5 sm:h-8 sm:w-8 md:right-3 md:top-3 md:h-9 md:w-9'}`}
                >
                    <svg
                        className={`${compact ? 'h-3 w-3' : 'h-3 w-3 sm:h-3.5 sm:w-3.5 md:h-4 md:w-4'} ${isFavorite ? 'fill-[#F97316] text-[#F97316]' : 'fill-transparent text-[#2563EB] group-hover/heart:text-[#F97316]'}`}
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                        />
                    </svg>
                </button>

                <div className={`rfm-card-media-inner relative h-full overflow-hidden bg-[#EEF4FF] ${compact ? 'rfm-card-media-inner--compact' : 'md:h-[220px] lg:h-[198px]'}`}>
                    {displayImages.length > 0 ? (
                        <>
                            <img
                                src={displayImages[currentImageIndex]}
                                alt={property.title}
                                className="rfm-card-image h-full w-full object-cover transition-transform duration-700 will-change-transform group-hover:scale-105"
                                loading="lazy"
                                decoding="async"
                            />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#111827]/24 via-[#111827]/6 to-transparent" />

                            {!compact && displayImages.length > 1 && (
                                <>
                                    <button
                                        onClick={handlePrevImage}
                                        className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[#0F172A]/28 text-white opacity-0 backdrop-blur-md transition-all hover:bg-[#0F172A]/46 group-hover:opacity-100"
                                    >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={handleNextImage}
                                        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[#0F172A]/28 text-white opacity-0 backdrop-blur-md transition-all hover:bg-[#0F172A]/46 group-hover:opacity-100"
                                    >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </button>
                                    <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-[#0F172A]/22 px-2 py-1 backdrop-blur-md">
                                        {displayImages.map((_, index) => (
                                            <div
                                                key={index}
                                                className={`h-1.5 rounded-full transition-all ${index === currentImageIndex ? 'w-3 bg-white' : 'w-1.5 bg-white/40'}`}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                        <div className="group flex h-full w-full flex-col items-center justify-center border-b border-[#E6EEFF] bg-[linear-gradient(145deg,#EFF6FF_0%,#FFF7ED_100%)]">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#93B5F7] shadow-[inset_0_0_0_1px_rgba(191,219,254,0.9)] transition-transform group-hover:scale-110">
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.5}
                                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                    />
                                </svg>
                            </div>
                            <span className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#89A5D9]">No photo</span>
                        </div>
                    )}
                </div>
            </div>

            <div className={`rfm-card-content relative flex flex-grow flex-col border-t border-[#E6EEFF] ${compact ? 'p-2 lg:p-4' : 'p-2.5 md:p-5 lg:p-3.5'}`}>
                <div className={`rfm-card-head flex items-start justify-between gap-1 ${compact ? 'mb-0.5' : 'mb-1 md:mb-1.5'}`}>
                    <h3 className={`rfm-card-title ${typography.classes.cardTitle} ${titleClass}`} title={property.title}>
                        {property.title}
                    </h3>

                    {showNewBadge ? (
                        <div className={`bg-[#F47A20] text-white rfm-card-rating-badge is-new rf-card-rating flex shrink-0 items-center gap-1 ${compact ? 'rounded-full px-1.5 py-0.5' : 'rounded-[10px] px-2 py-0.5 sm:rounded-full md:px-2.5 md:py-1'}`}>
                            <span className={`${compact ? 'text-[8px]' : 'text-[8px] sm:text-[9px] md:text-[10px]'} font-bold uppercase tracking-wide`}>
                                New
                            </span>
                        </div>
                    ) : null}
                </div>

                <div className={`rfm-card-meta flex flex-col ${compact ? 'mb-1.5 gap-0.5' : 'mb-1.5 gap-0.5 md:mb-2.5 md:gap-1.5'}`}>
                    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'min-h-[18px]' : 'min-h-[22px]'}`}>
                        {hasRatings ? (
                            <>
                                <RatingStars
                                    rating={property.avgRating || 0}
                                    starClassName={compact ? 'h-3 w-3 lg:h-3.5 lg:w-3.5' : 'h-3.5 w-3.5 md:h-4 md:w-4'}
                                    filledClassName="text-[#FF7A00]"
                                    emptyClassName="text-[#D1D5DB]"
                                />
                                <span className={`font-bold leading-none text-[#FF7A00] ${compact ? 'text-[9px] lg:text-[10px]' : 'text-[10px] md:text-[11px] lg:text-[12px]'}`}>
                                    {ratingLabel}
                                </span>
                            </>
                        ) : (
                            <span className={`font-bold uppercase tracking-[0.12em] text-[#F47A20] ${compact ? 'text-[8px] lg:text-[9px]' : 'text-[9px] md:text-[10px]'}`}>
                                {ratingLabel}
                            </span>
                        )}
                    </div>

                    <p className={`rfm-card-address flex items-center gap-1 font-medium text-[#6B7280] ${compact ? 'line-clamp-1 text-[11px] lg:text-[12px]' : 'line-clamp-1 text-[12px] sm:text-[12px] md:line-clamp-2 md:text-[13px] lg:text-[12px]'}`}>
                        <span className="truncate">{truncatedAddress}</span>
                    </p>

                    {distInfo && (
                        <div className={`rfm-card-distance-row flex items-center ${compact ? 'gap-1.5' : 'gap-1 sm:gap-1.5 md:gap-2'}`}>
                            <span className={`rfm-card-distance-badge whitespace-nowrap rounded-full border border-white/70 font-semibold ${compact ? 'px-1.5 py-0.5 text-[9px] lg:px-2 lg:py-1 lg:text-[10px]' : 'px-2 py-0.5 text-[8px] sm:text-[9px] md:px-2.5 md:py-1 md:text-[10px] lg:px-3 lg:text-[10px]'} ${distInfo.bgColor} ${distInfo.color}`}>
                                {distInfo.label}
                            </span>
                            <span className={`rfm-card-distance-text whitespace-nowrap font-medium text-[#9CA3AF] ${compact ? 'text-[9px] lg:text-[10px]' : 'text-[8px] sm:text-[9px] md:text-[11px] lg:text-[10px]'}`}>
                                {distInfo.text}
                            </span>
                        </div>
                    )}
                </div>

                <div className={`rfm-card-footer mt-auto flex items-center justify-between md:items-end ${compact ? 'gap-1' : 'gap-2'}`}>
                    <div className="rfm-card-price-block flex min-w-0 flex-col">
                        <div className="flex items-baseline gap-1">
                            <span className={`${compact ? 'text-[9px] lg:text-[10px]' : 'text-[9px] md:text-[12px] lg:text-[11px]'} font-semibold uppercase tracking-wide text-[#F47A20]`}>Rs</span>
                            <span className={`rfm-card-price font-bold leading-none tracking-tight text-[#255CF0] ${compact ? 'text-[18px] lg:text-[24px]' : 'text-[17px] sm:text-[18px] md:text-[22px] lg:text-[28px]'}`}>
                                {(property.pricePerMonth || 0).toLocaleString()}
                            </span>
                            <span className={`${compact ? 'text-[9px] lg:text-[10px]' : 'text-[9px] md:text-[11px] lg:text-[10px]'} font-medium uppercase tracking-wide text-[#9CA3AF]`}>/mo</span>
                        </div>

                        {!vacancySummary.isSoldOut && (
                            <span className={`rfm-card-vacancy mt-0.5 flex items-center gap-1 font-medium tracking-wide ${compact ? 'text-[9px] lg:text-[10px]' : 'text-[9px] md:text-[11px] lg:text-[10px]'} ${vacancyCount < 5 ? 'text-[#F97316]' : 'text-[#2563EB]'}`}>
                                <div className={`rfm-card-vacancy-dot h-1 w-1 rounded-full md:h-1.5 md:w-1.5 ${vacancyCount < 5 ? 'bg-[#F97316]' : 'bg-[#2563EB]'}`} />
                                {vacancySummary.label}
                            </span>
                        )}

                        {vacancySummary.isSoldOut && (
                            <span className={`mt-0.5 font-semibold uppercase tracking-widest text-[var(--rf-color-error)] ${compact ? 'text-[9px] lg:text-[10px]' : 'text-[9px] md:text-[11px] lg:text-[10px]'}`}>
                                {vacancySummary.label}
                            </span>
                        )}
                    </div>

                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            onView(property.propertyId);
                        }}
                        className={`${compact ? 'inline-flex h-8 min-w-[60px] shrink-0 items-center justify-center rounded-[14px] bg-[#255CF0] px-3 text-[10px] font-black text-white shadow-[0_10px_20px_rgba(37,92,240,0.20)] lg:h-[40px] lg:min-w-[78px] lg:px-5 lg:text-[13px]' : `${buttonStyles.primary} rfm-card-cta rfm-card-view-btn !min-h-[36px] !rounded-[14px] !border !border-[#D8E4FF] !bg-[#255CF0] !px-3 !py-2 !text-[11px] !text-white shadow-[0_12px_22px_rgba(37,92,240,0.18)] transition-all hover:!border-[#FFD0AE] hover:!bg-[#F47A20] hover:shadow-[0_14px_26px_rgba(244,122,32,0.22)] md:!min-h-[42px] md:!px-6 md:!py-2.5 md:!text-[13px] lg:!min-h-[40px] lg:!rounded-[15px] lg:!px-5 lg:!text-[13px]`} whitespace-nowrap`}
                    >
                        {compact ? 'View' : (
                            <>
                                <span className="md:hidden">Book</span>
                                <span className="hidden md:inline">Book Room</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
});

PropertyCard.displayName = 'PropertyCard';
