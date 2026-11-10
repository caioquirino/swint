import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { THEME_STORAGE_KEY, ThemeProvider, ThemeToggle, useTheme } from './theme.js';

type Listener = (e: { matches: boolean }) => void;
let systemDark = false;
let listeners: Listener[] = [];

function stubMatchMedia() {
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return systemDark;
    },
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: (_: string, l: Listener) => (listeners = listeners.filter((x) => x !== l)),
  }));
}

function Probe() {
  const { preference, resolved } = useTheme();
  return (
    <p data-testid="probe">
      {preference}:{resolved}
    </p>
  );
}

beforeEach(() => {
  systemDark = false;
  listeners = [];
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
  stubMatchMedia();
});
afterEach(() => vi.unstubAllGlobals());

describe('ThemeProvider', () => {
  it('defaults to system and resolves from matchMedia', () => {
    systemDark = true;
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('system:dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('applies and stores an explicit preference', () => {
    function Setter() {
      const { setPreference } = useTheme();
      return <button onClick={() => setPreference('dark')}>go</button>;
    }
    render(
      <ThemeProvider>
        <Setter />
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('go'));
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('reads a stored preference on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    systemDark = true;
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('light:light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('follows system changes while on system', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('system:light');
    act(() => listeners.forEach((l) => l({ matches: true })));
    expect(screen.getByTestId('probe')).toHaveTextContent('system:dark');
  });

  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    render(
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('system:light');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByTestId('probe')).toHaveTextContent('dark:dark');
    vi.restoreAllMocks();
  });
});

describe('ThemeToggle', () => {
  it('marks the active option and selects on click', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'false');
  });
});
