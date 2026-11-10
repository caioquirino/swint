import { lazy, Suspense, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes, useSearchParams } from 'react-router';
import { ApiProvider, createApiClient, createQueryClient } from '@swint/web-data-access-api';
import { Screen, Spinner, ThemeProvider } from '@swint/web-ui-primitives';

const InterviewerLayout = lazy(() => import('@swint/web-feature-dashboard').then((m) => ({ default: m.InterviewerLayout })));
const DashboardPage = lazy(() => import('@swint/web-feature-dashboard').then((m) => ({ default: m.DashboardPage })));
const TemplateEditorPage = lazy(() => import('@swint/web-feature-template-editor').then((m) => ({ default: m.TemplateEditorPage })));
const SessionRoomPage = lazy(() => import('@swint/web-feature-session-room').then((m) => ({ default: m.SessionRoomPage })));
const LinkInvalidScreen = lazy(() => import('@swint/web-feature-session-room').then((m) => ({ default: m.LinkInvalidScreen })));

export function NotFound() {
  return (
    <Screen
      title="Page not found"
      actions={
        <Link className="text-blue-700 dark:text-blue-400 underline" to="/">
          Go home
        </Link>
      }
    >
      The page you are looking for does not exist.
    </Screen>
  );
}

/** /link-invalid?reason=… is where the API's /join/:token sends rejected candidates. */
function LinkInvalidRoute() {
  const [params] = useSearchParams();
  const raw = params.get('reason');
  const reason = raw === 'invite_revoked' || raw === 'session_ended' ? raw : null;
  return <LinkInvalidScreen reason={reason} />;
}

export function AppRoutes() {
  return (
    <Suspense
      fallback={
        <Screen title="Loading…">
          <Spinner />
        </Screen>
      }
    >
      <Routes>
        <Route element={<InterviewerLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/templates/new" element={<TemplateEditorPage />} />
          <Route path="/templates/:templateId" element={<TemplateEditorPage />} />
        </Route>
        <Route path="/s/:sessionId" element={<SessionRoomPage />} />
        <Route path="/link-invalid" element={<LinkInvalidRoute />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export function App() {
  const [client] = useState(() => createApiClient());
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ApiProvider client={client}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ApiProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
