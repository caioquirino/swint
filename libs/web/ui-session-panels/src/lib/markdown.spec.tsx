import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown } from './markdown.js';

describe('Markdown', () => {
  it('renders markdown', () => {
    render(<Markdown source={'# Task\n\n- one\n- two'} />);
    expect(screen.getByRole('heading', { name: 'Task' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('never renders raw HTML from template authors', () => {
    const { container } = render(<Markdown source={'<script>alert(1)</script><img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
