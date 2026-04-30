import React from 'react';

interface EditableFieldProps {
    label: string;
    value: string;
    type?: 'text' | 'email' | 'tel';
    onChange: (value: string) => void;
    isEditing: boolean;
    validation?: (value: string) => string | null;
}

const EditableField: React.FC<EditableFieldProps> = ({
    label,
    value,
    type = 'text',
    onChange,
    isEditing,
    validation
}) => {
    const error = validation ? validation(value) : null;

    return (
        <div className="mb-4">
            <label className="block text-[11px] font-bold text-[#6B7280] uppercase tracking-widest mb-1.5">
                {label}
            </label>

            {isEditing ? (
                <div className="relative">
                    <input
                        type={type}
                        name={label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        className={`w-full h-[48px] bg-white border ${error ? 'border-red-500' : 'border-gray-200'} rounded-[12px] px-4 text-[15px] font-medium text-[#111827] focus:ring-2 focus:ring-[#2563eb] outline-none transition-all shadow-inner`}
                    />
                    {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
                </div>
            ) : (
                <div className="min-h-[24px] flex items-center text-[15px] font-semibold text-[#111827]">
                    {value || <span className="text-[#94A3B8] font-normal italic">Not specified</span>}
                </div>
            )}
        </div>
    );
};

export default EditableField;
