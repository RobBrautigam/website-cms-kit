import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require";
import { fetchAllJobs } from "@/lib/supabase/jobs";
import RowDeleteButton from "@/components/admin/RowDeleteButton";
import ToggleButton from "@/components/admin/ToggleButton";
import { deleteJob, toggleJobActive } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminJobsPage() {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const jobs = await fetchAllJobs(supabase);

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-black" style={{ fontFamily: "var(--font-display)" }}>
          JOBS
        </h1>
        <Link href="/admin/jobs/new" className="btn-primary px-5 py-2.5 text-sm font-bold">
          + New Job
        </Link>
      </div>

      <div className="hidden md:block border border-border rounded-lg overflow-hidden bg-bg-white">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated border-b border-border">
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-bg-elevated/50">
                <td className="px-4 py-3 font-medium">{job.title}</td>
                <td className="px-4 py-3 text-text-secondary">{job.department}</td>
                <td className="px-4 py-3 text-text-secondary">{job.type}</td>
                <td className="px-4 py-3">
                  <ToggleButton
                    currentValue={job.is_active}
                    onLabel="Active"
                    offLabel="Hidden"
                    onClass="bg-green-100 text-green-700"
                    offClass="bg-gray-100 text-gray-500"
                    action={toggleJobActive.bind(null, job.id)}
                    onSuccessCopy="Job activated"
                    offSuccessCopy="Job hidden"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Link href={`/admin/jobs/${job.id}/edit`} className="text-accent hover:underline">
                      Edit
                    </Link>
                    <RowDeleteButton
                      action={deleteJob.bind(null, job.id)}
                      itemLabel={job.title}
                      successCopy={`Job deleted: ${job.title}`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <ul className="md:hidden space-y-3">
        {jobs.map((job) => (
          <li key={job.id} className="border border-border rounded-lg bg-bg-white p-4">
            <p className="font-semibold text-text-primary">{job.title}</p>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold">Department</p>
                <p className="text-text-primary text-sm">{job.department}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold">Type</p>
                <p className="text-text-primary text-sm">{job.type}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold mb-1">Active</p>
                <ToggleButton
                  currentValue={job.is_active}
                  onLabel="Active"
                  offLabel="Hidden"
                  onClass="bg-green-100 text-green-700"
                  offClass="bg-gray-100 text-gray-500"
                  action={toggleJobActive.bind(null, job.id)}
                  onSuccessCopy="Job activated"
                  offSuccessCopy="Job hidden"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <Link
                href={`/admin/jobs/${job.id}/edit`}
                className="flex-1 flex items-center justify-center px-3 py-2 rounded-lg border border-border text-sm font-semibold text-text-primary hover:text-accent hover:bg-accent/10 transition-colors"
              >
                Edit
              </Link>
              <RowDeleteButton
                action={deleteJob.bind(null, job.id)}
                itemLabel={job.title}
                successCopy={`Job deleted: ${job.title}`}
                className="px-3 py-2 rounded-lg border border-border text-sm font-semibold text-text-secondary hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors"
              />
            </div>
          </li>
        ))}
      </ul>

      {jobs.length === 0 && (
        <p className="text-center text-text-muted mt-8">
          No jobs yet. Click &quot;+ New Job&quot; to create one.
        </p>
      )}
    </>
  );
}
