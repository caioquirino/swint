import { Link } from 'react-router';
import { logout, navigation } from '@swint/web-data-access-api';
import { Button, ThemeToggle } from '@swint/web-ui-primitives';
import { useMe } from './require-interviewer.js';

export function AppHeader() {
  const me = useMe();
  return (
    <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-3">
      <Link to="/" className="text-lg font-semibold">
        Swint
      </Link>
      <div className="flex items-center gap-3 text-sm">
        <ThemeToggle />
        <span>{me.name}</span>
        <Button variant="ghost" size="sm" onClick={async () => navigation.assign(await logout())}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
