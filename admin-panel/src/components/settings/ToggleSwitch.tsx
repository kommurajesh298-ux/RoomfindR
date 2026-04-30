import React from 'react';


interface ToggleSwitchProps {
    label: string;
    description?: string;
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    disabled?: boolean;
    loading?: boolean;
    danger?: boolean; // If true, active color is red (e.g., maintenance mode)
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
    label, description, enabled, onChange, disabled, loading, danger
}) => {
    return (
        <div className={`flex items-start justify-between py-4 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <div className="flex-1 mr-4">
                <div className="font-medium text-slate-900">{label}</div>
                {description && <div className="text-sm text-slate-500 mt-1">{description}</div>}
            </div>

            <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => !disabled && !loading && onChange(!enabled)}
                disabled={disabled || loading}
                className={`
                    relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent 
                    transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 
                    focus-visible:ring-blue-600 focus-visible:ring-offset-2
                    ${enabled
                        ? (danger ? 'bg-red-500' : 'bg-blue-600')
                        : 'bg-slate-200'
                    }
                `}
            >
                <span className="sr-only">Use setting</span>
                <span
                    aria-hidden="true"
                    className={`
                        pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 
                        transition duration-200 ease-in-out
                        ${enabled ? 'translate-x-5' : 'translate-x-0'}
                        ${loading ? 'animate-pulse' : ''}
                    `}
                />
            </button>
        </div>
    );
};

export default ToggleSwitch;
