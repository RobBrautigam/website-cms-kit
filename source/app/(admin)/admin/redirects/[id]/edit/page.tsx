import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchRedirectById, fetchDistinctCategories } from "@/lib/redirects/queries";
import RedirectForm from "../../RedirectForm";
import { updateRedirect } from "../../actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditRedirectPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const [row, categories] = await Promise.all([
    fetchRedirectById(supabase, id),
    fetchDistinctCategories(supabase),
  ]);
  if (!row) notFound();

  const action = updateRedirect.bind(null, id);

  return (
    <>
      <h1 className="text-2xl font-black mb-8" style={{ fontFamily: "var(--font-display)" }}>
        EDIT REDIRECT
      </h1>
      <RedirectForm
        mode="edit"
        initial={row}
        categories={categories}
        action={action}
        successCopy="Redirect saved"
      />
    </>
  );
}
