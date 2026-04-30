import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AndroidDevice = {
    serial: string;
    state: string;
    model?: string;
};

export type AndroidAutomationEnvironment = {
    adbPath: string | null;
    devices: AndroidDevice[];
};

const commandOptions = {
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
};

const tryExec = async (command: string, args: string[] = []) => {
    try {
        const result = await execFileAsync(command, args, commandOptions);
        return {
            ok: true,
            stdout: String(result.stdout || ''),
            stderr: String(result.stderr || ''),
        };
    } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; message?: string };
        return {
            ok: false,
            stdout: String(failure.stdout || ''),
            stderr: String(failure.stderr || failure.message || ''),
        };
    }
};

const resolveAdbBinary = async (): Promise<string | null> => {
    const envAdb = String(process.env.ADB_PATH || '').trim();
    const candidates = [
        envAdb,
        'adb',
        path.resolve(process.cwd(), 'platform-tools', 'adb.exe'),
        path.resolve(process.cwd(), 'android-sdk', 'platform-tools', 'adb.exe'),
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (candidate.endsWith('.exe') && fs.existsSync(candidate)) {
            return candidate;
        }

        const probe = await tryExec(candidate, ['version']);
        if (probe.ok) {
            return candidate;
        }
    }

    const whereProbe = await tryExec('where.exe', ['adb']);
    const discovered = whereProbe.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);

    return discovered || null;
};

export const getAndroidAutomationEnvironment = async (): Promise<AndroidAutomationEnvironment> => {
    const adbPath = await resolveAdbBinary();
    if (!adbPath) {
        return { adbPath: null, devices: [] };
    }

    const list = await tryExec(adbPath, ['devices', '-l']);
    const devices = list.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('List of devices attached'))
        .map((line) => {
            const [serial, state, ...rest] = line.split(/\s+/);
            const modelEntry = rest.find((entry) => entry.startsWith('model:'));
            return {
                serial,
                state,
                model: modelEntry?.replace(/^model:/, ''),
            };
        })
        .filter((device) => Boolean(device.serial));

    return { adbPath, devices };
};

const runAdb = async (adbPath: string, serial: string, args: string[]) => {
    const scopedArgs = serial ? ['-s', serial, ...args] : args;
    const result = await tryExec(adbPath, scopedArgs);
    if (!result.ok) {
        throw new Error(result.stderr || `ADB command failed: ${scopedArgs.join(' ')}`);
    }
    return result.stdout;
};

export const installApkOnAndroid = async (adbPath: string, serial: string, apkPath: string) => {
    if (!fs.existsSync(apkPath)) {
        throw new Error(`APK not found: ${apkPath}`);
    }

    await runAdb(adbPath, serial, ['install', '-r', apkPath]);
};

export const launchAndroidPackage = async (adbPath: string, serial: string, packageName: string) => {
    await runAdb(adbPath, serial, ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
};

export const openAndroidDeepLink = async (adbPath: string, serial: string, url: string) => {
    await runAdb(adbPath, serial, ['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url]);
};

export const getFocusedAndroidPackage = async (adbPath: string, serial: string) => {
    const output = await runAdb(adbPath, serial, ['shell', 'dumpsys', 'window', 'windows']);
    const matches = [
        /mCurrentFocus.+?\s([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.\$]+/m,
        /mFocusedApp.+?\s([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.\$]+/m,
    ];

    for (const matcher of matches) {
        const match = output.match(matcher);
        if (match?.[1]) {
            return match[1];
        }
    }

    return '';
};

export const getDefaultApkPaths = () => ({
    customer: [
        path.resolve(process.cwd(), 'apk-downloads', 'customer-app', 'customer-app-release.apk'),
        path.resolve(process.cwd(), 'customer-app', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    ].find((candidate) => fs.existsSync(candidate)) || path.resolve(process.cwd(), 'apk-downloads', 'customer-app', 'customer-app-release.apk'),
    owner: [
        path.resolve(process.cwd(), 'apk-downloads', 'owner-app', 'owner-app-release.apk'),
        path.resolve(process.cwd(), 'owner-app', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    ].find((candidate) => fs.existsSync(candidate)) || path.resolve(process.cwd(), 'apk-downloads', 'owner-app', 'owner-app-release.apk'),
});
