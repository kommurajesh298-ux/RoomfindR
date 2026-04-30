import React, { useEffect, useState } from 'react';

interface PasswordStrengthProps {
    password: string;
    onChange: (score: number) => void;
}

const PasswordStrength: React.FC<PasswordStrengthProps> = ({ password, onChange }) => {
    const [score, setScore] = useState(0);
    const [messages, setMessages] = useState<string[]>([]);

    useEffect(() => {
        const calculateStrength = () => {
            let s = 0;
            const msg: string[] = [];

            if (password.length >= 8) {
                s++;
            } else if (password.length > 0) {
                msg.push("At least 8 characters");
            }

            if (/[A-Z]/.test(password)) {
                s++;
            } else if (password.length > 0) {
                msg.push("Include uppercase letter");
            }

            if (/[0-9]/.test(password)) {
                s++;
            } else if (password.length > 0) {
                msg.push("Include number");
            }

            if (/[^A-Za-z0-9]/.test(password)) {
                s++;
            } else if (password.length > 0) {
                msg.push("Include special character");
            }

            setScore(s);
            setMessages(msg);
            onChange(s);
        };

        calculateStrength();
    }, [password, onChange]);

    const getBarColor = () => {
        if (score <= 1) return 'bg-red-500';
        if (score <= 3) return 'bg-yellow-500';
        return 'bg-blue-500';
    };

    return (
        <div className="mt-2">
            <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-300 ${getBarColor()}`}
                    style={{ width: `${(score / 4) * 100}%` }}
                />
            </div>
            {messages.length > 0 && (
                <ul className="mt-2 text-xs text-gray-500 space-y-1">
                    {messages.map((m, i) => (
                        <li key={i} className="flex items-center">
                            <span className="w-1 h-1 bg-gray-400 rounded-full mr-2" />
                            {m}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default PasswordStrength;

