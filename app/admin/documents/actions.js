"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const ALLOWED = ["draft", "published", "archived"];

// Publish, unpublish (back to draft), archive or restore a document (B-05)
export async function setDocumentStatus(formData) {
  const status = formData.get("status");
  if (!ALLOWED.includes(status)) return;

  const supabase = await createClient();
  await supabase
    .from("documents")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", formData.get("id"));

  revalidatePath("/admin/documents");
}

// Which documents each bulk button may change:
// publish only drafts, unpublish only published ones, archive anything except pending review
const BULK_FROM = {
  published: ["draft"],
  draft: ["published"],
  archived: ["draft", "published", "rejected"],
};

// Publish, unpublish or archive all the ticked documents at once
export async function setManyDocumentStatuses(formData) {
  const status = formData.get("status");
  const back = String(formData.get("back") || "/admin/documents");
  const backTo = back.startsWith("/admin/documents") ? back : "/admin/documents";
  const join = backTo.includes("?") ? "&" : "?";

  const ids = String(formData.get("ids") || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!BULK_FROM[status] || !ids.length) {
    redirect(`${backTo}${join}error=${encodeURIComponent("Tick at least one document first.")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ status, updated_at: new Date().toISOString() })
    .in("id", ids)
    .in("status", BULK_FROM[status])
    .select("id");

  if (error) {
    redirect(`${backTo}${join}error=${encodeURIComponent("Could not update the documents: " + error.message)}`);
  }

  const done = data?.length ?? 0;
  const skipped = ids.length - done;

  revalidatePath("/", "layout");
  redirect(`${backTo}${join}bulk=${status}&done=${done}&skipped=${skipped}`);
}