import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { QuestionType, UserRole } from "~/db/schema";
import { markdown } from "~/lib/text";

// The lesson-viewer module only reads these tables (or writes progress and
// attempts), so nothing in it can create the rows. They go in directly, in
// one place, so a schema change touches only this file.

export function setUp() {
  const db = createTestDb();
  const base = seedBaseData(db);
  return { db, ...base };
}

export function addModule(
  db: TestDb,
  courseId: number,
  { title, position }: { title: string; position: number }
) {
  return db
    .insert(schema.modules)
    .values({ courseId, title, position })
    .returning()
    .get();
}

export function addLesson(
  db: TestDb,
  moduleId: number,
  { title, position }: { title: string; position: number }
) {
  return db
    .insert(schema.lessons)
    .values({ moduleId, title, position })
    .returning()
    .get();
}

export function addWatchEvent(
  db: TestDb,
  event: {
    userId: number;
    lessonId: number;
    positionSeconds: number;
    at: string;
  }
) {
  db.insert(schema.videoWatchEvents)
    .values({
      userId: event.userId,
      lessonId: event.lessonId,
      eventType: "progress",
      positionSeconds: event.positionSeconds,
      createdAt: event.at,
    })
    .run();
}

export function addAdmin(db: TestDb) {
  return db
    .insert(schema.users)
    .values({
      name: "Ada Admin",
      email: "ada@example.com",
      role: UserRole.Admin,
    })
    .returning()
    .get();
}

export function addComment(
  db: TestDb,
  comment: {
    lessonId: number;
    userId: number;
    body: string;
    at: string;
    parentId?: number;
    deleted?: boolean;
    edited?: boolean;
  }
) {
  return db
    .insert(schema.comments)
    .values({
      lessonId: comment.lessonId,
      userId: comment.userId,
      parentId: comment.parentId ?? null,
      body: markdown(comment.body),
      createdAt: comment.at,
      editedAt: comment.edited ? comment.at : null,
      deletedAt: comment.deleted ? comment.at : null,
    })
    .returning()
    .get();
}

export function addQuiz(db: TestDb, lessonId: number) {
  return db
    .insert(schema.quizzes)
    .values({ lessonId, title: "Check yourself", passingScore: 0.7 })
    .returning()
    .get();
}

/** A question with its options; the option at `correct` is the right one. */
export function addQuestion(
  db: TestDb,
  quizId: number,
  question: {
    text: string;
    type: QuestionType;
    position: number;
    options: string[];
    correct: number;
  }
) {
  const row = db
    .insert(schema.quizQuestions)
    .values({
      quizId,
      questionText: question.text,
      questionType: question.type,
      position: question.position,
    })
    .returning()
    .get();
  const options = question.options.map((optionText, index) =>
    db
      .insert(schema.quizOptions)
      .values({
        questionId: row.id,
        optionText,
        isCorrect: index === question.correct,
      })
      .returning()
      .get()
  );
  return { ...row, options };
}
