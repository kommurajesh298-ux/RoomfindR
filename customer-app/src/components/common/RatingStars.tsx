import React from 'react';
import { IoStar, IoStarOutline } from 'react-icons/io5';

interface RatingStarsProps {
    rating: number;
    className?: string;
    starClassName?: string;
    filledClassName?: string;
    emptyClassName?: string;
}

const MAX_STARS = 5;

const RatingStars: React.FC<RatingStarsProps> = ({
    rating,
    className = '',
    starClassName = 'h-3.5 w-3.5',
    filledClassName = 'text-[#FF7A00]',
    emptyClassName = 'text-gray-300',
}) => {
    const clampedRating = Math.max(0, Math.min(MAX_STARS, Number(rating) || 0));

    return (
        <div
            className={`flex items-center gap-0.5 ${className}`.trim()}
            aria-label={`${clampedRating.toFixed(1)} out of ${MAX_STARS} stars`}
        >
            {Array.from({ length: MAX_STARS }, (_, index) => {
                const starFill = Math.max(0, Math.min(1, clampedRating - index));

                return (
                    <span key={index} className="relative inline-flex">
                        <IoStarOutline className={`${starClassName} ${emptyClassName}`.trim()} />
                        {starFill > 0 ? (
                            <span
                                className="absolute inset-y-0 left-0 overflow-hidden"
                                style={{ width: `${starFill * 100}%` }}
                            >
                                <IoStar className={`${starClassName} ${filledClassName}`.trim()} />
                            </span>
                        ) : null}
                    </span>
                );
            })}
        </div>
    );
};

export default RatingStars;
