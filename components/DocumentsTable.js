"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { setDocumentStatus, setManyDocumentStatuses } from "@/app/admin/documents/actions";

// The documents list with tick boxes: tick some (or all), then publish, unpublish or archive them together.
// Each row still has its own Edit, Publish/Unpublish and Archive buttons.

const BADGE = {
  published: "badge-live",
  draft: "badge-hidden",
  pending: "badge-pending",
  rejected: "badge-error",
  archived: "badge-hidden",
};

// A small button that changes one document's status
function StatusButton({ id, status, label }) {
  return (
    <form action={setDocumentStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="link-button">{label}</button>
    </form>
  );
}

function BulkButton({ status, children, primary }) {
  const { pending } = useFormStatus();
  return (
    <button name="status" value={status} className={`btn ${primary ? "btn-primary" : "btn-outline"}`} disabled={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}

// documents: [{ id, title, year, status, updated_at, countries: { name }, categories: { name } }]
// back: the current address, so the page comes back with the same filters after a bulk change
export default function DocumentsTable({ documents, back }) {
  const [picked, setPicked] = useState(() => new Set());

  const allPicked = documents.length > 0 && documents.every((d) => picked.has(d.id));
  const somePicked = !allPicked && documents.some((d) => picked.has(d.id));

  const toggle = (id) =>
    setPicked((now) => {
      const next = new Set(now);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const pickAll = () => setPicked(allPicked ? new Set() : new Set(documents.map((d) => d.id)));
  const pickWhere = (test) => setPicked(new Set(documents.filter(test).map((d) => d.id)));

  const chosen = documents.filter((d) => picked.has(d.id));
  const drafts = chosen.filter((d) => d.status === "draft").length;
  const live = chosen.filter((d) => d.status === "published").length;
  const archivable = chosen.filter((d) => ["draft", "published", "rejected"].includes(d.status)).length;

  return (
    <>
      {/* Bulk actions */}
      <form action={setManyDocumentStatuses} className={`card bulk-bar docs-bulk ${picked.size ? "is-active" : ""}`} aria-label="Selected documents">
        <input type="hidden" name="ids" value={[...picked].join(",")} />
        <input type="hidden" name="back" value={back} />
        <p className="bulk-count" aria-live="polite">
          {picked.size ? (
            <><strong>{picked.size}</strong> selected</>
          ) : (
            "Tick documents to publish, unpublish or archive several at once."
          )}
        </p>
        <div className="bulk-quick">
          <span className="muted small">Quick select:</span>
          <button type="button" className="link-button" onClick={() => pickWhere(() => true)}>All</button>
          <button type="button" className="link-button" onClick={() => pickWhere((d) => d.status === "draft")}>Drafts</button>
          <button type="button" className="link-button" onClick={() => pickWhere((d) => d.status === "published")}>Published</button>
          <button type="button" className="link-button" onClick={() => setPicked(new Set())} disabled={!picked.size}>None</button>
        </div>
        {picked.size > 0 && (
          <div className="bulk-actions">
            {drafts > 0 && <BulkButton status="published" primary>Publish {drafts}</BulkButton>}
            {live > 0 && <BulkButton status="draft">Unpublish {live}</BulkButton>}
            {archivable > 0 && <BulkButton status="archived">Archive {archivable}</BulkButton>}
          </div>
        )}
        {picked.size > 0 && chosen.some((d) => d.status === "pending") && (
          <p className="muted small bulk-warn">Documents waiting for review are not changed here. Use Review for those.</p>
        )}
      </form>

      <div className="card table-card">
        {documents.length === 0 ? (
          <p className="muted">No documents here yet.</p>
        ) : (
          <table className="table bulk-table">
            <thead>
              <tr>
                <th className="pick-col">
                  <input
                    type="checkbox"
                    aria-label={allPicked ? "Untick all documents" : "Tick all documents"}
                    checked={allPicked}
                    ref={(el) => { if (el) el.indeterminate = somePicked; }}
                    onChange={pickAll}
                  />
                </th>
                <th>Title</th>
                <th>Country</th>
                <th>Category</th>
                <th>Year</th>
                <th>Status</th>
                <th>Updated</th>
                <th><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id} className={picked.has(d.id) ? "is-picked" : ""}>
                  <td className="pick-col">
                    <input
                      type="checkbox"
                      aria-label={`Tick ${d.title}`}
                      checked={picked.has(d.id)}
                      onChange={() => toggle(d.id)}
                    />
                  </td>
                  <td><Link href={`/admin/documents/${d.id}`}>{d.title}</Link></td>
                  <td>{d.countries?.name}</td>
                  <td>{d.categories?.name}</td>
                  <td>{d.year}</td>
                  <td>
                    <span className={`badge ${BADGE[d.status]}`}>{d.status}</span>
                  </td>
                  <td>{new Date(d.updated_at).toLocaleDateString("en-GB")}</td>
                  <td>
                    <div className="row-actions">
                      <Link href={`/admin/documents/${d.id}`} className="link-button">Edit</Link>
                      {d.status === "pending" && <Link href="/admin/review" className="link-button">Review</Link>}
                      {d.status === "draft" && <StatusButton id={d.id} status="published" label="Publish" />}
                      {d.status === "published" && <StatusButton id={d.id} status="draft" label="Unpublish" />}
                      {!["archived", "pending"].includes(d.status) && (
                        <StatusButton id={d.id} status="archived" label="Archive" />
                      )}
                      {d.status === "archived" && <StatusButton id={d.id} status="draft" label="Restore" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}