import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Markdown, MARKDOWN_PROSE } from './markdown.js';

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

  it('renders GFM tables, read-only task lists and strikethrough', () => {
    const { container } = render(
      <Markdown source={'| Area | Strong |\n| --- | --- |\n| Scale | shards |\n\n- [ ] open\n- [x] done\n\n~~old~~'} />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Area' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'shards' })).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
    expect(container.querySelector('del')).toHaveTextContent('old');
  });

  it('exports its prose classes, including tables and task lists, for editors', () => {
    expect(MARKDOWN_PROSE).toContain('[&_table]');
    expect(MARKDOWN_PROSE).toContain('[&_ul[data-type=taskList]]');
    expect(MARKDOWN_PROSE).toContain('[&_.contains-task-list]');
  });
});
