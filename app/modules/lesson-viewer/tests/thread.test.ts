import { describe, it, expect, beforeEach } from "vitest";
import { markdown } from "~/lib/text";
import {
  getCommentById,
  getLessonThread,
  renderThread,
  type ThreadComment,
} from "../thread.server";
import { addAdmin, addComment, addLesson, addModule, setUp } from "./fixtures";

let world: ReturnType<typeof setUp>;
let lessonId: number;

const at = (minute: number) =>
  new Date(Date.UTC(2026, 0, 1, 10, minute)).toISOString();

beforeEach(() => {
  world = setUp();
  const mod = addModule(world.db, world.course.id, { title: "M", position: 1 });
  lessonId = addLesson(world.db, mod.id, { title: "L", position: 1 }).id;
});

describe("getLessonThread", () => {
  it("is empty for a lesson that does not exist", () => {
    expect(getLessonThread(world.db, 9999)).toEqual([]);
  });

  it("nests replies under their question, oldest first", () => {
    const question = addComment(world.db, {
      lessonId,
      userId: world.user.id,
      body: "Why?",
      at: at(1),
      edited: true,
    });
    addComment(world.db, {
      lessonId,
      userId: world.instructor.id,
      body: "Because.",
      at: at(2),
      parentId: question.id,
    });
    addComment(world.db, {
      lessonId,
      userId: world.user.id,
      body: "Second question",
      at: at(3),
    });

    const thread = getLessonThread(world.db, lessonId);

    expect(thread).toHaveLength(2);
    expect(thread[0]).toMatchObject({
      id: question.id,
      body: "Why?",
      createdAt: at(1),
      editedAt: at(1),
      deleted: false,
      author: {
        id: world.user.id,
        name: "Test User",
        isInstructor: false,
        isPlatformAdmin: false,
      },
    });
    expect(thread[0].replies).toHaveLength(1);
    expect(thread[0].replies[0]).toMatchObject({
      body: "Because.",
      author: { isInstructor: true, isPlatformAdmin: false },
      replies: [],
    });
    expect(thread[1].body).toBe("Second question");
  });

  it("marks a platform admin's comment", () => {
    const admin = addAdmin(world.db);
    addComment(world.db, { lessonId, userId: admin.id, body: "Hi", at: at(1) });
    expect(getLessonThread(world.db, lessonId)[0].author).toMatchObject({
      isPlatformAdmin: true,
      isInstructor: false,
    });
  });

  it("blanks a deleted question that still has replies", () => {
    const question = addComment(world.db, {
      lessonId,
      userId: world.user.id,
      body: "Secret",
      at: at(1),
      deleted: true,
      edited: true,
    });
    addComment(world.db, {
      lessonId,
      userId: world.instructor.id,
      body: "Answer",
      at: at(2),
      parentId: question.id,
    });

    const [shown] = getLessonThread(world.db, lessonId);
    expect(shown).toMatchObject({ body: "", editedAt: null, deleted: true });
    expect(shown.replies).toHaveLength(1);
  });

  it("hides a deleted question with no replies, and deleted replies", () => {
    addComment(world.db, {
      lessonId,
      userId: world.user.id,
      body: "Gone",
      at: at(1),
      deleted: true,
    });
    const kept = addComment(world.db, {
      lessonId,
      userId: world.user.id,
      body: "Kept",
      at: at(2),
    });
    addComment(world.db, {
      lessonId,
      userId: world.instructor.id,
      body: "Removed reply",
      at: at(3),
      parentId: kept.id,
      deleted: true,
    });

    const thread = getLessonThread(world.db, lessonId);
    expect(thread.map((c) => c.body)).toEqual(["Kept"]);
    expect(thread[0].replies).toEqual([]);
  });
});

describe("getCommentById", () => {
  it("finds a comment, and nothing for an unknown id", () => {
    const comment = addComment(world.db, {
      lessonId,
      userId: world.user.id,
      body: "Hello",
      at: at(1),
    });
    expect(getCommentById(world.db, comment.id)?.lessonId).toBe(lessonId);
    expect(getCommentById(world.db, 9999)).toBeUndefined();
  });
});

describe("renderThread", () => {
  const author = {
    id: 1,
    name: "A",
    avatarUrl: null,
    isInstructor: false,
    isPlatformAdmin: false,
  };
  const node = (
    body: string,
    deleted = false,
    replies: ThreadComment[] = []
  ): ThreadComment => ({
    id: 1,
    body: markdown(body),
    createdAt: at(1),
    editedAt: null,
    deleted,
    author,
    replies,
  });

  it("renders bodies, replies included, and escapes raw HTML", async () => {
    const [rendered] = await renderThread([
      node("**bold** <script>x()</script>", false, [node("_reply_")]),
    ]);
    expect(rendered.bodyHtml).toContain("<strong>bold</strong>");
    expect(rendered.bodyHtml).not.toContain("<script>");
    expect(rendered.replies[0].bodyHtml).toContain("<em>reply</em>");
  });

  it("renders nothing for a deleted comment", async () => {
    const [rendered] = await renderThread([node("hidden", true)]);
    expect(rendered.bodyHtml).toBe("");
  });
});
