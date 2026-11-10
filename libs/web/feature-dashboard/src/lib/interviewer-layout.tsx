import { Outlet } from 'react-router';
import { AppHeader } from './app-header.js';
import { RequireInterviewer } from './require-interviewer.js';

export function InterviewerLayout() {
  return (
    <RequireInterviewer>
      <div className="flex h-full flex-col">
        <AppHeader />
        {/* Pages scroll inside this area; the template editor fills it. */}
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>
    </RequireInterviewer>
  );
}
