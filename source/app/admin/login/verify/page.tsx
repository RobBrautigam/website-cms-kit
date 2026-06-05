import { requirePartialAdmin } from "@/lib/auth/require";
import { VerifyForm } from "./VerifyForm";

export default async function VerifyPage() {
  await requirePartialAdmin();
  return (
    <div className="mx-auto max-w-sm py-12 px-4">
      <VerifyForm />
    </div>
  );
}
