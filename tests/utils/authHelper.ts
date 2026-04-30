import type { Page } from '@playwright/test';
import { loginHelper, logoutHelper } from '../helpers/loginHelper';
import { signupHelper } from '../helpers/signupHelper';
import { createTestIdentity, type TestIdentity, type TestRole } from '../data/test-users';
import { getAdminHelper, roleBaseUrl } from './apiHelper';

export const createAuthHelper = (page: Page) => {
    const admin = getAdminHelper();

    return {
        createIdentity(prefix: string, role: TestRole, overrides: Partial<TestIdentity> = {}) {
            return createTestIdentity(prefix, role, overrides);
        },

        async signup(role: TestRole, identity: TestIdentity, completeWithBypass = false) {
            return signupHelper(page, admin, {
                role,
                identity,
                completeWithBypass,
            });
        },

        async login(role: TestRole, options?: { email?: string; password?: string; mode?: 'bypass' | 'ui'; postLoginPath?: string }) {
            return loginHelper(page, {
                role,
                email: options?.email,
                password: options?.password,
                mode: options?.mode,
                postLoginPath: options?.postLoginPath,
                baseUrl: roleBaseUrl(role),
            });
        },

        async logout(role: TestRole) {
            return logoutHelper(page, {
                role,
                baseUrl: roleBaseUrl(role),
            });
        },
    };
};
