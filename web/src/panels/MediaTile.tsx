import { Play } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { MediaRow } from "../api/types";
import { kindLabel, postedLabel, providerLabel } from "../lib/mediaLabels";
import { useReducedMotion } from "../lib/motion";

/**
 * One media item, as the card and the top-50 view both draw it: a thumbnail
 * that respects `media.thumbnails`, the item's name, and its repost count said
 * in words ("posted 63 times · Tenor GIF"). The caller passes the item's `rank`
 * — its position in the list it is drawn in — because the count alone cannot
 * order two links that were posted the same number of times.
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

/**
 * One preview box for every tile. A GIF is never cropped: the asset keeps its
 * own aspect ratio and fits inside the box whole, so a tall portrait GIF and a
 * wide landscape one occupy the same space and the ranking does not look ragged.
 * The letterboxing sits on the surface colour, so it reads as the frame rather
 * than as a gap.
 */
const FRAME = "flex h-24 w-full items-center justify-center overflow-hidden bg-[var(--color-surface)]";
/** The media itself is bounded, not the box: a huge GIF scales down instead of
 *  stretching the tile or pushing the caption row off. */
const MEDIA = "mx-auto max-h-full max-w-full object-contain";

/**
 * What a tap on the tile does: open the detail view when the caller offers one,
 * otherwise follow the link as the tile always did.
 */
function Target({
  url,
  onOpen,
  label,
  children,
}: {
  url: string;
  onOpen?: () => void;
  label: string;
  children: ReactNode;
}) {
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} aria-label={label} className="block w-full text-left">
        {children}
      </button>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="block">
      {children}
    </a>
  );
}

function Thumbnail({
  src,
  animated,
  provider,
  url,
  onOpen,
  label,
}: {
  src: string | null;
  animated: string | null;
  provider: string;
  url: string;
  onOpen?: () => void;
  label: string;
}) {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  // Reduced motion shows the poster with a play control; pressing it is the
  // reader asking for this one animation, so it may then autoplay.
  const [activated, setActivated] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const playable = Boolean(animated && isPlayable(animated) && !failed);
  usePauseOffscreen(video, playable && !reduced);

  const playing = playable && (!reduced || activated);
  // Every branch draws inside the same box, so a loaded tile, a failed one and
  // an animated one all take identical space.
  const frame = (
    <div className={FRAME}>
      {playing ? (
        // A gifv's playable asset is an mp4: it animates (the thumbnail is often
        // a static poster) and it is usually much smaller than the GIF.
        <video
          ref={video}
          src={animated as string}
          poster={src ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          onError={() => setFailed(true)}
          className={MEDIA}
        />
      ) : src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={MEDIA}
        />
      ) : (
        <span className="px-2 text-center text-xs text-[var(--color-muted)]">{provider}</span>
      )}
    </div>
  );

  if (playable && reduced && !playing) {
    // The button is a sibling of the link, not a child: a control inside an
    // anchor is invalid HTML and clicking it would follow the link.
    return (
      <div className="relative">
        <Target url={url} onOpen={onOpen} label={label}>
          {frame}
        </Target>
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
    <Target url={url} onOpen={onOpen} label={label}>
      {frame}
    </Target>
  );
}

export function MediaTile({
  row,
  mode,
  rank,
  onOpen,
}: {
  row: MediaRow;
  mode: string;
  rank: number;
  /** Open this item's detail view; without it the tile links to the original. */
  onOpen?: () => void;
}) {
  const [url, provider, kind, title, thumbnail, animated, uses] = row;
  const src = thumbnailSrc(thumbnail || url, mode);
  const animatedSrc = thumbnailSrc(animated || "", mode);
  const name = providerLabel(provider, url);
  const caption = `${postedLabel(uses)} · ${name} ${kindLabel(kind)}`;
  const label = `Who posted ${mediaName(url, title)}`;

  return (
    <li className="overflow-hidden rounded border border-[var(--color-line)]">
      <Thumbnail src={src} animated={animatedSrc} provider={name} url={url} onOpen={onOpen} label={label} />
      <Target url={url} onOpen={onOpen} label={label}>
        <div className="flex items-start gap-2 p-2">
          {/* The list position, not the count: two links can be posted the same
              number of times, and only the ranking says which came first. A
              fixed gutter with tabular figures keeps #1…#50 aligned. */}
          <span
            className={`w-9 shrink-0 text-right text-lg font-bold leading-none tabular-nums ${
              rank <= 3 ? "text-[var(--color-accent)]" : "text-[var(--color-text)]"
            }`}
          >
            #{rank}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-xs text-[var(--color-text)]" title={mediaName(url, title)}>
              {mediaName(url, title)}
            </p>
            <p className="truncate text-[10px] uppercase tracking-wide text-[var(--color-muted)]" title={caption}>
              {caption}
            </p>
          </div>
        </div>
      </Target>
    </li>
  );
}
