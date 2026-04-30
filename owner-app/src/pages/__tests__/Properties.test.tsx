import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Properties from '../Properties';
import { propertyService } from '../../services/property.service';
import { useAuth } from '../../hooks/useAuth';
import { useOwner } from '../../hooks/useOwner';
import toast from 'react-hot-toast';

jest.mock('../../services/property.service');
jest.mock('../../hooks/useAuth');
jest.mock('../../hooks/useOwner');
jest.mock('react-hot-toast');

describe('Owner Properties Page', () => {
    const mockProperty = {
        propertyId: 'prop-1',
        title: 'Test Property',
        status: 'draft',
        published: false,
        pricePerMonth: 5000,
        rooms_available: 5
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('prevents publishing when owner is not verified', async () => {
        (useAuth as jest.Mock).mockReturnValue({ currentUser: { uid: 'owner-1' }, loading: false });
        (useOwner as jest.Mock).mockReturnValue({
            owner: { uid: 'owner-1' },
            verificationStatus: false,
            loading: false
        });
        (propertyService.subscribeToOwnerProperties as jest.Mock).mockImplementation((_, callback) => {
            callback([mockProperty as any]);
            return () => { };
        });

        render(<MemoryRouter><Properties /></MemoryRouter>);

        const publishBtn = await screen.findByRole('button', { name: /Pending Verification/i });
        expect(publishBtn).toBeDisabled();
    });

    it('unpublishes property and triggers success toast', async () => {
        const publishedProperty = { ...mockProperty, published: true };
        (useAuth as jest.Mock).mockReturnValue({ currentUser: { uid: 'owner-1' }, loading: false });
        (useOwner as jest.Mock).mockReturnValue({
            owner: { uid: 'owner-1' },
            verificationStatus: true,
            loading: false
        });
        (propertyService.unpublishProperty as jest.Mock).mockResolvedValue(undefined);
        (propertyService.subscribeToOwnerProperties as jest.Mock).mockImplementation((_, callback) => {
            callback([publishedProperty as any]);
            return () => { };
        });

        render(<MemoryRouter><Properties /></MemoryRouter>);

        const unpublishBtn = await screen.findByText(/Unpublish Listing/i);
        fireEvent.click(unpublishBtn);

        await waitFor(() => {
            expect(propertyService.unpublishProperty).toHaveBeenCalled();
            expect(toast.success).toHaveBeenCalledWith("Property unpublished");
        });
    });

    it('displays property card correctly', async () => {
        (useAuth as jest.Mock).mockReturnValue({ currentUser: { uid: 'owner-1' }, loading: false });
        (useOwner as jest.Mock).mockReturnValue({
            owner: { uid: 'owner-1' },
            verificationStatus: true,
            loading: false
        });
        (propertyService.subscribeToOwnerProperties as jest.Mock).mockImplementation((_, callback) => {
            callback([mockProperty as any]);
            return () => { };
        });

        render(<MemoryRouter><Properties /></MemoryRouter>);

        await waitFor(() => {
            expect(screen.getByText(/Test Property/i)).toBeInTheDocument();
        });
    });
});
