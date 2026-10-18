// Original line ornaments. Colors come from CSS (currentColor).
export function CornerSprig({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 80 80" aria-hidden="true" focusable="false">
      <path d="M6 74 Q20 40 52 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M18 50 q-10 -6 -8 -18 q10 4 8 18 z" fill="currentColor" opacity="0.55" />
      <path d="M22 44 q12 -2 18 8 q-12 4 -18 -8 z" fill="currentColor" opacity="0.55" />
      <path d="M32 32 q-8 -8 -2 -18 q8 6 2 18 z" fill="currentColor" opacity="0.55" />
      <path d="M36 28 q12 0 16 10 q-12 2 -16 -10 z" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
