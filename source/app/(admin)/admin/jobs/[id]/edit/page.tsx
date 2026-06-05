import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchJobById } from "@/lib/supabase/jobs";
import { updateJob } from "../../actions";
import { JobForm } from "../../JobForm";

export const dynamic = "force-dynamic";

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const job = await fetchJobById(supabase, id);
  if (!job) notFound();

  const boundUpdate = updateJob.bind(null, id);

  return (
    <>
      <h1 className="text-2xl font-black mb-8" style={{ fontFamily: "var(--font-display)" }}>
        EDIT: {job.title.toUpperCase()}
      </h1>
      <JobForm
        action={boundUpdate}
        initial={job}
        submitLabel="Update job"
        successCopy="Job saved"
        redirectTo="/admin/jobs"
      />
    </>
  );
}
