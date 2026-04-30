import React, { useState } from 'react';
import type { Offer } from '../../types/booking.types';

interface ImageGalleryProps {
    images: string[];
    title: string;
    offer?: Offer;
}

interface GalleryTileProps {
    src: string;
    alt: string;
    className?: string;
    overlayClassName?: string;
    onClick: () => void;
    children?: React.ReactNode;
}

const GalleryTile: React.FC<GalleryTileProps> = ({
    src,
    alt,
    className = '',
    overlayClassName = '',
    onClick,
    children,
}) => (
    <button
        type="button"
        onClick={onClick}
        className={`relative overflow-hidden rounded-[24px] border border-white/70 bg-slate-950 text-left shadow-[0_22px_48px_rgba(15,23,42,0.16)] transition-all duration-500 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_rgba(15,23,42,0.22)] ${className}`}
    >
        <img
            src={src}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl opacity-45"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.04)_0%,rgba(15,23,42,0.28)_100%)]" />
        <img
            src={src}
            alt={alt}
            className="relative z-10 h-full w-full object-cover transition-transform duration-700 hover:scale-[1.06]"
        />
        <div className={`pointer-events-none absolute inset-0 z-20 ${overlayClassName}`} />
        {children}
    </button>
);

export const ImageGallery: React.FC<ImageGalleryProps> = ({ images, title, offer }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const displayImages = (images || []).filter((url) =>
        url && typeof url === 'string' && url.trim().length > 0
    );

    const total = displayImages.length;
    const offerLabel = offer
        ? offer.type === 'percentage'
            ? `${offer.value}% OFF`
            : `Rs ${Number(offer.value || 0).toLocaleString('en-IN')} OFF`
        : null;

    const nextImage = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setCurrentIndex((prev) => (prev + 1) % displayImages.length);
    };

    const prevImage = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        setCurrentIndex((prev) => (prev - 1 + displayImages.length) % displayImages.length);
    };

    if (total === 0) {
        return (
            <div className="relative flex h-[280px] flex-col items-center justify-center gap-4 overflow-hidden rounded-[28px] border border-dashed border-slate-200 bg-[linear-gradient(180deg,#F8FAFC_0%,#EEF2FF_100%)] md:h-[520px]">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">No photos uploaded</p>
            </div>
        );
    }

    const currentImage = displayImages[currentIndex];

    return (
        <div className="relative group">
            {offerLabel && (
                <div className="pointer-events-none absolute left-4 top-4 z-30 md:left-6 md:top-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-[linear-gradient(135deg,#F97316_0%,#EF4444_100%)] px-3 py-1.5 text-white shadow-[0_18px_36px_rgba(239,68,68,0.28)] backdrop-blur-md">
                        <span className="text-[9px] font-black uppercase tracking-[0.24em] md:text-[10px]">Offer</span>
                        <span className="text-[11px] font-black tracking-[0.08em] md:text-xs">{offerLabel}</span>
                    </div>
                </div>
            )}

            <div className="md:hidden">
                <div className="relative h-[224px] overflow-hidden rounded-b-[28px] bg-slate-950 shadow-[0_20px_44px_rgba(15,23,42,0.18)]">
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.04)_0%,rgba(15,23,42,0.18)_100%)]" />

                    <button
                        type="button"
                        className="absolute inset-0"
                        onClick={() => setIsFullscreen(true)}
                        aria-label={`Open photo ${currentIndex + 1} of ${total}`}
                    >
                        <img
                            src={currentImage}
                            alt={`${title} - View ${currentIndex + 1}`}
                            className="h-full w-full object-cover object-center"
                        />
                    </button>

                    {total > 1 && (
                        <>
                            <button
                                type="button"
                                onClick={prevImage}
                                className="absolute left-3 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/18 text-white/85 backdrop-blur-md transition-transform active:scale-95"
                                aria-label="Previous photo"
                            >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <button
                                type="button"
                                onClick={nextImage}
                                className="absolute right-3 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/18 text-white/85 backdrop-blur-md transition-transform active:scale-95"
                                aria-label="Next photo"
                            >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        </>
                    )}

                    <div className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-3 p-3.5">
                        <div className="space-y-2">
                            <div className="inline-flex items-center rounded-full border border-white/12 bg-black/30 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white backdrop-blur-md">
                                {currentIndex + 1} / {total}
                            </div>
                            {total > 1 && (
                                <div className="flex items-center gap-1.5">
                                    {displayImages.map((_, index) => (
                                        <span
                                            key={index}
                                            className={`h-1.5 rounded-full transition-all ${index === currentIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/45'}`}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {total > 1 && (
                            <button
                                type="button"
                                onClick={() => setIsFullscreen(true)}
                                className="inline-flex h-8 items-center gap-1 rounded-[10px] border border-orange-300/35 bg-[linear-gradient(135deg,#FB923C_0%,#F97316_100%)] px-2.5 text-[7px] font-black uppercase tracking-[0.12em] text-white shadow-[0_10px_20px_rgba(249,115,22,0.18)] transition-transform active:scale-95"
                            >
                                <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                                </svg>
                                View All
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="hidden rounded-[34px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(244,247,251,0.98)_100%)] p-2.5 shadow-[0_28px_65px_rgba(15,23,42,0.12)] md:block lg:p-3">
                <div className={`grid h-[360px] gap-3 lg:h-[430px] ${total === 1 ? 'grid-cols-1' : total === 2 ? 'grid-cols-3' : 'grid-cols-4 grid-rows-2'}`}>
                    <GalleryTile
                        src={displayImages[0]}
                        alt={title}
                        className={total === 1 ? 'col-span-1 row-span-1' : total === 2 ? 'col-span-2 row-span-1' : 'col-span-2 row-span-2'}
                        overlayClassName="bg-[linear-gradient(180deg,rgba(15,23,42,0.02)_0%,rgba(15,23,42,0.1)_100%)]"
                        onClick={() => {
                            setCurrentIndex(0);
                            setIsFullscreen(true);
                        }}
                    >
                        <div className="absolute bottom-4 right-4 z-30 rounded-full border border-white/25 bg-black/25 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white backdrop-blur-md">
                            Hero Photo
                        </div>
                    </GalleryTile>

                    {total === 2 && (
                        <GalleryTile
                            src={displayImages[1]}
                            alt={`${title} - View 2`}
                            className="col-span-1 row-span-1"
                            onClick={() => {
                                setCurrentIndex(1);
                                setIsFullscreen(true);
                            }}
                        />
                    )}

                    {total === 3 && (
                        <>
                            <GalleryTile
                                src={displayImages[1]}
                                alt={`${title} - View 2`}
                                className="col-span-2 row-span-1"
                                onClick={() => {
                                    setCurrentIndex(1);
                                    setIsFullscreen(true);
                                }}
                            />
                            <GalleryTile
                                src={displayImages[2]}
                                alt={`${title} - View 3`}
                                className="col-span-2 row-span-1"
                                onClick={() => {
                                    setCurrentIndex(2);
                                    setIsFullscreen(true);
                                }}
                            />
                        </>
                    )}

                    {total === 4 && (
                        <>
                            <GalleryTile
                                src={displayImages[1]}
                                alt={`${title} - View 2`}
                                className="col-span-1 row-span-1"
                                onClick={() => {
                                    setCurrentIndex(1);
                                    setIsFullscreen(true);
                                }}
                            />
                            <GalleryTile
                                src={displayImages[2]}
                                alt={`${title} - View 3`}
                                className="col-span-1 row-span-1"
                                onClick={() => {
                                    setCurrentIndex(2);
                                    setIsFullscreen(true);
                                }}
                            />
                            <GalleryTile
                                src={displayImages[3]}
                                alt={`${title} - View 4`}
                                className="col-span-2 row-span-1"
                                onClick={() => {
                                    setCurrentIndex(3);
                                    setIsFullscreen(true);
                                }}
                            />
                        </>
                    )}

                    {total >= 5 && (
                        <>
                            <GalleryTile
                                src={displayImages[1]}
                                alt={`${title} - View 2`}
                                className="col-span-1 row-span-1"
                                onClick={() => {
                                    setCurrentIndex(1);
                                    setIsFullscreen(true);
                                }}
                            />
                            <GalleryTile
                                src={displayImages[2]}
                                alt={`${title} - View 3`}
                                className="col-span-1 row-span-1"
                                onClick={() => {
                                    setCurrentIndex(2);
                                    setIsFullscreen(true);
                                }}
                            />
                            <GalleryTile
                                src={displayImages[3]}
                                alt={`${title} - View 4`}
                                className="col-span-1 row-span-1"
                                onClick={() => {
                                    setCurrentIndex(3);
                                    setIsFullscreen(true);
                                }}
                            />
                            <GalleryTile
                                src={displayImages[4]}
                                alt={`${title} - View 5`}
                                className="col-span-1 row-span-1"
                                overlayClassName="bg-[linear-gradient(180deg,rgba(15,23,42,0.02)_0%,rgba(15,23,42,0.18)_100%)]"
                                onClick={() => {
                                    setCurrentIndex(4);
                                    setIsFullscreen(true);
                                }}
                            >
                                {total > 5 && (
                                    <div className="absolute bottom-4 left-4 z-30 rounded-2xl border border-white/20 bg-black/35 px-4 py-2.5 text-white backdrop-blur-md">
                                        <p className="text-[9px] font-black uppercase tracking-[0.24em] text-white/70">More Photos</p>
                                        <p className="mt-1 text-sm font-black">+{total - 4}</p>
                                    </div>
                                )}
                            </GalleryTile>
                        </>
                    )}
                </div>

                {total > 1 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-5 hidden justify-center md:flex">
                        <button
                            type="button"
                            onClick={() => setIsFullscreen(true)}
                            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/92 px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-900 shadow-[0_18px_38px_rgba(15,23,42,0.12)] transition-transform hover:-translate-y-0.5"
                        >
                            <svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                            </svg>
                            See All {total} Photos
                        </button>
                    </div>
                )}
            </div>

            {isFullscreen && (
                <div className="fixed inset-0 z-[1000] flex flex-col bg-black/95 backdrop-blur-3xl animate-in fade-in duration-300">
                    <div className="z-[1010] flex items-center justify-between p-4 md:p-6">
                        <div className="flex flex-col">
                            <h3 className="mb-1 text-base font-black leading-none tracking-tight text-white md:text-lg">{title}</h3>
                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/45">{currentIndex + 1} / {displayImages.length} Photos</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsFullscreen(false)}
                            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white backdrop-blur-md transition-all active:scale-90 md:h-12 md:w-12"
                        >
                            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="relative flex flex-1 items-center justify-center overflow-hidden p-3 md:p-12">
                        <img
                            src={displayImages[currentIndex]}
                            alt={`${title} - View ${currentIndex + 1}`}
                            className="absolute inset-0 h-full w-full scale-110 object-cover blur-3xl opacity-30"
                        />
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04)_0%,rgba(0,0,0,0.32)_72%)]" />

                        {displayImages.length > 1 && (
                            <>
                                <button
                                    type="button"
                                    onClick={prevImage}
                                    className="absolute left-3 z-[1020] hidden h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white backdrop-blur-md transition-all hover:text-blue-300 active:scale-95 md:flex"
                                >
                                    <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    onClick={nextImage}
                                    className="absolute right-3 z-[1020] hidden h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white backdrop-blur-md transition-all hover:text-blue-300 active:scale-95 md:flex"
                                >
                                    <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            </>
                        )}

                        <div className="relative z-10 flex h-full w-full items-center justify-center">
                            <img
                                src={displayImages[currentIndex]}
                                alt={`${title} - View ${currentIndex + 1}`}
                                className="max-h-full max-w-full rounded-[20px] object-contain shadow-[0_0_80px_rgba(0,0,0,0.55)] animate-in zoom-in-95 duration-300"
                            />
                        </div>
                    </div>

                    <div className="px-4 pb-10 md:px-6 md:pb-12">
                        <div className="flex max-w-full items-center gap-3 overflow-x-auto py-2 no-scrollbar md:justify-center">
                            {displayImages.map((img, idx) => (
                                <button
                                    type="button"
                                    key={idx}
                                    onClick={() => setCurrentIndex(idx)}
                                    className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-[16px] border-2 transition-all md:h-[72px] md:w-[72px] ${idx === currentIndex ? 'scale-105 border-white shadow-[0_18px_36px_rgba(255,255,255,0.12)]' : 'border-transparent opacity-45 hover:opacity-100'}`}
                                >
                                    <img src={img} alt="" aria-hidden="true" className="h-full w-full object-cover" />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
