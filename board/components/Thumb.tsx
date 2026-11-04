// Copied from the site's hosted/components/Thumb.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
'use client';

import { ImagePreview } from '@/components/ui/preview';

/** A thumbnail that previews large on hover. Sized by the parent. */
export function Thumb({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  if (!src) return <div className={className} />;
  return (
    <ImagePreview src={src} alt={alt}>
      <div className={className}><img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" /></div>
    </ImagePreview>
  );
}
