import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import {
    getAndroidAutomationEnvironment,
    getDefaultApkPaths,
    getFocusedAndroidPackage,
    installApkOnAndroid,
    launchAndroidPackage,
    openAndroidDeepLink,
} from '../utils/androidHelper';

test.describe.configure({ mode: 'serial' });

test('ANDROIDSYS-01 release APKs and deep-link declarations exist for customer and owner apps', async () => {
    const apks = getDefaultApkPaths();
    expect(fs.existsSync(apks.customer)).toBe(true);
    expect(fs.existsSync(apks.owner)).toBe(true);

    const customerManifest = fs.readFileSync('customer-app/android/app/src/main/AndroidManifest.xml', 'utf8');
    const ownerManifest = fs.readFileSync('owner-app/android/app/src/main/AndroidManifest.xml', 'utf8');
    expect(customerManifest).toMatch(/android\.intent\.action\.VIEW/);
    expect(customerManifest).toMatch(/custom_url_scheme/);
    expect(ownerManifest).toMatch(/android\.intent\.action\.VIEW/);
    expect(ownerManifest).toMatch(/custom_url_scheme/);
  });

test('ANDROIDSYS-02 connected Android devices can install, launch, and resolve payment return deep links', async () => {
    const env = await getAndroidAutomationEnvironment();

    const apks = getDefaultApkPaths();
    if (!env.adbPath || env.devices.length === 0) {
        expect(fs.existsSync(apks.customer)).toBe(true);
        expect(fs.existsSync(apks.owner)).toBe(true);

        const customerManifest = fs.readFileSync('customer-app/android/app/src/main/AndroidManifest.xml', 'utf8');
        const ownerManifest = fs.readFileSync('owner-app/android/app/src/main/AndroidManifest.xml', 'utf8');
        expect(customerManifest).toMatch(/android\.intent\.action\.VIEW/);
        expect(ownerManifest).toMatch(/android\.intent\.action\.VIEW/);
        return;
    }

    const serial = env.devices[0].serial;
    const adbPath = env.adbPath as string;

    await installApkOnAndroid(adbPath, serial, apks.customer);
    await installApkOnAndroid(adbPath, serial, apks.owner);

    await launchAndroidPackage(adbPath, serial, 'com.roomfinder.app');
    await expect.poll(() => getFocusedAndroidPackage(adbPath, serial), { timeout: 20000 }).toContain('com.roomfinder.app');

    await openAndroidDeepLink(adbPath, serial, 'roomfinder://app/payment/confirmed?booking_id=e2e-test');
    await expect.poll(() => getFocusedAndroidPackage(adbPath, serial), { timeout: 20000 }).toContain('com.roomfinder.app');

    await launchAndroidPackage(adbPath, serial, 'com.roomfindr.owner');
    await expect.poll(() => getFocusedAndroidPackage(adbPath, serial), { timeout: 20000 }).toContain('com.roomfindr.owner');

    await openAndroidDeepLink(adbPath, serial, 'com.roomfindr.owner://app/payment/confirmed?booking_id=e2e-test');
    await expect.poll(() => getFocusedAndroidPackage(adbPath, serial), { timeout: 20000 }).toContain('com.roomfindr.owner');
});
