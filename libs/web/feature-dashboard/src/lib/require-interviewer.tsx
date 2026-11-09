import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import type { Me } from '@swint/shared-api-contract';
import { apiError, loginUrl, navigation, useOrpc } from '@swint/web-data-access-api';
import { Button, Screen, Spinner } from '@swint/web-ui-primitives';

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside <RequireInterviewer>');
  return me;
}

/** Interviewer-only pages: anonymous visitors go through Keycloak and come back here. */
export function RequireInterviewer({ children }: { children: ReactNode }) {
  const orpc = useOrpc();
  const location = useLocation();
  const me = useQuery(orpc.me.get.queryOptions());
  const code = apiError(me.error)?.code;
  const returnTo = location.pathname + location.search;

  useEffect(() => {
    if (code === 'UNAUTHORIZED') navigation.assign(loginUrl(returnTo));
  }, [code, returnTo]);

  if (me.isPending)
    return (
      <Screen title="Loading…">
        <Spinner />
      </Screen>
    );
  if (code === 'UNAUTHORIZED') return <Screen title="Redirecting to sign-in…" />;
  if (code === 'FORBIDDEN') return <Screen title="No access">Your account is not allowed to use Swint.</Screen>;
  if (me.isError) {
    return (
      <Screen title="Something went wrong" actions={<Button onClick={() => void me.refetch()}>Retry</Button>}>
        We couldn&apos;t load your account.
      </Screen>
    );
  }
  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>;
}
