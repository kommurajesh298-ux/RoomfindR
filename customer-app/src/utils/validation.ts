/**
 * Validates email format using regex
 */
export const validateEmail = (email: string): boolean => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

/**
 * Validates Indian phone number (10 digits)
 */
export const validatePhone = (phone: string): boolean => {
    const re = /^[6-9]\d{9}$/;
    return re.test(phone);
};

/**
 * Comprehensive password validation
 * Returns validity, strength score (0-4), and feedback messages
 */
export const validatePassword = (password: string): { valid: boolean; strength: number; messages: string[] } => {
    let score = 0;
    const messages: string[] = [];

    if (password.length >= 8) score++;
    else messages.push("At least 8 characters");

    if (/[A-Z]/.test(password)) score++;
    else messages.push("Include uppercase letter");

    if (/[0-9]/.test(password)) score++;
    else messages.push("Include number");

    if (/[^A-Za-z0-9]/.test(password)) score++;
    else messages.push("Include special character");

    return {
        valid: score >= 3, // Medium strength required
        strength: score,
        messages
    };
};

/**
 * Validates 6-digit OTP
 */
export const validateOTP = (otp: string): boolean => {
    return /^\d{6}$/.test(otp);
};
