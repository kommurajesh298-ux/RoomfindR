import React, { useEffect, useState } from 'react';
import { type User } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { userService, type UserData } from '../services/user.service';
import { authService } from '../services/auth.service';
import { pushService } from '../services/push.service';
import { browserNotificationService } from '../services/browser-notification.service';
import { AuthContext } from '../hooks/useAuth';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<User | null>(() => authService.getCachedCurrentUser());
    const [userData, setUserData] = useState<UserData | null>(null);
    const [loading, setLoading] = useState(true);
    const [profileResolved, setProfileResolved] = useState(() => !authService.getCachedCurrentUser());
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        let authRunId = 0;
        let unsubscribeUser: (() => void) | undefined;
        let unsubscribeRole: (() => void) | undefined;
        let bootstrapTimeout: ReturnType<typeof setTimeout> | undefined;
        let softReleaseTimer: ReturnType<typeof setTimeout> | undefined;
        let receivedInitialAuthEvent = false;
        let activeRoleSubscriptionUserId: string | null = null;
        let activeUserSubscriptionUserId: string | null = null;
        let resolvedCustomerDataUserId: string | null = null;

        const clearSubscriptions = (preserveUserId?: string | null) => {
            if (unsubscribeUser && activeUserSubscriptionUserId !== preserveUserId) {
                unsubscribeUser();
                unsubscribeUser = undefined;
                activeUserSubscriptionUserId = null;
                resolvedCustomerDataUserId = null;
            }
            if (unsubscribeRole && activeRoleSubscriptionUserId !== preserveUserId) {
                unsubscribeRole();
                unsubscribeRole = undefined;
                activeRoleSubscriptionUserId = null;
            }
        };

        const finishLoading = () => {
            if (!isMounted) return;
            if (bootstrapTimeout) {
                clearTimeout(bootstrapTimeout);
                bootstrapTimeout = undefined;
            }
            if (softReleaseTimer) {
                clearTimeout(softReleaseTimer);
                softReleaseTimer = undefined;
            }
            setLoading(false);
        };

        const scheduleSoftRelease = (delayMs = 4200) => {
            if (!isMounted) return;
            if (softReleaseTimer) {
                clearTimeout(softReleaseTimer);
            }
            softReleaseTimer = setTimeout(() => {
                if (!isMounted) return;
                finishLoading();
            }, delayMs);
        };

        const failBootstrap = (message: string) => {
            if (!isMounted) return;
            console.error(`[CustomerAuth] ${message}`);
            setError(message);
            const cachedUser = authService.getCachedCurrentUser();
            setCurrentUser((prev) => prev ?? cachedUser);
            finishLoading();
        };

        const handleAuthUser = async (user: User | null) => {
            const runId = ++authRunId;
            if (!isMounted) return;

            setCurrentUser(user);
            setError(null);
            setProfileResolved(!user);

            if (user) {
                const isSignup = window.location.pathname === '/signup';
                scheduleSoftRelease(isSignup ? 2200 : 4200);

                if (!user.email_confirmed_at && !isSignup) {
                    setError('Please verify your email address to access your account.');
                    void authService.signOut().catch(() => undefined);
                    finishLoading();
                    return;
                }

                if (!isSignup) {
                    setLoading(true);
                }

                const alreadySubscribedToUser =
                    activeRoleSubscriptionUserId === user.id &&
                    typeof unsubscribeRole === 'function';

                if (alreadySubscribedToUser) {
                    clearSubscriptions(user.id);
                    if (resolvedCustomerDataUserId === user.id || isSignup) {
                        setProfileResolved(true);
                        finishLoading();
                    }
                    return;
                }

                clearSubscriptions();
                unsubscribeRole = authService.subscribeToAccountRole(user.id, (role) => {
                    if (!isMounted || runId !== authRunId) return;

                    if (role === 'customer') {
                        activeRoleSubscriptionUserId = user.id;
                        unsubscribeUser = userService.subscribeToUserDocument(user.id, (data) => {
                            if (!isMounted || runId !== authRunId) return;
                            activeUserSubscriptionUserId = user.id;
                            resolvedCustomerDataUserId = user.id;
                            setProfileResolved(true);
                            setUserData(data);
                            if (data?.status === 'blocked') {
                                setError('Your account has been blocked.');
                                setCurrentUser(null);
                                void authService.signOut().catch(() => undefined);
                            }
                            finishLoading();
                        });
                    } else if (window.location.pathname === '/signup') {
                        setProfileResolved(true);
                        finishLoading();
                    } else if (!role) {
                        console.warn('[CustomerAuth] Account role not available yet. Continuing with limited startup state.');
                        setProfileResolved(true);
                        finishLoading();
                    } else if (role && role !== 'customer') {
                        setError('Unauthorized access. Please use the correct app.');
                        setCurrentUser(null);
                        setProfileResolved(true);
                        void authService.signOut().catch(() => undefined);
                        finishLoading();
                    }
                });
                activeRoleSubscriptionUserId = user.id;
            } else {
                clearSubscriptions();
                setUserData(null);
                setProfileResolved(true);
                finishLoading();
            }
        };

        bootstrapTimeout = setTimeout(() => {
            if (!isMounted) return;
            failBootstrap('App startup timed out. Continuing with the last known session state.');
        }, 9000);

        const unsubscribeAuth = authService.onAuthChange((user) => {
            receivedInitialAuthEvent = true;
            void handleAuthUser(user);
        });

        const fallbackBootstrapTimeout = setTimeout(() => {
            if (!isMounted || receivedInitialAuthEvent) return;

            void authService.getCurrentUser()
                .then((user) => {
                    if (receivedInitialAuthEvent) return;
                    void handleAuthUser(user || authService.getCachedCurrentUser());
                })
                .catch(() => {
                    if (receivedInitialAuthEvent) return;
                    const cachedUser = authService.getCachedCurrentUser();
                    if (cachedUser) {
                        void handleAuthUser(cachedUser);
                    }
                });
        }, 1500);

        return () => {
            isMounted = false;
            if (bootstrapTimeout) {
                clearTimeout(bootstrapTimeout);
            }
            if (softReleaseTimer) {
                clearTimeout(softReleaseTimer);
            }
            if (fallbackBootstrapTimeout) {
                clearTimeout(fallbackBootstrapTimeout);
            }
            unsubscribeAuth();
            clearSubscriptions();
        };
    }, []);

    useEffect(() => {
        if (currentUser) {
            if (Capacitor.isNativePlatform()) {
                void pushService.register();
            } else {
                void browserNotificationService.requestPermission();
            }
        } else {
            void pushService.unregister();
        }
    }, [currentUser]);

    const value = {
        currentUser,
        userData,
        loading,
        profileResolved,
        error
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
