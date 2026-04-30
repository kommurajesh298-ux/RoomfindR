import React, { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";

import { userService } from "../services/user.service";
import { ownerService } from "../services/owner.service";
import { authService } from "../services/auth.service";
import { pushService } from "../services/push.service";
import { browserNotificationService } from "../services/browser-notification.service";
import type { UserData } from "../types/user.types";
import type { Owner } from "../types/owner.types";
import LoadingOverlay from "../components/common/LoadingOverlay";
import { resolveOwnerVerificationState } from "../utils/ownerVerification";

import { AuthContext } from "../hooks/useAuth";
import type { ShimmedUser } from "../hooks/useAuth";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [currentUser, setCurrentUser] = useState<ShimmedUser | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [ownerData, setOwnerData] = useState<Owner | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let authRunId = 0;
    let unsubscribeUser: (() => void) | undefined;
    let unsubscribeOwner: (() => void) | undefined;
    let unsubscribeRole: (() => void) | undefined;
    let bootstrapTimeout: ReturnType<typeof setTimeout> | undefined;

    const clearSubscriptions = () => {
      if (unsubscribeUser) unsubscribeUser();
      if (unsubscribeOwner) unsubscribeOwner();
      if (unsubscribeRole) unsubscribeRole();
      unsubscribeUser = undefined;
      unsubscribeOwner = undefined;
      unsubscribeRole = undefined;
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
      console.error(`[OwnerAuth] ${message}`);
      setCurrentUser(null);
      setUserData(null);
      setOwnerData(null);
      setError(message);
      void authService.signOut().catch(() => undefined);
      finishLoading();
    };

    const handleAuthUser = async (user: User | null) => {
      const runId = ++authRunId;
      if (!isMounted) return;

      const shimmed = user
        ? ({
            ...user,
            uid: user.id,
            displayName: user.user_metadata?.name || null,
            phoneNumber: user.user_metadata?.phone || null,
            photoURL: user.user_metadata?.avatar_url || null,
            emailVerified: !!user.email_confirmed_at,
          } as ShimmedUser)
        : null;

      setCurrentUser(shimmed);
      setError(null);

      clearSubscriptions();

      if (user) {
        const isSignup = window.location.pathname === "/signup";
        if (!isSignup) {
          setLoading(true);
        }

        const subscribeOwnerData = () => {
          unsubscribeUser = userService.subscribeToUserDocument(
            user.id,
            (data) => {
              if (!isMounted || runId !== authRunId) return;
              setUserData(data);
            },
          );

          unsubscribeOwner = ownerService.subscribeToOwner(
            user.id,
            (data) => {
              if (!isMounted || runId !== authRunId) return;
              const owner = data as Owner | null;
              setOwnerData(owner);
              const { ownerActive, requiresAdminApproval } =
                resolveOwnerVerificationState(owner);

              setError(
                ownerActive
                  ? null
                  : requiresAdminApproval
                    ? "Your bank account is verified. Wait for admin approval to activate your account."
                    : "Complete bank verification to activate your account.",
              );
              finishLoading();
            },
          );
        };

        let roleChecked = false;
        const checkTimeout = setTimeout(() => {
          if (!roleChecked && !isSignup && isMounted && runId === authRunId) {
            failBootstrap("Account verification timed out. Please refresh and sign in again.");
          }
        }, 18000);

        unsubscribeRole = authService.subscribeToAccountRole(
          user.id,
          async (role) => {
            if (!isMounted || runId !== authRunId) return;

            if (role === "owner") {
              roleChecked = true;
              clearTimeout(checkTimeout);
              setError(null);

              if (!isSignup) {
                const accountStatus = await authService.getAccountStatus(user.id);
                if (accountStatus === "blocked") {
                  setError("Your account has been blocked. Please contact admin.");
                  await authService.signOut();
                  setLoading(false);
                  return;
                }
              }

              subscribeOwnerData();
            } else if (!role && !isSignup) {
              roleChecked = true;
              clearTimeout(checkTimeout);
              failBootstrap("Unable to verify owner access. Please sign in again.");
            } else if (role && role !== "owner") {
              roleChecked = true;
              clearTimeout(checkTimeout);
              setError(
                "Unauthorized access. This portal is for Property Owners only.",
              );
              setCurrentUser(null);
              void authService.signOut().catch(() => undefined);
              finishLoading();
            }
          },
        );
      } else {
        setUserData(null);
        setOwnerData(null);
        finishLoading();
      }
    };

    bootstrapTimeout = setTimeout(() => {
      if (!isMounted) return;
      failBootstrap("App startup timed out. Please refresh and sign in again.");
    }, 25000);

    const unsubscribeAuth = authService.onAuthChange((user) => {
      void handleAuthUser(user);
    });

    void authService.getCurrentUser()
      .then((user) => {
        void handleAuthUser(user);
      })
      .catch((authError) => {
        console.error("[OwnerAuth] Initial user bootstrap failed:", authError);
        failBootstrap("Unable to restore your session. Please sign in again.");
      });

    return () => {
      isMounted = false;
      if (bootstrapTimeout) {
        clearTimeout(bootstrapTimeout);
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
  }, [currentUser?.uid]);

  const value = {
    currentUser,
    userData,
    ownerData,
    loading,
    error,
    signOut: () => authService.signOut(),
  };

  if (loading) {
    return <LoadingOverlay message="Initializing..." />;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
