import { useState } from "react";

import type { MediaRow } from "../api/types";
import { kindLabel, postedLabel, providerLabel } from "../lib/mediaLabels";

/**
 * One media item, as the card and the top-50 view both draw it: a thumbnail
 * that respects `media.thumbnails`, the item's name, and its repost count said
 * in words ("posted 63 times · Tenor GIF").
 *
 * A thumbnail that fails — too large, or the CDN said no — falls back to the
 * provider label rather than a broken-image icon.
 */

/** A readable name for a media item we have no title for. */
export function mediaName(url: string, title: string): string {
  if (title) return title;
  try {
    const parsed = new URL(url);
    const tail = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || url);
    return tail.replace(/[-_]+/g, " ").slice(0, 60);
  } catch {
    return url.slice(0, 60);
  }
}

/** A playable file, not a page about one: YouTube's `video.url` is its player. */
function isPlayable(url: string): boolean {
  return /\.(mp4|webm|gif)(\?|$)/i.test(url);
}

export function thumbnailSrc(url: string, mode: string): string | null {
  if (mode === "off" || !url) return null;
  if (mode === "direct") return url;
  return `/api/thumb?u=${encodeURIComponent(url)}`;
}

function Thumbnail({ src, animated, provider }: {
  src: string | null;
  animated: string | null;
  provider: string;
}) {
  const [failed, setFailed] = useState(false);
  if (animated && isPlayable(animated) && !failed) {
    // A gifv's playable asset is an mp4: it animates (the thumbnail is often a
    // static poster) and it is usually much smaller than the GIF.
    return (
      <video
        src={animated}
        poster={src ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        onError={() => setFailed(true)}
        className="h-24 w-full bg-[var(--color-surface)] object-cover"
      />
    );
  }
  if (!src || failed) {
    return (
      <div className="flex h-24 w-full items-center justify-center bg-[var(--color-surface)] text-xs text-[var(--color-muted)]">
        {provider}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-24 w-full bg-[var(--color-surface)] object-cover"
    />
  );
}

export function MediaTile({ row, mode }: { row: MediaRow; mode: string }) {
  const [url, provider, kind, title, thumbnail, animated, uses] = row;
  const src = thumbnailSrc(thumbnail || url, mode);
  const animatedSrc = thumbnailSrc(animated || "", mode);
  const name = providerLabel(provider, url);
  const caption = `${postedLabel(uses)} · ${name} ${kindLabel(kind)}`;

  return (
    <li className="overflow-hidden rounded border border-[var(--color-line)]">
      <a href={url} target="_blank" rel="noreferrer noopener" className="block">
        <Thumbnail src={src} animated={animatedSrc} provider={name} />
        <div className="space-y-1 p-2">
          <p className="truncate text-xs text-[var(--color-text)]" title={mediaName(url, title)}>
            {mediaName(url, title)}
          </p>
          <p className="truncate text-[10px] uppercase tracking-wide text-[var(--color-muted)]" title={caption}>
            {caption}
          </p>
        </div>
      </a>
    </li>
  );
}
