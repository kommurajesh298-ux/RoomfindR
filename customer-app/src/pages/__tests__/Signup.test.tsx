import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Signup from '../Signup';

jest.mock('../../services/auth.service');
jest.mock('../../services/user.service');
jest.mock('../../utils/toast');

describe('Signup Page', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders signup form with email input', async () => {
        render(<BrowserRouter><Signup /></BrowserRouter>);

        await waitFor(() => {
            expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
        });
    });

    it('renders create account button', async () => {
        render(<BrowserRouter><Signup /></BrowserRouter>);

        const createBtn = await screen.findByRole('button', { name: /next/i });
        expect(createBtn).toBeInTheDocument();
    });
});
