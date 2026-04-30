// Removed legacy firebase imports

export interface AuditLog {
    id: string;
    action: string;
    adminId: string;
    adminEmail: string;
    timestamp: string;
    details: Record<string, unknown>;
    oldValue?: unknown;
    newValue?: unknown;
    targetId?: string;
}
