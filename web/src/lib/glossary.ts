import type { PanelId } from "../panels/registry";

/**
 * What each card shows, and what its jargon means — said once.
 *
 * "63×" and "lift 2.4" are conventions, not sentences (§UI/UX rule 1). Rather
 * than explain `lift` in the six places it appears, or leave a card to be
 * decoded from its own subtitle, every card gets one line here and the shared
 * terms get one tooltip.
 *
 * `Record<PanelId, string>` is deliberate: adding a card without saying what it
 * shows is a type error, not a silent gap.
 */
export const PANEL_ABOUT: Record<PanelId, string> = {
  // Overview
  "stat-cards": "The headline totals for whatever the filters currently select.",
  "share-of-voice": "Each author's share of the messages in view.",
  "messages-per-year": "How many messages each calendar year holds.",
  "share-of-voice-year-by-year":
    "The same mix as Share of voice, one doughnut per year, so a shift over time is visible.",

  // Time & rhythm
  "messages-over-time": "Messages per bucket across the whole window, by author or in total.",
  "cumulative-growth": "Every author's running total, so the growth curve is readable.",
  "how-conversational": "What share of each bucket's messages are replies to something.",
  "every-day-six-years": "One square per day; the colour is how many messages that day holds.",
  "when-the-chat-comes-alive": "Which weekday-and-hour slots carry the traffic.",
  "what-time-of-day": "Messages by hour of the day, in the timezone the rollups were built in.",
  "which-month-of-the-year": "All years pooled into twelve bars, which is how a seasonal habit shows.",
  "who-was-talking-when": "Each author's share of each bucket, drawn as a streamgraph.",

  // People
  "who-talks-the-most": "Authors ranked by messages, honouring the time and author filters.",
  "who-writes-the-most": "The same messages ranked by characters, so the long posts win.",
  "how-fast-people-reply": "The average wait before someone answers each author.",
  "who-replies-to-whom": "Who answers whom, as a network; node size is message volume.",
  "reply-balance": "Replies sent against replies received; on the diagonal is even.",
  "who-starts-conversations": "Who opens a conversation, read from the reply structure.",
  "author-profile": "Six traits per author, each normalised to the busiest author on that trait.",
  "reply-matrix": "A grid of who replies to whom, cell by cell.",
  "volume-by-author-and-year": "Author by year, sized by messages — the long view of who was present.",
  "how-bursty-is-everyone": "Each author's daily totals as a boxplot: how spiky their posting is.",
  "who-proofreads": "How often each author edits a message after sending it.",

  // Words
  "word-lift": "Words that are a signature of one person rather than of the chat as a whole.",
  "word-index": "Search the embedded word index; pick a word to see who says it.",
  "who-says-it": "Who uses the selected word, and how often.",
  "word-cloud": "The most-used words, sized by count. Decorative — the totals live in the other cards.",

  // Links & embeds
  "where-the-chat-lives": "Which domains the chat links to, honouring the time and author filters.",
  "embed-providers": "Which services Discord unfurls, from Tenor to YouTube.",
  "most-reposted-links": "The individual links that get posted again and again.",
  "embed-types": "Discord's embed kinds — video, GIF, link, article — across every embed.",

  // Media & reactions
  "text-vs-media": "What share of messages carry an image, video or embed.",
  "replies-vs-standalone": "What share of messages are replies rather than openers.",
  "message-types": "Every message by Discord's own type, including the types the counts exclude.",
  "what-gets-attached": "Which file types are uploaded, by mime type.",
  "emoji-in-text": "Which emoji are typed into message text, as opposed to reacted with.",
  reactions: "Which emoji are used as reactions.",
  "chat-health": "Replies, media and active-day share as percentages of the filtered window.",

  // Rich media
  "most-reposted": "The same GIF or link posted again and again, ranked by how many times.",
  "embeds-by-provider": "How many embeds each provider contributed.",
};

/** One line of jargon, for a tooltip rather than a paragraph in six cards. */
export const TERMS = {
  lift:
    "Lift = how much more often a person uses this word than their share of all words would predict. " +
    "1.0× is exactly their average; 2.0× is twice as often.",
  averageWait:
    "Average wait = the mean time between a message and the first reply to it, weighted by how many " +
    "replies each author received.",
  globalOnly:
    "This card has no date column in the rollups, so the time filter cannot apply to it. " +
    "Author switches still do, where the card says so.",
} as const;

export type Term = keyof typeof TERMS;

/** The one-liner under a card's title; `undefined` for a card not in the registry. */
export function panelAbout(id: PanelId | undefined): string | undefined {
  return id ? PANEL_ABOUT[id] : undefined;
}
