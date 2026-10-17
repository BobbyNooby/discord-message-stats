import { CARD_COLUMNS, SectionHeading } from "../components/Panel";
import { SectionScopeNote } from "../components/SectionScopeNote";
import { Attachments } from "./Attachments";
import { ChatHealth } from "./ChatHealth";
import { Emoji } from "./Emoji";
import { MessageTypes } from "./MessageTypes";
import { Reactions } from "./Reactions";
import { RepliesVsStandalone } from "./RepliesVsStandalone";
import { TextVsMedia } from "./TextVsMedia";
import type { MediaPanelProps } from "./mediaData";

/**
 * The seven panels of the Media & reactions section (§11.1). Every one of them
 * is a pure function of `(payload, filters)`; the four cards whose rollups have
 * no date column are named once by the section note above them.
 */
export function MediaSection({ payload, filters }: MediaPanelProps) {
  return (
    <section aria-labelledby="sec-media" className="space-y-4">
      <SectionHeading id="sec-media">Media &amp; reactions</SectionHeading>
      <SectionScopeNote section="media" />
      <div className={CARD_COLUMNS}>
        <TextVsMedia payload={payload} filters={filters} />
        <RepliesVsStandalone payload={payload} filters={filters} />
        <MessageTypes payload={payload} filters={filters} />
        <Attachments payload={payload} filters={filters} />
        <Emoji payload={payload} filters={filters} />
        <Reactions payload={payload} filters={filters} />
        <ChatHealth payload={payload} filters={filters} />
      </div>
    </section>
  );
}
