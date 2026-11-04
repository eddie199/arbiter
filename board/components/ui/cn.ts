// Copied from the site's hosted/components/ui/cn.ts (site bff92c0, 4 Nov 2026). The local board owns it now.
export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
