import { createJob } from "../actions";
import { JobForm } from "../JobForm";

export default function NewJobPage() {
  return (
    <>
      <h1 className="text-2xl font-black mb-8" style={{ fontFamily: "var(--font-display)" }}>
        NEW JOB
      </h1>
      <JobForm
        action={createJob}
        submitLabel="Create job"
        successCopy="Job created"
        redirectTo="/admin/jobs"
      />
    </>
  );
}
