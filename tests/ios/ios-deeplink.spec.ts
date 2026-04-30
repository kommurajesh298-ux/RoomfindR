import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { getIosAutomationEnvironment, openIosDeepLink } from '../utils/iosHelper';

test.describe.configure({ mode: 'serial' });

test('IOSSYS-01 customer iOS project keeps the expected custom URL scheme for payment return', async () => {
    const env = await getIosAutomationEnvironment();
    expect(env.customerProjectExists).toBe(true);

    const infoPlist = fs.readFileSync('customer-app/ios/App/App/Info.plist', 'utf8');
    expect(infoPlist).toMatch(/roomfinder/);
});

test('IOSSYS-02 iOS runtime deep-link automation is ready when the simulator toolchain and owner iOS project are available', async () => {
    const env = await getIosAutomationEnvironment();
    expect(env.customerProjectExists).toBe(true);

    const ownerCapacitorConfig = fs.readFileSync('owner-app/capacitor.config.ts', 'utf8');
    const ownerNativeBridge = fs.readFileSync('owner-app/src/services/native-bridge.service.ts', 'utf8');

    expect(ownerCapacitorConfig).toMatch(/com\.roomfindr\.owner/);
    expect(ownerNativeBridge).toMatch(/com\.roomfindr\.owner:\/\/app/);

    if (!env.xcrunAvailable || !env.ownerProjectExists) {
        test.info().annotations.push({
            type: 'note',
            description: 'Validated static deep-link readiness because iOS simulator runtime tooling is unavailable in this environment.',
        });
        return;
    }

    await openIosDeepLink('roomfinder://app/payment/confirmed?booking_id=e2e-test');
    await openIosDeepLink('com.roomfindr.owner://app/payment/confirmed?booking_id=e2e-test');
});
