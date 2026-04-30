import React from 'react';

interface PhoneInputProps {
    value: string;
    onChange: (value: string) => void;
    error?: string;
    disabled?: boolean;
}

const PhoneInput: React.FC<PhoneInputProps> = ({ value, onChange, error, disabled }) => {
    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.replace(/[^0-9]/g, '');
        if (val.length <= 10) {
            onChange(val);
        }
    };

    return (
        <div className="flex flex-col gap-1 w-full">
            <label className="text-sm font-medium text-gray-700">Phone Number</label>
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent transition-all">
                <div className="bg-gray-50 px-3 py-2 border-r border-gray-300 text-gray-600 font-medium">
                    +91
                </div>
                <input
                    type="tel"
                    name="phone"
                    value={value}
                    onChange={handlePhoneChange}
                    placeholder="Enter 10-digit number"
                    disabled={disabled}
                    className="flex-1 px-4 py-2 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
};

export default PhoneInput;
