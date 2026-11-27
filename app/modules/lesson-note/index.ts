import { measureNoteLength, type NoteLength } from "./lib/note-length";

export type { NoteLength };

/**
 * How long a draft Note is against the limit, counted the way `saveNote`
 * counts it, so the counter under the box never disagrees with the server.
 */
export function noteLength(body: string): NoteLength {
  return measureNoteLength(body);
}
