import { Children, type ReactNode } from 'react';

/**
 * Groups status banners in a named region, so screen-reader users who move between page
 * regions don't skip them. Renders nothing when every child is empty.
 */
export function Notices({ label, children }: { label: string; children: ReactNode }) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <div className="notices" role="region" aria-label={label}>
      {children}
    </div>
  );
}
