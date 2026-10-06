'use client';

import React, { useEffect, useState } from 'react';
import { enqueueSignedDisplayUrl } from '@/lib/storage-display-client';
import { LIST_THUMB_WIDTH, PHOTO_PLACEHOLDER, immediateDisplayUrl, photoImgOnError } from '@/lib/storage-display';

export function StorageImage({
  src,
  alt = '',
  className,
  width = LIST_THUMB_WIDTH,
  loading = 'lazy',
  onClick,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  width?: number;
  loading?: 'lazy' | 'eager';
  onClick?: () => void;
}) {
  const immediate = immediateDisplayUrl(src, width);
  const [resolved, setResolved] = useState<string | null>(immediate.sign ? null : immediate.src);

  useEffect(() => {
    const next = immediateDisplayUrl(src, width);
    if (!next.sign) {
      setResolved(next.src);
      return;
    }
    let live = true;
    setResolved(null);
    enqueueSignedDisplayUrl(src, width).then((url) => {
      if (live) setResolved(url);
    });
    return () => {
      live = false;
    };
  }, [src, width]);

  const shown = resolved || (immediate.sign ? PHOTO_PLACEHOLDER : immediate.src);
  if (!shown) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={shown} alt={alt} className={className} loading={loading} onClick={onClick} onError={photoImgOnError} />
  );
}
