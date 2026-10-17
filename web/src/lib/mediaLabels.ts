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

/**
 * When Discord names no provider, the host is the only evidence left — and it
 * is good evidence: Instagram and some Twitter links arrive as `unprovidenced`,
 * so an anonymous "No provider" hides exactly the services a reader wants to
 * tell apart. Each pattern is anchored to a whole label or a dot boundary, so
 * `notinstagram.com` is not Instagram.
 *
 * This stays a *label*, never a filter key: the server's provider filter
 * matches Discord's exact string, and nothing here rewrites that.
 */
const HOST_LABELS: readonly [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(x\.com|twitter\.com)$/, "Twitter / X"],
  [/(^|\.)(youtu\.be|youtube\.com)$/, "YouTube"],
  [/(^|\.)reddit\.com$/, "Reddit"],
];

export function providerLabel(provider: string, url: string): string {
  if (provider && provider !== UNNAMED) return provider;
  const host = hostOf(url);
  if (/(^|\.)discordapp\.(com|net)$/.test(host)) return "Direct upload";
  for (const [pattern, label] of HOST_LABELS) {
    if (pattern.test(host)) return label;
  }
  return "No provider";
}

/** One provider a reader can filter by: the raw name the API matches, and the
 *  label they see. Shared by the card's chip row, the full view and the scoped
 *  sidebar so the three can never offer different options. */
export type ProviderChoice = { value: string; label: string; count: number };

export function providerChoices(providers: readonly (readonly [string, number])[]): ProviderChoice[] {
  return providers
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ value: name, label: providerLabel(name, name), count }))
    .sort((a, b) => b.count - a.count);
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
