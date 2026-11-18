import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import DocumentsTable from "@/components/DocumentsTable";

export const metadata = { title: "Documents | GTCOP Admin" };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
  { value: "pending", label: "Pending review" },
  { value: "rejected", label: "Sent back" },
  { value: "archived", label: "Archived" },
];

const PER_PAGE = 50;

export default async function DocumentsAdminPage({ searchParams }) {
  const { status = "all", q = "", country = "", page = "1", bulk, done, skipped, error } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const supabase = await createClient();

  const { data: countries } = await supabase.from("countries").select("id, name").order("name");

  // Newest first, 50 per page, with optional search, country and status filters
  let query = supabase
    .from("documents")
    .select("id, title, year, status, updated_at, countries(name), categories(name)", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range((pageNum - 1) * PER_PAGE, pageNum * PER_PAGE - 1);

  if (status !== "all") query = query.eq("status", status);
  if (country) query = query.eq("country_id", country);
  const term = q.replace(/[%,()"\\]/g, " ").trim();
  if (term) query = query.ilike("title", `%${term}%`);

  const { data, count } = await query;
  const documents = data ?? [];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE));

  // Keeps the other filters when changing tab or page
  const link = (changes) => {
    const params = new URLSearchParams({
      ...(status !== "all" && { status }),
      ...(q && { q }),
      ...(country && { country }),
      ...changes,
    });
    for (const [key, value] of [...params]) if (!value || value === "all") params.delete(key);
    const text = params.toString();
    return text ? `/admin/documents?${text}` : "/admin/documents";
  };

  // Message after a bulk publish / unpublish / archive
  const WORD = { published: "published", draft: "unpublished (back to draft)", archived: "archived" };
  const bulkMessage = WORD[bulk]
    ? `${done ?? 0} document${done === "1" ? "" : "s"} ${WORD[bulk]}.` +
      (Number(skipped) > 0 ? ` ${skipped} skipped because their status did not allow it.` : "")
    : "";

  return (
    <>
      <p className="eyebrow">Repository</p>
      <div className="page-head">
        <h1>Documents</h1>
        <div className="page-head-actions">
          <Link href="/admin/documents/bulk" className="btn btn-outline">Bulk upload</Link>
          <Link href="/admin/documents/new" className="btn btn-primary">Upload document</Link>
        </div>
      </div>

      {bulkMessage && <div className="alert alert-success" role="status">{bulkMessage}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {/* Filter tabs: these change the ?status= part of the address */}
      <nav className="filter-tabs" aria-label="Filter documents by status">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={link({ status: f.value, page: "" })}
            className={status === f.value ? "active" : ""}
            aria-current={status === f.value ? "page" : undefined}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {/* Search by title and filter by country */}
      <form className="filter-bar" role="search">
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <label htmlFor="q" className="visually-hidden">Search by title</label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Search by title" />
        <label htmlFor="country" className="visually-hidden">Country</label>
        <select id="country" name="country" defaultValue={country}>
          <option value="">All countries</option>
          {(countries ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn btn-primary">Search</button>
      </form>

      <p className="muted small" role="status">
        {count ?? 0} {count === 1 ? "document" : "documents"}
        {(q || country) && <> · <Link href={link({ q: "", country: "", page: "" })}>Clear search</Link></>}
      </p>

      <DocumentsTable
        key={`${status}-${q}-${country}-${pageNum}-${bulk ?? ""}-${done ?? ""}`}
        documents={documents}
        back={link({ page: pageNum > 1 ? String(pageNum) : "" })}
      />

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {pageNum > 1 && <Link href={link({ page: String(pageNum - 1) })} className="btn btn-outline">← Newer</Link>}
          <span className="muted">Page {pageNum} of {pages}</span>
          {pageNum < pages && <Link href={link({ page: String(pageNum + 1) })} className="btn btn-outline">Older →</Link>}
        </nav>
      )}
    </>
  );
}