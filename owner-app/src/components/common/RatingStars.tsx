import React from 'react';
import { IoStar, IoStarOutline } from 'react-icons/io5';

interface RatingStarsProps {
    rating: number;
    className?: string;
    starClassName?: string;
    filledClassName?: string;
    emptyClassName?: string;
}

const RatingStars: React.FC<RatingStarsProps> = ({
    rating,
    className = '',
    starClassName = 'h-4 w-4',
    filledClassName = 'text-[#FF7A00]',
    emptyClassName = 'text-gray-300',
}) => {
    const normalized = Math.max(0, Math.min(5, Number(rating || 0)));

    return (
        <div className={`flex items-center gap-0.5 ${className}`.trim()} aria-label={`${normalized.toFixed(1)} out of 5 stars`}>
            {Array.from({ length: 5 }, (_, index) => {
                const starFill = Math.max(0, Math.min(1, normalized - index));

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
