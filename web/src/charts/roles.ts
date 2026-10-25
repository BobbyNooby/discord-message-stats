import { swatch, token } from "./palette";

/*
 * Which series slot each Media & reactions card draws in. Colours come from the
 * one palette, except the remainder of a two-part doughnut: that slice is
 * deliberately muted so "text only" and "standalone" never read as a category
 * of their own.
 *
 * These are functions, not constants, on purpose: a module-scope constant would
 * freeze the fallback at import time and never see a fork's `--chart-N`
 * override. They read the variable when a panel renders.
 */
export const mediaColor = () => swatch(1);
export const replyColor = () => swatch(4);
export const attachColor = () => swatch(5);
export const emojiColor = () => swatch(1);
export const reactionColor = () => swatch(2);
export const activeDaysColor = () => swatch(2);
export const remainderColor = () => token("--chart-remainder");
