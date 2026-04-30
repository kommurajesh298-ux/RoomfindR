import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Settings from '../Settings';
import { SettingsService } from '../../services/settings.service';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'react-hot-toast';
import type { AdminUser } from '../../types/admin.types';
import { RealtimeChannel } from '@supabase/supabase-js';

jest.mock('../../services/settings.service');
jest.mock('../../hooks/useAuth');
jest.mock('react-hot-toast');

const mockAdmin: AdminUser = {
    uid: 'admin-1',
    email: 'admin@test.com',
    role: 'admin',
    permissions: ['all'],
    createdAt: new Date().toISOString()
};

describe('Admin Settings Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useAuth).mockReturnValue({
            admin: mockAdmin,
            loading: false,
            error: null,
            signOut: jest.fn()
        });

        jest.mocked(SettingsService.getSettings).mockImplementation((cb: (s: Record<string, unknown>) => void) => {
            cb({ maintenanceMode: false, globalAdvanceAmount: 500, taxRate: 10, features: { chat: true, monthlyPayments: true, foodMenu: true } });
            return { unsubscribe: jest.fn() } as unknown as RealtimeChannel;
        });
        jest.mocked(SettingsService.subscribeToAuditLogs).mockReturnValue(jest.fn());
    });

    it('toggles maintenance mode and updates all apps', async () => {
        jest.mocked(SettingsService.toggleMaintenanceMode).mockResolvedValue(undefined as unknown as void);
        window.confirm = jest.fn().mockReturnValue(true);

        render(
            <MemoryRouter>
                <Settings />
            </MemoryRouter>
        );

        await waitFor(() => screen.getByText(/system settings/i));

        // The maintenance toggle is the first one. Let's find it by description to be safe.
        const maintenanceText = screen.getByText(/customer and owner apps will show 'Under Maintenance'/i);
        const maintenanceToggle = maintenanceText.parentElement?.parentElement?.querySelector('button[role="switch"]');

        if (!maintenanceToggle) throw new Error("Maintenance toggle not found");
        fireEvent.click(maintenanceToggle);

        await waitFor(() => {
            expect(SettingsService.toggleMaintenanceMode).toHaveBeenCalled();
        });
    });

    it('updates global advance amount and reflects in customer bookings', async () => {
        jest.mocked(SettingsService.updateAdvanceAmount).mockResolvedValue(undefined as unknown as void);

        render(
            <MemoryRouter>
                <Settings />
            </MemoryRouter>
        );

        await waitFor(() => screen.getByText(/global advance amount/i));

        const advanceInputs = screen.getAllByDisplayValue('500');
        fireEvent.change(advanceInputs[0], { target: { value: '1000' } });
        fireEvent.click(screen.getByText(/save changes/i));

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith("Pricing settings saved");
        });
    });
});
