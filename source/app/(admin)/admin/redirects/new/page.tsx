import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchDistinctCategories } from "@/lib/redirects/queries";
import RedirectForm from "../RedirectForm";
import { createRedirect } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewRedirectPage() {
  const supabase = await createServerSupabaseClient();
  const categories = await fetchDistinctCategories(supabase);
  return (
    <>
      <h1 className="text-2xl font-black mb-8" style={{ fontFamily: "var(--font-display)" }}>
        NEW REDIRECT
      </h1>
      <RedirectForm
        mode="create"
        categories={categories}
        action={createRedirect}
        successCopy="Redirect created"
      />
    </>
  );
}
