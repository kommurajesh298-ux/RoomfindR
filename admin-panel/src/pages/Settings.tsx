import React, { useState, useEffect } from 'react';
import SettingCard from '../components/settings/SettingCard';
import ToggleSwitch from '../components/settings/ToggleSwitch';
import { SettingsService } from '../services/settings.service';
import type { SystemSettings } from '../types/settings.types';
import { useAuth } from '../hooks/useAuth';
import { FiDollarSign, FiToggleLeft, FiActivity, FiServer } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { cleanupService } from '../services/cleanup.service';

interface AuditLog {
    id: string;
    action: string;
    details: string;
    settingKey: string;
    oldValue: string | number | boolean;
    newValue: string | number | boolean;
    timestamp: { toDate: () => Date } | string | null;
    adminEmail: string;
}

const resolveAuditLogDate = (timestamp: AuditLog['timestamp']) => {
    if (!timestamp) return null;
    if (typeof timestamp === 'string') {
        const parsed = new Date(timestamp);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return timestamp.toDate();
};

const Settings: React.FC = () => {
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

    // Form States
    const [advanceAmount, setAdvanceAmount] = useState<string>('');
    const [taxRate, setTaxRate] = useState<string>('');
    const [savingPricing, setSavingPricing] = useState(false);

    const { admin } = useAuth();

    useEffect(() => {
        let isMounted = true;
        setLoading(true);

        const unsubscribeSettings = SettingsService.getSettings((data) => {
            if (isMounted) {
                setSettings(data as unknown as SystemSettings);
                setAdvanceAmount(String((data as unknown as SystemSettings).globalAdvanceAmount || 0));
                setTaxRate(String((data as unknown as SystemSettings).taxRate || 0));
                setLoading(false);
            }
        });

        // Real-time Audit Logs
        const unsubscribeAudit = SettingsService.subscribeToAuditLogs((logs) => {
            if (isMounted) {
                setAuditLogs(logs as unknown as AuditLog[]);
            }
        });

        return () => {
            isMounted = false;
            unsubscribeSettings.unsubscribe();
            unsubscribeAudit();
        };
    }, []);

    const handleFeatureToggle = async (feature: string, enabled: boolean) => {
        if (!admin || !settings) return;
        try {
            await SettingsService.toggleFeature(feature, enabled, admin.uid, admin.email);
            toast.success(`${feature} ${enabled ? 'enabled' : 'disabled'}`);
        } catch (error) {
            console.error(error);
            toast.error(`Failed to update ${feature}`);
        }
    };

    const handleMaintenanceToggle = async (enabled: boolean) => {
        if (!admin || !settings) return;
        if (enabled && !window.confirm("Are you sure you want to enable Maintenance Mode? Apps will be inaccessible.")) {
            return;
        }
        try {
            await SettingsService.toggleMaintenanceMode(enabled, admin.uid, admin.email);
            if (enabled) toast.loading("Maintenance Mode Active", { duration: 3000 });
            else toast.success("Maintenance Mode Inactive");
        } catch (error) {
            console.error(error);
            toast.error("Failed to toggle maintenance mode");
        }
    };

    const handlePricingSave = async () => {
        if (!admin || !settings) return;
        setSavingPricing(true);
        try {
            const newAdvance = Number(advanceAmount);
            const newTax = Number(taxRate);

            if (isNaN(newAdvance) || newAdvance < 0) throw new Error("Invalid advance amount");
            if (isNaN(newTax) || newTax < 0 || newTax > 100) throw new Error("Invalid tax rate");

            if (newAdvance !== settings.globalAdvanceAmount) {
                await SettingsService.updateAdvanceAmount(newAdvance, admin.uid, admin.email);
            }
            if (newTax !== settings.taxRate) {
                await SettingsService.updateTaxRate(newTax, admin.uid, admin.email);
            }
            toast.success("Pricing settings saved");

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : "Failed to save pricing";
            toast.error(errorMessage);
        } finally {
            setSavingPricing(false);
        }
    };

    const handleGlobalAudit = async () => {
        if (!admin) return;
        if (!window.confirm("CRITICAL: This will PERMANENTLY delete lower-priority records for any duplicate emails or phone numbers. Proceed?")) {
            return;
        }

        const tid = toast.loading("Running global audit...");
        try {
            const result = await cleanupService.runGlobalAudit(admin.uid, admin.email);
            toast.success(`Audit Success: ${result.deletionCount} duplicates removed, ${result.migrationCount} accounts synced.`, { id: tid });
        } catch (error: unknown) {
            console.error('Audit failed:', error);
            toast.error("Audit process failed. Check console for details.", { id: tid });
        }
    };

    if (loading) {
        return <div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading settings...</div>;
    }

    return (
        <div className="space-y-8 max-w-5xl mx-auto">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-slate-900 mb-1">System Settings</h1>
                <p className="text-slate-500">Configure platform-wide settings and features</p>
            </div>

            {/* Maintenance Mode */}
            <SettingCard title="System Status" icon={FiServer}>
                <ToggleSwitch
                    label="Maintenance Mode"
                    description="When enabled, customer and owner apps will show 'Under Maintenance' page. Admin panel remains accessible."
                    enabled={settings?.maintenanceMode || false}
                    onChange={handleMaintenanceToggle}
                    danger
                />
                <div className={`mt-2 text-sm font-bold ${settings?.maintenanceMode ? 'text-red-500' : 'text-blue-500'}`}>
                    Currently: {settings?.maintenanceMode ? 'ACTIVE [ON]' : 'Inactive [OFF]'}
                </div>
            </SettingCard>

            {/* Database Tools */}
            <SettingCard title="Database Tools" icon={FiServer}>
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl border border-amber-100">
                        <div>
                            <p className="text-sm font-bold text-amber-900">Global Email & Phone Audit</p>
                            <p className="text-xs text-amber-700 mt-1">
                                Scans all collections, removes duplicate emails/phones based on priority (Admin &gt; Owner &gt; Customer), and syncs roles to the master auth source.
                            </p>
                        </div>
                        <button
                            onClick={handleGlobalAudit}
                            disabled={savingPricing}
                            className="bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-amber-700 transition-colors shadow-sm disabled:opacity-50"
                        >
                            Run Audit
                        </button>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-red-50 rounded-xl border border-red-100 opacity-50 grayscale pointer-events-none">
                        <div>
                            <p className="text-sm font-bold text-red-900">Wipe Full Database</p>
                            <p className="text-xs text-red-700 mt-1">Permanently delete all records from all collections. (Requires Super Admin)</p>
                        </div>
                        <button className="bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-bold">Wipe Data</button>
                    </div>
                </div>
            </SettingCard>

            {/* Danger Zone removed */}

            {/* Pricing */}
            <SettingCard title="Pricing configuration" icon={FiDollarSign}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Global Advance Amount (₹)</label>
                        <input
                            type="number"
                            name="globalAdvanceAmount"
                            value={advanceAmount}
                            onChange={(e) => setAdvanceAmount(e.target.value)}
                            className="w-full border border-slate-300 rounded-lg p-2 focus:border-[var(--rf-color-action)] outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Tax Rate (%)</label>
                        <input
                            type="number"
                            name="taxRate"
                            value={taxRate}
                            onChange={(e) => setTaxRate(e.target.value)}
                            className="w-full border border-slate-300 rounded-lg p-2 focus:border-[var(--rf-color-action)] outline-none"
                        />
                    </div>
                </div>
                <div className="flex justify-end">
                    <button
                        onClick={handlePricingSave}
                        disabled={savingPricing}
                        className="bg-[var(--rf-color-action)] text-white px-6 py-2 rounded-lg font-medium hover:bg-[var(--rf-color-action-hover)] disabled:opacity-50 transition-colors"
                    >
                        {savingPricing ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </SettingCard>

            {/* Features */}
            <SettingCard title="Feature Flags" icon={FiToggleLeft}>
                <div className="divide-y divide-slate-100">
                    <ToggleSwitch
                        label="Enable Chat"
                        description="Controls chat functionality across customer and owner apps"
                        enabled={settings?.features.chat || false}
                        onChange={(val) => handleFeatureToggle('chat', val)}
                    />
                    <ToggleSwitch
                        label="Enable Monthly Payments"
                        description="Allows customers to pay rent explicitly via the app"
                        enabled={settings?.features.monthlyPayments || false}
                        onChange={(val) => handleFeatureToggle('monthlyPayments', val)}
                    />
                    <ToggleSwitch
                        label="Enable Food Menu"
                        description="Shows food menu tab on property details pages"
                        enabled={settings?.features.foodMenu || false}
                        onChange={(val) => handleFeatureToggle('foodMenu', val)}
                    />
                </div>
            </SettingCard>

            {/* Audit Logs */}
            <SettingCard title="Recent Setting Changes" icon={FiActivity}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500">
                            <tr>
                                <th className="p-3 font-medium">Time</th>
                                <th className="p-3 font-medium">Setting</th>
                                <th className="p-3 font-medium">Old Value</th>
                                <th className="p-3 font-medium">New Value</th>
                                <th className="p-3 font-medium">Admin</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {auditLogs.length > 0 ? auditLogs.map((log) => (
                                <tr key={log.id} className="hover:bg-slate-50">
                                    <td className="p-3 text-slate-500">
                                        {resolveAuditLogDate(log.timestamp)
                                            ? formatDistanceToNow(resolveAuditLogDate(log.timestamp) as Date, { addSuffix: true })
                                            : 'N/A'}
                                    </td>
                                    <td className="p-3 font-mono text-xs">{log.settingKey}</td>
                                    <td className="p-3 text-red-500">{String(log.oldValue)}</td>
                                    <td className="p-3 text-blue-500">{String(log.newValue)}</td>
                                    <td className="p-3 text-slate-600">{log.adminEmail}</td>
                                </tr>
                            )) : (
                                <tr><td colSpan={5} className="p-4 text-center text-slate-400">No logs found</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </SettingCard>
        </div>
    );
};

export default Settings;

