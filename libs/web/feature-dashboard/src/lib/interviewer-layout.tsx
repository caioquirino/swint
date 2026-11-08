import { Outlet } from 'react-router';
import { AppHeader } from './app-header.js';
import { RequireInterviewer } from './require-interviewer.js';

export function InterviewerLayout() {
  return (
    <RequireInterviewer>
      <div className="min-h-full">
        <AppHeader />
        <Outlet />
      </div>
    </RequireInterviewer>
  );
}
