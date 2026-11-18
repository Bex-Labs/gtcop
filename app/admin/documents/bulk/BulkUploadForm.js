"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { parseCsv } from "@/lib/csv";

// Bulk upload: (1) choose the upload list (CSV), (2) choose the folder with the files,
// (3) check the table, (4) upload. Every document is saved as a draft.

const MAX_SIZE = 50 * 1024 * 1024; // same 50 MB limit as the single upload form
const ALLOWED = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];
const COLUMNS = ["file", "country", "title", "category", "year", "language"];

// Compare names without worrying about capitals, accents written two ways, or \ vs /
const key = (s) => String(s ?? "").normalize("NFC").replace(/\\/g, "/").trim().toLowerCase();
const plain = (s) => key(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const formatSize = (b) => (b > 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function BulkUploadForm({ countries, categories, existing }) {
  const [list, setList] = useState(null); // { name, rows, error }
  const [files, setFiles] = useState(null); // Map: path inside the folder → File
  const [progress, setProgress] = useState({}); // row index → "uploading" | "done" | error text
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const countryBy = useMemo(() => new Map(countries.flatMap((c) => [[plain(c.name), c], [plain(c.iso_code), c]])), [countries]);
  const categoryBy = useMemo(() => new Map(categories.map((c) => [plain(c.name), c])), [categories]);
  const onSite = useMemo(() => new Set(existing.map((d) => `${d.country_id}|${plain(d.title)}`)), [existing]);

  // 1. Read the upload list
  async function chooseList(event) {
    const f = event.target.files?.[0];
    setProgress({}); setFinished(false);
    if (!f) return setList(null);
    const rows = parseCsv(await f.text());
    const header = (rows[0] ?? []).map((h) => key(h));
    const missing = COLUMNS.filter((c) => !header.includes(c));
    if (missing.length) {
      return setList({ name: f.name, rows: [], error: `The list is missing these columns: ${missing.join(", ")}.` });
    }
    const col = (r, c) => String(r[header.indexOf(c)] ?? "").trim();
    setList({
      name: f.name,
      rows: rows.slice(1).map((r) => Object.fromEntries(COLUMNS.map((c) => [c, col(r, c)]))),
    });
  }

  // 2. Read the folder (paths are kept relative to the folder you chose)
  function chooseFolder(event) {
    setProgress({}); setFinished(false);
    const map = new Map();
    for (const f of event.target.files ?? []) {
      const inside = f.webkitRelativePath.split("/").slice(1).join("/"); // drop the top folder's own name
      map.set(key(inside || f.name), f);
    }
    setFiles(map.size ? map : null);
  }

  // 3. Check every row
  const checked = useMemo(() => {
    if (!list?.rows) return [];
    const seen = new Set();
    return list.rows.map((r, i) => {
      const problems = [];
      const country = countryBy.get(plain(r.country));
      const category = categoryBy.get(plain(r.category));
      const year = /^\d{4}$/.test(r.year) ? Number(r.year) : null;
      const file = files?.get(key(r.file)) ?? null;
      const ext = r.file.split(".").pop().toLowerCase();

      if (!r.title) problems.push("No title");
      if (!country) problems.push(`Country "${r.country}" isn't on the site`);
      if (!category) problems.push(`Category "${r.category}" isn't on the site`);
      if (!year) problems.push("No year");
      if (!ALLOWED.includes(ext)) problems.push("File type not allowed");
      if (files && !file) problems.push("File not found in the folder");
      if (file && file.size > MAX_SIZE) problems.push("Larger than 50 MB");

      const dupKey = country ? `${country.id}|${plain(r.title)}` : null;
      let skip = null;
      if (dupKey && onSite.has(dupKey)) skip = "Already on the site";
      else if (dupKey && seen.has(dupKey)) skip = "Listed twice";
      if (dupKey) seen.add(dupKey);

      return { i, ...r, countryText: r.country, categoryText: r.category, country, category, year, file, problems, skip, ok: !problems.length && !skip && !!file };
    });
  }, [list, files, countryBy, categoryBy, onSite]);

  const ready = checked.filter((r) => r.ok);
  const doneCount = Object.values(progress).filter((p) => p === "done").length;
  const failed = Object.entries(progress).filter(([, p]) => p !== "done" && p !== "uploading");

  // 4. Upload, one file at a time
  async function uploadAll() {
    setRunning(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    for (const r of ready) {
      if (progress[r.i] === "done") continue; // already uploaded in an earlier try
      setProgress((p) => ({ ...p, [r.i]: "uploading" }));
      const ext = r.file.name.split(".").pop().toLowerCase();
      const safeName = r.file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `${r.country.iso_code}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage.from("documents").upload(path, r.file, { contentType: r.file.type || undefined });
      if (uploadError) {
        setProgress((p) => ({ ...p, [r.i]: "The file could not be uploaded" }));
        continue;
      }
      const { error: insertError } = await supabase.from("documents").insert({
        title: r.title,
        country_id: r.country.id,
        category_id: r.category.id,
        year: r.year,
        language: r.language || null,
        file_path: path,
        file_type: ext.toUpperCase(),
        file_size: r.file.size,
        status: "draft",
        uploaded_by: user?.id,
      });
      if (insertError) {
        await supabase.storage.from("documents").remove([path]); // tidy up
        setProgress((p) => ({ ...p, [r.i]: "The details could not be saved" }));
        continue;
      }
      setProgress((p) => ({ ...p, [r.i]: "done" }));
    }
    setRunning(false);
    setFinished(true);
  }

  const rowStatus = (r) => {
    const p = progress[r.i];
    if (p === "done") return <span className="badge badge-live">Uploaded</span>;
    if (p === "uploading") return <span className="badge badge-pending">Uploading…</span>;
    if (p) return <span className="badge badge-error">{p}</span>;
    if (r.skip) return <span className="badge badge-hidden">{r.skip}: skipped</span>;
    if (r.problems.length) return <span className="bulk-problem">{r.problems.join(" · ")}</span>;
    if (!files) return <span className="muted small">Choose the folder</span>;
    return <span className="badge badge-live">Ready</span>;
  };

  return (
    <>
      <section className="card bulk-card">
        <h2>1. Choose the upload list</h2>
        <p className="muted small">A CSV with the columns: file, country, title, category, year, language.</p>
        <input type="file" accept=".csv,text/csv" onChange={chooseList} disabled={running} aria-label="Upload list (CSV)" />
        {list?.error && <div className="alert alert-error" role="alert">{list.error}</div>}
        {list?.rows && !list.error && <p className="small"><strong>{list.rows.length}</strong> documents in {list.name}</p>}
      </section>

      <section className="card bulk-card">
        <h2>2. Choose the folder with the files</h2>
        <p className="muted small">
          Choose the <strong>Regulatory Mapping</strong> folder itself. The browser may ask you to confirm the upload;
          nothing is sent until you click Upload in step 4.
        </p>
        <input type="file" webkitdirectory="" directory="" multiple onChange={chooseFolder} disabled={running} aria-label="Folder with the files" />
        {files && <p className="small"><strong>{files.size}</strong> files found in the folder</p>}
      </section>

      {checked.length > 0 && (
        <section className="card bulk-card">
          <h2>3. Check the list</h2>
          <p>
            <strong>{ready.length}</strong> ready to upload
            {checked.length - ready.length > 0 && <> · <strong>{checked.length - ready.length}</strong> will be skipped (see the Check column)</>}
          </p>
          <div className="table-scroll">
            <table className="table bulk-list">
              <thead>
                <tr><th>#</th><th>Title</th><th>Country</th><th>Category</th><th>Year</th><th>File</th><th>Check</th></tr>
              </thead>
              <tbody>
                {checked.map((r) => (
                  <tr key={r.i} className={r.ok || progress[r.i] === "done" ? "" : "bulk-skip"}>
                    <td>{r.i + 1}</td>
                    <td><strong>{r.title || "–"}</strong></td>
                    <td>{r.country?.name ?? (r.countryText || "–")}</td>
                    <td>{r.category?.name ?? (r.categoryText || "–")}</td>
                    <td>{r.year ?? "–"}</td>
                    <td className="small">{r.file ? formatSize(r.file.size) : "–"}</td>
                    <td>{rowStatus(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {checked.length > 0 && (
        <section className="card bulk-card" aria-live="polite">
          <h2>4. Upload</h2>
          {!finished ? (
            <>
              <button type="button" className="btn btn-primary" onClick={uploadAll} disabled={running || !ready.length}>
                {running ? `Uploading… ${doneCount} of ${ready.length}` : `Upload ${ready.length} documents as drafts`}
              </button>
              {running && <p className="muted small">Keep this page open until it finishes.</p>}
            </>
          ) : (
            <>
              <div className={`alert ${failed.length ? "alert-error" : "alert-success"}`} role="status">
                <strong>{doneCount}</strong> documents uploaded as drafts.
                {failed.length > 0 && <> <strong>{failed.length}</strong> failed (marked in red above). Click Try again to retry only those.</>}
              </div>
              <p className="bulk-actions-row">
                {failed.length > 0 && (
                  <button type="button" className="btn btn-primary" onClick={() => { setFinished(false); uploadAll(); }}>
                    Try again
                  </button>
                )}
                <Link href="/admin/documents?status=draft" className="btn btn-outline">See the drafts</Link>
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}