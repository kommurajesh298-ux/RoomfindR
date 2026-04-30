import toast, { type Renderable, type Toast, type ToastOptions } from 'react-hot-toast';

export const showToast = {
    success: (message: string, options?: ToastOptions) => toast.success(message, {
        style: {
            background: '#10B981',
            color: '#fff',
        },
        iconTheme: {
            primary: '#fff',
            secondary: '#10B981',
        },
        ...options,
    }),
    error: (message: string, options?: ToastOptions) => toast.error(message, {
        style: {
            background: '#EF4444',
            color: '#fff',
        },
        iconTheme: {
            primary: '#fff',
            secondary: '#EF4444',
        },
        ...options,
    }),
    loading: (message: string, options?: ToastOptions) => toast.loading(message, {
        style: {
            background: '#3B82F6',
            color: '#fff',
        },
        ...options,
    }),
    dismiss: (toastId?: string) => toast.dismiss(toastId),
    custom: (component: (toastValue: Toast) => Renderable) => toast.custom(component),
};
