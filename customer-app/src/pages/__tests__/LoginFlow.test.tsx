import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Login from '../Login';

jest.mock('../../services/auth.service');
jest.mock('../../utils/toast');

describe('Customer Login Flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders login page with email input', async () => {
        render(<BrowserRouter><Login /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
        });
    });

    it('renders login button', async () => {
        render(<BrowserRouter><Login /></BrowserRouter>);

        const loginBtn = await screen.findByRole('button', { name: /^login$/i });
        expect(loginBtn).toBeInTheDocument();
    });
});
