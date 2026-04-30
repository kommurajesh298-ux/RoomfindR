import toast, { type ToastOptions } from 'react-hot-toast';

const baseToastStyle = {
    padding: '16px',
};

const createToastOptions = (borderColor: string, textColor: string): ToastOptions => ({
    style: {
        ...baseToastStyle,
        border: `1px solid ${borderColor}`,
        color: textColor,
    },
});

export const showSuccess = (message: string) => {
    toast.success(message, {
        ...createToastOptions('#10B981', '#064E3B'),
        iconTheme: {
            primary: '#10B981',
            secondary: '#FFFAEE',
        },
    });
};

export const showError = (message: string) => {
    toast.error(message, {
        ...createToastOptions('#EF4444', '#7F1D1D'),
        iconTheme: {
            primary: '#EF4444',
            secondary: '#FFFAEE',
        },
    });
};

export const showInfo = (message: string) => {
    toast(message, {
        ...createToastOptions('#3B82F6', '#1E3A8A'),
        icon: 'i',
    });
};

export const showLoading = (message: string) => toast.loading(message);
