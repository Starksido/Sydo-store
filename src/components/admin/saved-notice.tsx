/** Confirms the last change, after an admin action redirects back with `?saved=`. */
export function SavedNotice({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="border border-success p-4 text-sm text-success">
      {children}
    </p>
  );
}
