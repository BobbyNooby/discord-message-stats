import { Play } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { MediaRow } from "../api/types";
import { kindLabel, postedLabel, providerLabel } from "../lib/mediaLabels";
import { useReducedMotion } from "../lib/motion";

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

/**
 * An autoplaying tile is a video nobody asked for: when it scrolls out of view
 * it keeps decoding, which costs battery on the phone this dashboard is read on
 * most. Pausing is not a nicety here, it is the same mobile-data decision as
 * `prefers-reduced-motion`.
 */
function usePauseOffscreen(video: RefObject<HTMLVideoElement | null>, enabled: boolean): void {
  useEffect(() => {
    const element = video.current;
    if (!element || !enabled) return;
    // jsdom (and any browser without the API) keeps the plain autoplay path.
    if (typeof IntersectionObserver !== "function") return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) void element.play().catch(() => {});
        else element.pause();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [video, enabled]);
}

function Thumbnail({
  src,
  animated,
  provider,
  url,
}: {
  src: string | null;
  animated: string | null;
  provider: string;
  url: string;
}) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  // Reduced motion shows the poster with a play control; pressing it is the
  // reader asking for this one animation, so it may then autoplay.
  const [activated, setActivated] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const playable = Boolean(animated && isPlayable(animated) && !failed);
  usePauseOffscreen(video, playable && !reduced);

  if (playable && (!reduced || activated)) {
    // A gifv's playable asset is an mp4: it animates (the thumbnail is often a
    // static poster) and it is usually much smaller than the GIF.
    return (
      <video
        ref={video}
        src={animated as string}
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

  const poster =
    src && !failed ? (
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-24 w-full bg-[var(--color-surface)] object-cover"
      />
    ) : (
      <div className="flex h-24 w-full items-center justify-center bg-[var(--color-surface)] text-xs text-[var(--color-muted)]">
        {provider}
      </div>
    );

  if (playable && reduced) {
    // The button is a sibling of the link, not a child: a control inside an
    // anchor is invalid HTML and clicking it would follow the link.
    return (
      <div className="relative">
        <a href={url} target="_blank" rel="noreferrer noopener" className="block">
          {poster}
        </a>
        <button
          type="button"
          aria-label={`Play ${provider} animation`}
          onClick={() => setActivated(true)}
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-ink)]/80 text-[var(--color-text)]">
            <Play size={16} aria-hidden />
          </span>
        </button>
      </div>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="block">
      {poster}
    </a>
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
      <Thumbnail src={src} animated={animatedSrc} provider={name} url={url} />
      <a href={url} target="_blank" rel="noreferrer noopener" className="block">
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
