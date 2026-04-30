import React, { useState, useRef, useEffect } from 'react';

interface SortOption {
    value: string;
    label: string;
}

interface SortDropdownProps {
    value: string;
    onChange: (value: string) => void;
    options: SortOption[];
}

export const SortDropdown: React.FC<SortDropdownProps> = ({ value, onChange, options }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const selectedLabel = options.find(opt => opt.value === value)?.label || 'Popular';

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative inline-block" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex h-10 w-10 items-center justify-center
                    rounded-full border border-[#D7DCE5] bg-white shadow-[0_8px_20px_rgba(15,23,42,0.05)]
                    transition-all duration-200 group hover:border-[#C8D7F2] hover:bg-[#F8FAFC]
                    lg:h-11 lg:w-auto lg:min-w-[128px] lg:justify-between lg:gap-3 lg:rounded-[16px] lg:px-4 lg:text-[#1F2937]
                    ${isOpen ? 'border-[#F47A20] bg-[#FFF4EC] ring-2 ring-[rgba(244,122,32,0.14)]' : ''}
                `}
                aria-label="Sort properties"
            >
                <svg className={`w-5 h-5 transition-colors ${isOpen || value !== 'popular' ? 'text-[#F47A20]' : 'text-[#255CF0]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                </svg>
                <span className="hidden lg:block truncate text-[13px] font-semibold text-[#334155]">
                    {selectedLabel}
                </span>
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 sm:w-56 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.12)] z-[60] animate-in fade-in zoom-in-95 duration-200 origin-top-right">
                    <div className="py-2">
                        {options.map((option) => (
                            <button
                                key={option.value}
                                onClick={() => {
                                    onChange(option.value);
                                    setIsOpen(false);
                                }}
                                className={`
                                    w-full text-left px-5 py-3 text-sm font-bold transition-all whitespace-nowrap
                                    ${value === option.value
                                        ? 'bg-[#FFF4EC] text-[#F47A20]'
                                        : 'text-gray-600 hover:bg-[#F8FAFC] hover:text-[#255CF0]'
                                    }
                                `}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
