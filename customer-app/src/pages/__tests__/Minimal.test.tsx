import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

describe('Minimal Router Test', () => {
    it('ranks 1 over 0', () => {
        expect(1).toBeGreaterThan(0);
    });
    it('renders with router', () => {
        render(<BrowserRouter><div>Hello</div></BrowserRouter>);
        expect(screen.getByText(/hello/i)).toBeInTheDocument();
    });
});
