import React, { useState } from 'react';
import { format, subDays, subMonths } from 'date-fns';
import { FiCalendar, FiChevronDown } from 'react-icons/fi';

interface DateRangePickerProps {
    startDate: Date;
    endDate: Date;
    onChange: (start: Date, end: Date) => void;
}

const presets = [
    { label: 'Last 7 days', getValue: () => [subDays(new Date(), 7), new Date()] },
    { label: 'Last 30 days', getValue: () => [subDays(new Date(), 30), new Date()] },
    { label: 'Last 3 months', getValue: () => [subMonths(new Date(), 3), new Date()] },
    { label: 'Custom', getValue: () => null },
];

const DateRangePicker: React.FC<DateRangePickerProps> = ({ startDate, endDate, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState('Last 30 days');
    const [customStart, setCustomStart] = useState(format(startDate, 'yyyy-MM-dd'));
    const [customEnd, setCustomEnd] = useState(format(endDate, 'yyyy-MM-dd'));

    const handlePresetClick = (preset: typeof presets[0]) => {
        setSelectedPreset(preset.label);
        const range = preset.getValue();
        if (range) {
            onChange(range[0] as Date, range[1] as Date);
            setIsOpen(false);
        }
    };

    const handleCustomApply = () => {
        const start = new Date(customStart);
        const end = new Date(customEnd);
        if (end > start) {
            onChange(start, end);
            setIsOpen(false);
        } else {
            alert('End date must be after start date');
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-sm font-medium text-slate-700"
            >
                <FiCalendar className="text-slate-400" />
                <span>{selectedPreset === 'Custom'
                    ? `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`
                    : selectedPreset}</span>
                <FiChevronDown className={`ml-2 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-100 p-4 z-20">
                        <div className="space-y-1 mb-4">
                            {presets.map((preset) => (
                                <button
                                    key={preset.label}
                                    onClick={() => handlePresetClick(preset)}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedPreset === preset.label
                                            ? 'bg-blue-50 text-blue-600 font-medium'
                                            : 'text-slate-600 hover:bg-slate-50'
                                        }`}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>

                        {selectedPreset === 'Custom' && (
                            <div className="pt-4 border-t border-slate-100 space-y-3">
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">Start Date</label>
                                    <input
                                        type="date"
                                        name="analyticsDateRangeStart"
                                        value={customStart}
                                        onChange={(e) => setCustomStart(e.target.value)}
                                        className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:border-blue-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-500 mb-1">End Date</label>
                                    <input
                                        type="date"
                                        name="analyticsDateRangeEnd"
                                        value={customEnd}
                                        onChange={(e) => setCustomEnd(e.target.value)}
                                        className="w-full text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:border-blue-500 outline-none"
                                    />
                                </div>
                                <button
                                    onClick={handleCustomApply}
                                    className="w-full bg-blue-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                    Apply Range
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default DateRangePicker;
