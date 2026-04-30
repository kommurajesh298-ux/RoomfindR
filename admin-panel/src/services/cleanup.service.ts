import { supabase } from './supabase-config';
import { auditService } from './audit.service';

export const cleanupService = {
    runGlobalAudit: async (adminId: string, adminEmail: string) => {
        // In Supabase, the account/role mapping is centralized.
        // Audit is mostly about finding inconsistencies in profiles.
        const { data: accounts } = await supabase.from('accounts').select('id, role');
        const migrationCount = 0, deletionCount = 0;
        await auditService.logAction('global_audit', adminId, adminEmail, { status: 'complete', count: accounts?.length });
        return { deletionCount, migrationCount };
    }
};
