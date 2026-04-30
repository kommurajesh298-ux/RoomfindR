// Removed legacy firebase imports

export interface SystemSettings {
    maintenanceMode: boolean;
    paymentGatewayEnabled: boolean;
    globalAdvanceAmount: number;
    taxRate: number;
    features: {
        chat: boolean;
        monthlyPayments: boolean;
        foodMenu: boolean;
    };
}

export interface SettingChange {
    settingKey: string;
    oldValue: unknown;
    newValue: unknown;
    changedBy: string;
    timestamp: string;
}
