import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import BulkUploadForm from "./BulkUploadForm";

export const metadata = { title: "Bulk upload | GTCOP Admin" };

export default async function BulkUploadPage() {
  const supabase = await createClient();
  const [{ data: countries }, { data: categories }, { data: existing }] = await Promise.all([
    supabase.from("countries").select("id, name, iso_code").order("name"),
    supabase.from("categories").select("id, name").order("sort_order"),
    supabase.from("documents").select("title, country_id"),
  ]);

  return (
    <>
      <p className="breadcrumbs"><Link href="/admin/documents">Documents</Link> / Bulk upload</p>
      <p className="eyebrow">Repository</p>
      <h1>Bulk upload</h1>
      <p className="muted">
        Upload many documents at once from a folder, using an upload list (CSV) that says each file&apos;s title,
        country, category and year. Everything is saved as a <strong>draft</strong>, so nothing goes public until you
        publish it.
      </p>
      <BulkUploadForm countries={countries ?? []} categories={categories ?? []} existing={existing ?? []} />
    </>
  );
}