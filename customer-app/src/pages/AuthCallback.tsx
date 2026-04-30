import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase-config';
import LoadingOverlay from '../components/common/LoadingOverlay';
import { showSuccess, showError } from '../utils/toast';

const AuthCallback = () => {
    const navigate = useNavigate();

    useEffect(() => {
        const handleAuthCallback = async () => {
            try {
                // Supabase automatically handles the token exchange from the URL
                const { data: { session }, error } = await supabase.auth.getSession();

                if (error) {
                    console.error('Auth callback error:', error);
                    showError('Email verification failed. Please try again.');
                    navigate('/login');
                    return;
                }

                if (session) {
                    showSuccess('Email verified successfully! Welcome to RoomFindR! 🎉');
                    // Navigate to home page
                    navigate('/', { replace: true });
                } else {
                    // No session found, redirect to login
                    navigate('/login', { replace: true });
                }
            } catch (error) {
                console.error('Unexpected error:', error);
                showError('Something went wrong. Please try logging in.');
                navigate('/login');
            }
        };

        handleAuthCallback();
    }, [navigate]);

    return <LoadingOverlay message="Verifying your email..." />;
};

export default AuthCallback;
