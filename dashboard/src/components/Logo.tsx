// Trailhead wordmark: a rounded-square red badge with a mountain/trail peak, placed
// beside the name — the same icon+wordmark treatment Core uses for its own logo.
export function Logo() {
  return (
    <div className="brand">
      <svg className="brand-mark" width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
        <rect width="30" height="30" rx="9" fill="#E84142" />
        <path d="M9.4 21.2 L15 9.4 L20.6 21.2 Z" fill="#fff" />
        <path d="M15 9.4 L20.6 21.2 L15 21.2 Z" fill="#fff" opacity="0.72" />
        <circle cx="20.2" cy="10.4" r="2.1" fill="#fff" opacity="0.9" />
      </svg>
      <span className="brand-name">Trailhead</span>
    </div>
  );
}
