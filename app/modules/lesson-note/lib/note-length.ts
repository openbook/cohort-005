import { MAX_NOTE_LENGTH } from "~/lib/notes";

export type NoteLength = {
  /** Characters that will be saved: the server trims the body first. */
  count: number;
  empty: boolean;
  tooLong: boolean;
  /** "1,234 / 2,000", ready to show under the box. */
  label: string;
};

const format = (n: number) => n.toLocaleString("en");

/**
 * How long a draft Note is against the limit, counted the way `saveNote`
 * counts it, so the counter under the box never disagrees with the server.
 */
export function noteLength(body: string): NoteLength {
  const count = body.trim().length;
  return {
    count,
    empty: count === 0,
    tooLong: count > MAX_NOTE_LENGTH,
    label: `${format(count)} / ${format(MAX_NOTE_LENGTH)}`,
  };
}
