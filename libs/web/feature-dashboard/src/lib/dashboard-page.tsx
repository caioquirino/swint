import { CreateSessionDialog } from './create-session-dialog.js';
import { SessionsSection } from './sessions-section.js';
import { TemplatesSection } from './templates-section.js';

export function DashboardPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-10 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Interviews</h1>
        <CreateSessionDialog />
      </div>
      <SessionsSection />
      <TemplatesSection />
    </main>
  );
}
