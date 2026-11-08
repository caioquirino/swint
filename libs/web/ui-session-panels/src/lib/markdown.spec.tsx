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

  it('does not render javascript: links as live anchors', () => {
    const { container } = render(<Markdown source={'[x](javascript:alert(1))'} />);
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^\s*javascript:/i);
    }
  });
});
