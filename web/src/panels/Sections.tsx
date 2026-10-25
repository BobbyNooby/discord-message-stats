import { Fragment, type Dispatch, type ReactNode } from "react";

import type { Payload } from "../api/types";
import { CARD_COLUMNS, SectionHeading } from "../components/Panel";
import { SectionScopeNote } from "../components/SectionScopeNote";
import type { Action, Filters } from "../app/reducer";
import { Activity } from "./Activity";
import { Attachments } from "./Attachments";
import { AuthorRadar } from "./AuthorRadar";
import { Burstiness } from "./Burstiness";
import { Calendar } from "./Calendar";
import { ChatHealth } from "./ChatHealth";
import { Conversational } from "./Conversational";
import { Cumulative } from "./Cumulative";
import { EditRate } from "./EditRate";
import { EmbedTypes } from "./EmbedTypes";
import { Emoji } from "./Emoji";
import { Heat } from "./Heat";
import { Leaderboard } from "./Leaderboard";
import { LinkDomains } from "./LinkDomains";
import { MessagesPerYear } from "./MessagesPerYear";
import { MessageTypes } from "./MessageTypes";
import { Providers } from "./Providers";
import { Reactions } from "./Reactions";
import { RepliesVsStandalone } from "./RepliesVsStandalone";
import { ReplyBalance } from "./ReplyBalance";
import { ReplyMatrix } from "./ReplyMatrix";
import { ReplyNetwork } from "./ReplyNetwork";
import { ResponseTime } from "./ResponseTime";
import { EmbedsByProvider, MostReposted } from "./RichMedia";
import { Season } from "./Season";
import { ShareOfVoice } from "./ShareOfVoice";
import { ShareOfVoiceByYear } from "./ShareOfVoiceByYear";
import { Starters } from "./Starters";
import { StatCards } from "./StatCards";
import { Stream } from "./Stream";
import { TextVsMedia } from "./TextVsMedia";
import { TimeOfDay } from "./TimeOfDay";
import { TopLinks } from "./TopLinks";
import { Treemap } from "./Treemap";
import { WhoSaysIt } from "./WhoSaysIt";
import { WhoWrites } from "./WhoWrites";
import { WordCloud } from "./WordCloud";
import { WordIndex } from "./WordIndex";
import { WordLift } from "./WordLift";
import { SECTIONS, type BuiltInPanelId, type SectionId } from "./registry";

type SectionProps = {
  payload: Payload;
  filters: Filters;
  /** The word index picks the dashboard's word; nothing else dispatches. */
  dispatch?: Dispatch<Action>;
};

type CardProps = Required<SectionProps>;

/**
 * How each built-in card is mounted, by the id its spec declares. Keyed by the
 * registry's own ids, so a spec with no card here (or a card for no spec) is a
 * type error rather than a gap on the page. Which section a card sits in, and in
 * what order, is the registry's to say.
 */
const CARDS: Record<BuiltInPanelId, (props: CardProps) => ReactNode> = {
  "stat-cards": (props) => <StatCards {...props} />,
  "share-of-voice": (props) => <ShareOfVoice {...props} />,
  "messages-per-year": (props) => <MessagesPerYear {...props} />,
  "share-of-voice-year-by-year": (props) => <ShareOfVoiceByYear {...props} />,

  "messages-over-time": (props) => <Activity {...props} />,
  "cumulative-growth": (props) => <Cumulative {...props} />,
  "how-conversational": (props) => <Conversational {...props} />,
  "every-day-six-years": ({ payload, filters }) => (
    <div>
      <Calendar payload={payload} filters={filters} />
    </div>
  ),
  "when-the-chat-comes-alive": (props) => <Heat {...props} />,
  "what-time-of-day": (props) => <TimeOfDay {...props} />,
  "which-month-of-the-year": (props) => <Season {...props} />,
  "who-was-talking-when": (props) => <Stream {...props} />,

  "who-talks-the-most": (props) => <Leaderboard {...props} />,
  "who-writes-the-most": (props) => <WhoWrites {...props} />,
  "how-fast-people-reply": (props) => <ResponseTime {...props} />,
  "who-replies-to-whom": (props) => <ReplyNetwork {...props} />,
  "reply-balance": (props) => <ReplyBalance {...props} />,
  "who-starts-conversations": (props) => <Starters {...props} />,
  "author-profile": (props) => <AuthorRadar {...props} />,
  "reply-matrix": (props) => <ReplyMatrix {...props} />,
  "volume-by-author-and-year": (props) => <Treemap {...props} />,
  "how-bursty-is-everyone": (props) => <Burstiness {...props} />,
  "who-proofreads": (props) => <EditRate {...props} />,

  "word-lift": (props) => <WordLift {...props} />,
  "word-index": ({ payload, filters, dispatch }) => (
    <WordIndex
      payload={payload}
      selected={filters.word}
      onSelect={(word) => dispatch({ type: "setWord", word })}
    />
  ),
  "who-says-it": ({ payload, filters }) => (
    <WhoSaysIt payload={payload} filters={filters} word={filters.word} />
  ),
  "word-cloud": (props) => <WordCloud {...props} />,

  "where-the-chat-lives": (props) => <LinkDomains {...props} />,
  "embed-providers": (props) => <Providers {...props} />,
  "most-reposted-links": (props) => <TopLinks {...props} />,
  "embed-types": (props) => <EmbedTypes {...props} />,

  "most-reposted": (props) => <MostReposted {...props} />,
  "embeds-by-provider": (props) => <EmbedsByProvider {...props} />,

  "text-vs-media": (props) => <TextVsMedia {...props} />,
  "replies-vs-standalone": (props) => <RepliesVsStandalone {...props} />,
  "message-types": (props) => <MessageTypes {...props} />,
  "what-gets-attached": (props) => <Attachments {...props} />,
  "emoji-in-text": (props) => <Emoji {...props} />,
  "reactions": (props) => <Reactions {...props} />,
  "chat-health": (props) => <ChatHealth {...props} />,
};

/**
 * Where each section lands on the page: the anchor the jump links scroll to,
 * and how its cards are laid out. Overview is a grid so the stat cards can span
 * both columns; every other section packs its cards in columns.
 */
const PAGE: Record<SectionId, { anchor: string; layout: string }> = {
  overview: { anchor: "sec-overview", layout: "grid grid-cols-1 gap-4 md:grid-cols-2" },
  time: { anchor: "sec-time", layout: CARD_COLUMNS },
  people: { anchor: "sec-people", layout: CARD_COLUMNS },
  words: { anchor: "sec-words", layout: CARD_COLUMNS },
  links: { anchor: "sec-links", layout: CARD_COLUMNS },
  "rich-media": { anchor: "sec-media-rich", layout: CARD_COLUMNS },
  media: { anchor: "sec-media", layout: CARD_COLUMNS },
};

const ignoreAction: Dispatch<Action> = () => {};

/** One section of the dashboard (§11.1): its heading, its scope note and its cards, read off the registry. */
export function PanelSection({
  section,
  payload,
  filters,
  dispatch = ignoreAction,
}: SectionProps & { section: SectionId }) {
  const { anchor, layout } = PAGE[section];
  const spec = SECTIONS.find((entry) => entry.id === section);
  if (!spec) return null;
  return (
    <section aria-labelledby={anchor} className="space-y-4">
      <SectionHeading id={anchor}>{spec.label}</SectionHeading>
      <SectionScopeNote section={section} />
      <div className={layout}>
        {spec.panels.map((id) => (
          <Fragment key={id}>{CARDS[id]({ payload, filters, dispatch })}</Fragment>
        ))}
      </div>
    </section>
  );
}

/** Every built-in section, in the page order the registry declares. */
export function PanelSections(props: SectionProps) {
  return (
    <>
      {SECTIONS.map((section) => (
        <PanelSection key={section.id} section={section.id} {...props} />
      ))}
    </>
  );
}
