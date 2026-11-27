import { useState } from "react";
import { useFetcher } from "react-router";
import { NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { noteLength, type NoteLength } from "~/modules/lesson-note";
import { cn, formatRelativeTime } from "~/lib/utils";

type SavedNote = { body: string; updatedAt: string };

const LENGTH_ID = "lesson-note-length";

export function LessonNote({ note }: { note: SavedNote | null }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [body, setBody] = useState(note?.body ?? "");
  const isSaving = fetcher.state !== "idle";
  const length = noteLength(body);
  const unchanged = body.trim() === (note?.body ?? "");

  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <div className="mb-1 flex items-center gap-2">
          <NotebookPen className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">Your notes</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Private to you. Find every note you&apos;ve written on your Saved
          page.
        </p>

        <fetcher.Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="save-note" />
          <Textarea
            name="body"
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Jot down what you want to remember from this lesson..."
            aria-label="Your notes"
            aria-describedby={LENGTH_ID}
            className="resize-y"
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={isSaving || length.empty || length.tooLong || unchanged}
            >
              {isSaving ? "Saving..." : note ? "Save changes" : "Save note"}
            </Button>
            <NoteStatus note={note} error={fetcher.data?.error} />
            <NoteCounter length={length} />
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function NoteStatus({
  note,
  error,
}: {
  note: SavedNote | null;
  error: string | undefined;
}) {
  if (error) {
    return (
      <span role="alert" className="text-sm text-destructive">
        {error}
      </span>
    );
  }
  if (!note) return null;
  return (
    <span suppressHydrationWarning className="text-xs text-muted-foreground">
      Last edited {formatRelativeTime(note.updatedAt)}
    </span>
  );
}

function NoteCounter({ length }: { length: NoteLength }) {
  return (
    <span
      id={LENGTH_ID}
      className={cn(
        "ml-auto text-xs tabular-nums",
        length.tooLong ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {length.label} characters
    </span>
  );
}
