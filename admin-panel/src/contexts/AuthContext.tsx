import React, { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { authService } from '../services/auth.service';
import { toast } from 'react-hot-toast';
import { AuthContext } from '../hooks/useAuth';
import type { AdminUser } from '../types/admin.types';
import { pushService } from '../services/push.service';
import { browserNotificationService } from '../services/browser-notification.service';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [admin, setAdmin] = useState<AdminUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        let authRunId = 0;
        let unsubscribeRole: (() => void) | undefined;
        let bootstrapTimeout: ReturnType<typeof setTimeout> | undefined;
        let receivedInitialAuthEvent = false;

        const clearRoleSubscription = () => {
            if (unsubscribeRole) {
                unsubscribeRole();
                unsubscribeRole = undefined;
            }
        };

        const finishLoading = () => {
            if (!isMounted) return;
            if (bootstrapTimeout) {
                clearTimeout(bootstrapTimeout);
                bootstrapTimeout = undefined;
            }
            setLoading(false);
        };

        const failBootstrap = (message: string) => {
            if (!isMounted) return;
            console.error(`[AdminAuth] ${message}`);
            setAdmin(null);
            setError(message);
            void authService.signOut().catch(() => undefined);
            finishLoading();
        };

        const handleAuthUser = async (user: User | null) => {
            const runId = ++authRunId;
            if (!isMounted) return;

            const shimmed = user ? {
                ...user,
                uid: user.id,
                displayName: user.user_metadata?.name || null,
                phoneNumber: user.user_metadata?.phone || null,
                photoURL: user.user_metadata?.avatar_url || null,
                emailVerified: !!user.email_confirmed_at
            } : null;

            clearRoleSubscription();

            if (user && shimmed) {
                setLoading(true);
                unsubscribeRole = authService.subscribeToAdminRole(user.id, async (role) => {
                    if (!isMounted || runId !== authRunId) return;

                    if (role === 'admin') {
                        setAdmin({
                            uid: shimmed.uid,
                            email: shimmed.email || '',
                            role: 'admin',
                            permissions: ['all'],
                            createdAt: shimmed.created_at || new Date().toISOString(),
                            displayName: shimmed.displayName || undefined,
                            photoURL: shimmed.photoURL || undefined
                        });
                        setError(null);
                        finishLoading();
                    } else {
                        console.warn('[AuthContext] Access revoked: Not an admin or role fetch failed');
                        setError('Unauthorized. Admin access only.');
                        if (role !== null) toast.error('Unauthorized. Admin access only.');

                        await authService.signOut().catch(() => undefined);
                        setAdmin(null);
                        finishLoading();
                    }
                });
            } else {
                setAdmin(null);
                finishLoading();
            }
        };

        bootstrapTimeout = setTimeout(() => {
            if (!isMounted) return;
            failBootstrap('Admin startup timed out. Please refresh and sign in again.');
        }, 30000);

        const unsubscribeAuth = authService.onAuthChange((user: User | null) => {
            receivedInitialAuthEvent = true;
            void handleAuthUser(user);
        });

        const fallbackBootstrapTimeout = setTimeout(() => {
            if (!isMounted || receivedInitialAuthEvent) return;

            void authService.getCurrentUser()
                .then((user) => {
                    if (receivedInitialAuthEvent) return;
                    void handleAuthUser(user);
                })
                .catch((authError) => {
                    console.error('[AdminAuth] Initial user bootstrap failed:', authError);
                    failBootstrap('Unable to restore your admin session. Please sign in again.');
                });
        }, 1500);

        return () => {
            isMounted = false;
            if (bootstrapTimeout) {
                clearTimeout(bootstrapTimeout);
            }
            if (fallbackBootstrapTimeout) {
                clearTimeout(fallbackBootstrapTimeout);
            }
            unsubscribeAuth();
            clearRoleSubscription();
        };
    }, []);

    useEffect(() => {
        if (admin?.uid) {
            if (Capacitor.isNativePlatform()) {
                void pushService.register();
            } else {
                void browserNotificationService.requestPermission();
            }
        } else {
            void pushService.unregister();
        }
    }, [admin?.uid]);

    const signOut = async () => {
        try {
            await authService.signOut();
            setAdmin(null);
        } catch (err) {
            console.error('Sign out error:', err);
            toast.error('Failed to sign out');
        }
    };

    return (
        <AuthContext.Provider value={{ admin, loading, error, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};

