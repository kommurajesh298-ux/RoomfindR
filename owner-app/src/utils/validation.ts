export const validateEmail = (email: string): boolean => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

export const validatePhone = (phone: string): boolean => {
    const re = /^[0-9]{10}$/;
    return re.test(phone);
};

export const validatePassword = (password: string): boolean => {
    const re = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{8,}$/;
    return re.test(password);
};

export const validateIFSC = (ifsc: string): boolean => {
    const re = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    return re.test(ifsc);
};

export const validateOTP = (otp: string): boolean => {
    return /^\d{6}$/.test(otp);
};
