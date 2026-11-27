import { MAX_NOTE_LENGTH } from "~/lib/notes";

export type NoteLength = {
  /** Characters that will be saved: the server trims the body first. */
  count: number;
  limit: number;
  remaining: number;
  empty: boolean;
  tooLong: boolean;
  /** "1,234 / 2,000", ready to show under the box. */
  label: string;
};

const format = (n: number) => n.toLocaleString("en");

export function measureNoteLength(body: string): NoteLength {
  const count = body.trim().length;
  return {
    count,
    limit: MAX_NOTE_LENGTH,
    remaining: MAX_NOTE_LENGTH - count,
    empty: count === 0,
    tooLong: count > MAX_NOTE_LENGTH,
    label: `${format(count)} / ${format(MAX_NOTE_LENGTH)}`,
  };
}
