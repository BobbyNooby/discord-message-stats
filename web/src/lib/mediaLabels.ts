/**
 * How a media item names its source and its kind, in words a reader can read.
 *
 * Discord stores the literal string `unprovidenced` when it cannot name an
 * embed's provider (`rollups/build.py` uses it as a bucket). It is a sentinel,
 * not a label: §UI/UX rule 1 says no internal sentinel is visible, so every
 * card goes through `providerLabel` rather than printing the raw column.
 *
 * The helper takes a URL because the sentinel hides two different things: an
 * attachment somebody uploaded to Discord's own CDN, and a link nothing could
 * name at all. A provider-only list has no URL to offer, so it passes the
 * provider name and gets "No provider" — the honest half of the distinction.
 */

/** Discord's word for "I could not name this". */
const UNNAMED = "unprovidenced";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function providerLabel(provider: string, url: string): string {
  if (provider && provider !== UNNAMED) return provider;
  return /(^|\.)(discordapp\.(com|net))$/.test(hostOf(url)) ? "Direct upload" : "No provider";
}

/** Embed kinds as they are said out loud; an unknown kind is left alone. */
const KIND_LABELS: Record<string, string> = { gifv: "GIF" };

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

const nf = new Intl.NumberFormat("en-US");

/** "posted 63 times", not "63×": the count is a sentence a reader can read. */
export function postedLabel(uses: number): string {
  const count = nf.format(Math.round(uses));
  return uses === 1 ? "posted 1 time" : `posted ${count} times`;
}
