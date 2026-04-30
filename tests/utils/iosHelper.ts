import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const tryExec = async (command: string, args: string[] = []) => {
    try {
        const result = await execFileAsync(command, args, {
            timeout: 30000,
            windowsHide: true,
            maxBuffer: 1024 * 1024 * 8,
        });
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

export const getIosAutomationEnvironment = async () => {
    const customerProject = path.resolve(process.cwd(), 'customer-app', 'ios', 'App');
    const ownerProject = path.resolve(process.cwd(), 'owner-app', 'ios', 'App');
    const xcrunProbe = await tryExec('xcrun', ['simctl', 'list', 'devices', 'booted', '--json']);

    return {
        xcrunAvailable: xcrunProbe.ok,
        customerProjectExists: fs.existsSync(customerProject),
        ownerProjectExists: fs.existsSync(ownerProject),
        customerProject,
        ownerProject,
    };
};

export const openIosDeepLink = async (url: string) => {
    const result = await tryExec('xcrun', ['simctl', 'openurl', 'booted', url]);
    if (!result.ok) {
        throw new Error(result.stderr || `Failed to open iOS URL ${url}`);
    }
};
