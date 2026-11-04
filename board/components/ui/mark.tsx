// Copied from the site's hosted/components/ui/mark.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
/**
 * The Arbiter mark: a rounded tile with the letter cut from it. The tile takes the current text
 * colour and the letter the page background, so it inverts in dark mode on its own. Where the
 * letter must be something else (a light tile on a dark surface), pass `letter`.
 * Source: public/brand/mark-dark.svg and mark-light.svg.
 */
export const MARK_LETTER = 'M26.4434 21.5508C32.1562 21.5509 37.1773 24.5124 40.0547 28.9844L40.5361 29.583L53.3994 47.5586V53.8984H45.7041L31.5664 34.2197H31.5645C30.45 32.732 28.6728 31.7695 26.6709 31.7695C23.2967 31.7697 20.5618 34.5047 20.5615 37.8789C20.5615 41.2533 23.2965 43.989 26.6709 43.9893C29.567 43.9893 31.9906 41.974 32.6201 39.2695L38.8975 48.042C35.9308 51.619 31.4536 53.8983 26.4434 53.8984C17.5109 53.8984 10.2697 46.657 10.2695 37.7246C10.2695 28.792 17.5108 21.5508 26.4434 21.5508ZM37.4053 10.4082C43.3357 10.4082 53.3994 14.0025 53.3994 26.2227V43.9814L43.3359 29.9189V25.6836C43.3359 21.0112 38.4835 20.292 37.4053 20.292H18.3564L10.2695 10.4082H37.4053Z';

export function Mark({ size = 20, className, letter = 'var(--bg)' }: { size?: number; className?: string; letter?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="8.11884" fill="currentColor" />
      <path d={MARK_LETTER} fill={letter} />
    </svg>
  );
}

/** The lockup — mark and the lowercase wordmark, 8px apart, semibold tight. The only way the two appear together. */
export function Lockup({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ''}`}>
      <Mark size={size} className="shrink-0" />
      <span className="truncate">arbiter</span>
    </span>
  );
}
