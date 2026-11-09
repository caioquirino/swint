import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useOrpc } from '@swint/web-data-access-api';
import { Button, Spinner } from '@swint/web-ui-primitives';

export function TemplatesSection() {
  const orpc = useOrpc();
  const queryClient = useQueryClient();
  const templates = useQuery(orpc.templates.list.queryOptions({ input: { includeArchived: false } }));
  const archive = useMutation(
    orpc.templates.archive.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.templates.key() }) }),
  );
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Templates</h2>
        <Link to="/templates/new" className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100">
          New template
        </Link>
      </div>
      {templates.isPending ? <Spinner /> : null}
      {templates.isError ? (
        <p role="alert" className="text-sm text-red-700">
          Could not load templates.
        </p>
      ) : null}
      {archive.isError ? (
        <p role="alert" className="text-sm text-red-700">
          Could not archive the template. Please try again.
        </p>
      ) : null}
      {templates.data ? (
        <table aria-label="Templates" className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2">Title</th>
              <th>Duration</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {templates.data.map((t) => (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="py-2">
                  <Link className="text-blue-700 hover:underline" to={`/templates/${t.id}`}>
                    {t.title}
                  </Link>
                </td>
                <td>{t.durationMin} min</td>
                <td>{new Date(t.updatedAt).toLocaleString()}</td>
                <td className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Archive ${t.title}`}
                    disabled={archive.isPending}
                    onClick={() => {
                      if (window.confirm(`Archive "${t.title}"? Existing sessions are not affected.`)) archive.mutate({ id: t.id });
                    }}
                  >
                    Archive
                  </Button>
                </td>
              </tr>
            ))}
            {templates.data.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-slate-500">
                  No templates yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
