import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Owners from '../Owners';
import { ownerService } from '../../services/owner.service';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'react-hot-toast';
import type { AdminUser } from '../../types/admin.types';

jest.mock('../../services/owner.service');
jest.mock('../../hooks/useAuth');
jest.mock('react-hot-toast');

const mockAdmin: AdminUser = {
    uid: 'admin-1',
    email: 'admin@test.com',
    role: 'admin',
    permissions: ['all'],
    createdAt: new Date().toISOString()
};

const mockOwner = {
    id: 'o1',
    name: 'Test Owner',
    verified: false,
    bankVerificationStatus: 'verified',
    email: 'test@example.com',
    verification_status: 'pending' as const,
    created_at: new Date().toISOString(),
    phone: '1234567890',
    bankDetails: {
        bankName: 'Test Bank',
        accountNumber: '123',
        ifscCode: 'IFSC',
        accountHolderName: 'Test Owner'
    },
    licenseDocUrl: 'http://test.com/doc',
    propertiesCount: 0
};

describe('Admin Owners Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (useAuth as jest.Mock).mockReturnValue({
            admin: mockAdmin,
            loading: false,
            error: null,
            signOut: jest.fn()
        });
        (ownerService.getAllOwners as jest.Mock).mockResolvedValue([mockOwner]);
        (ownerService.getOwnerVerificationOverview as jest.Mock).mockResolvedValue({
            verification: null,
            history: [],
        });
    });

    it('displays pending owner verifications', async () => {
        render(
            <MemoryRouter>
                <Owners />
            </MemoryRouter>
        );

        const ownerNames = await screen.findAllByText('Test Owner');
        expect(ownerNames.length).toBeGreaterThan(0);
    });

    it('approves owner', async () => {
        (ownerService.approveOwner as jest.Mock).mockResolvedValue(undefined as unknown as void);

        render(
            <MemoryRouter>
                <Owners />
            </MemoryRouter>
        );

        await screen.findAllByText('Test Owner');

        // View Docs to open modal
        const viewDocsBtn = await screen.findByText(/View Docs/i);
        fireEvent.click(viewDocsBtn);

        // Wait for modal and click approve button (it's text "Approve Owner" in the modal footer)
        const approveBtn = await screen.findByText(/Approve Owner/i);
        await act(async () => {
            fireEvent.click(approveBtn);
        });

        // Final confirmation button in ApprovalModal (text "Approve Partner")
        const confirmBtn = await screen.findByText(/Approve Partner/i);
        await act(async () => {
            fireEvent.click(confirmBtn);
        });

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Owner approved successfully');
        });
    });

    it('disables reset bank details after successful Rs 1 verification', async () => {
        render(
            <MemoryRouter>
                <Owners />
            </MemoryRouter>
        );

        const resetButton = await screen.findByTitle(/Verified Rs 1 bank accounts cannot be reset/i);
        expect(resetButton).toBeDisabled();

        const viewDocsBtn = await screen.findByText(/View Docs/i);
        fireEvent.click(viewDocsBtn);

        const modalResetButton = await screen.findByRole('button', { name: /Reset Bank Details/i });
        expect(modalResetButton).toBeDisabled();
    });

    it('rejects owner with reason', async () => {
        (ownerService.rejectOwner as jest.Mock).mockResolvedValue(undefined as unknown as void);

        render(
            <MemoryRouter>
                <Owners />
            </MemoryRouter>
        );

        await screen.findAllByText('Test Owner');

        // Click Reject button in OwnerCard (it has a title "Reject Owner")
        const rejectIconBtn = await screen.findByTitle(/Reject Owner/i);
        fireEvent.click(rejectIconBtn);

        // Wait for RejectionModal and select a reason
        const reasonSelect = await screen.findByDisplayValue(/Choose a reason/i);
        fireEvent.change(reasonSelect, { target: { value: 'Invalid license document' } });

        // Click final confirm button (text "Confirm Rejection")
        const confirmBtn = await screen.findByText(/Confirm Rejection/i);
        await act(async () => {
            fireEvent.click(confirmBtn);
        });

        await waitFor(() => {
            expect(ownerService.rejectOwner).toHaveBeenCalledWith(mockOwner.id);
        });
    });
});
