import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { Screen } from '@swint/web-ui-primitives';

export function NotFound() {
  return (
    <Screen title="Page not found" actions={<Link className="text-blue-700 underline" to="/">Go home</Link>}>
      The page you are looking for does not exist.
    </Screen>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
