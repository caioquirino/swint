import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, Button, CopyField, Dialog, Screen, cn } from '../index.js';

describe('ui-primitives', () => {
  it('cn merges and de-duplicates Tailwind classes', () => {
    expect(cn('px-2', false, 'px-4', undefined)).toBe('px-4');
  });

  it('Button applies variant classes and forwards props', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="danger" onClick={onClick}>
        End
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'End' });
    expect(button.className).toContain('bg-red-600');
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('Badge renders its tone', () => {
    render(<Badge tone="success">live</Badge>);
    expect(screen.getByText('live').className).toContain('bg-green-100');
  });

  it('Dialog renders title and content only when open', () => {
    const { rerender } = render(
      <Dialog open={false} onOpenChange={() => undefined} title="Cancel session">
        body
      </Dialog>,
    );
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    rerender(
      <Dialog open onOpenChange={() => undefined} title="Cancel session">
        body
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Cancel session' })).toHaveTextContent('body');
  });

  it('Screen shows a heading and actions', () => {
    render(
      <Screen title="Interview ended" actions={<Button>Home</Button>}>
        Thanks
      </Screen>,
    );
    expect(screen.getByRole('heading', { name: 'Interview ended' })).toBeInTheDocument();
    expect(screen.getByText('Thanks')).toBeInTheDocument();
  });

  it('CopyField copies its value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CopyField label="Candidate link" value="http://x/join/t" />);
    expect(screen.getByLabelText('Candidate link')).toHaveValue('http://x/join/t');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('http://x/join/t');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('CopyField falls back to manual copy when the clipboard is unavailable or rejects', async () => {
    for (const clipboard of [undefined, { writeText: vi.fn().mockRejectedValue(new Error('denied')) }]) {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
      const { unmount } = render(<CopyField label="Candidate link" value="http://x/join/t" />);
      await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await screen.findByRole('button', { name: 'Press Ctrl+C' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
      unmount();
    }
  });
});
