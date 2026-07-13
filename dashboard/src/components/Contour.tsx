// The one signature visual element: hand-authored topographic contour lines, like the
// elevation map on a real trailhead sign. Sits behind the portfolio hero at low opacity —
// texture, not decoration. Purely decorative/non-informational, so it's hidden from
// assistive tech and ignored by prefers-reduced-motion (it never animates).
export function Contour() {
  return (
    <svg
      className="hero-contour"
      viewBox="0 0 400 220"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
    >
      <path d="M-20 180 Q 60 140 120 165 T 260 150 Q 340 130 430 160" stroke="currentColor" strokeWidth="1.5" />
      <path d="M-20 150 Q 70 105 140 135 T 280 115 Q 350 95 430 125" stroke="currentColor" strokeWidth="1.5" />
      <path d="M-20 118 Q 80 68 150 100 T 300 78 Q 360 58 430 90" stroke="currentColor" strokeWidth="1.5" />
      <path d="M-20 84 Q 90 30 160 62 T 310 40 Q 370 20 430 52" stroke="currentColor" strokeWidth="1.5" />
      <path d="M-20 48 Q 100 -8 170 22 T 320 2 Q 375 -15 430 15" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
