import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from './app';

describe('AppRoutes', () => {
  it('renders the not-found page for unknown paths', () => {
    render(<MemoryRouter initialEntries={['/nope']}><AppRoutes /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
