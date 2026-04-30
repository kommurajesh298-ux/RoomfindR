import { supabase } from '../services/supabase-config';
import { captureMonitoringError } from './monitoring';

export const initializeSettings = async () => {
    try {
        const { data: existing } = await supabase.from('settings').select('id').eq('id', 'site').maybeSingle();

        if (!existing) {
            // Initializing system settings
            await supabase.from('settings').insert({
                id: 'site',
                value: {
                    maintenanceMode: false,
                    paymentGatewayEnabled: false,
                    globalAdvanceAmount: 500,
                    taxRate: 18,
                    features: {
                        chat: true,
                        monthlyPayments: true,
                        foodMenu: true
                    }
                },
                updated_at: new Date().toISOString()
            });
            // System settings initialized
        }
    } catch (error) {
        captureMonitoringError(error, { stage: 'initializeSettings' });
    }
};
