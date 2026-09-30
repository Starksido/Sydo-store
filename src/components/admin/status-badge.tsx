/** On sale or archived, for product lists and headings. */
export function StatusBadge({ archived }: { archived: boolean }) {
  return archived ? <span className="badge">Archived</span> : <span className="badge badge-success">On sale</span>;
}
