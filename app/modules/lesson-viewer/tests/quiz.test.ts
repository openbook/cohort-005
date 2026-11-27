import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import {
  calculateGrade,
  computeResult,
  getBestAttempt,
  getQuizById,
  getQuizByLessonId,
  getQuizWithQuestions,
} from "../quiz.server";
import { addLesson, addModule, addQuestion, addQuiz, setUp } from "./fixtures";

let world: ReturnType<typeof setUp>;
let lessonId: number;
let quiz: ReturnType<typeof addQuiz>;
let mc: ReturnType<typeof addQuestion>;
let tf: ReturnType<typeof addQuestion>;

beforeEach(() => {
  world = setUp();
  const mod = addModule(world.db, world.course.id, { title: "M", position: 1 });
  lessonId = addLesson(world.db, mod.id, { title: "L", position: 1 }).id;
  quiz = addQuiz(world.db, lessonId);
  tf = addQuestion(world.db, quiz.id, {
    text: "TS is typed",
    type: QuestionType.TrueFalse,
    position: 2,
    options: ["True", "False"],
    correct: 0,
  });
  mc = addQuestion(world.db, quiz.id, {
    text: "Pick the type",
    type: QuestionType.MultipleChoice,
    position: 1,
    options: ["any", "unknown", "never"],
    correct: 1,
  });
});

describe("looking a quiz up", () => {
  it("finds the quiz by id and by lesson", () => {
    expect(getQuizById(world.db, quiz.id)?.lessonId).toBe(lessonId);
    expect(getQuizByLessonId(world.db, lessonId)?.id).toBe(quiz.id);
    expect(getQuizById(world.db, 9999)).toBeUndefined();
    expect(getQuizByLessonId(world.db, 9999)).toBeUndefined();
  });

  it("returns questions in position order with their options", () => {
    const full = getQuizWithQuestions(world.db, quiz.id);
    expect(full?.title).toBe("Check yourself");
    expect(full?.questions.map((q) => q.questionText)).toEqual([
      "Pick the type",
      "TS is typed",
    ]);
    expect(full?.questions[0].options.map((o) => o.optionText)).toEqual([
      "any",
      "unknown",
      "never",
    ]);
  });

  it("returns null for a quiz that does not exist", () => {
    expect(getQuizWithQuestions(world.db, 9999)).toBeNull();
  });
});

describe("calculateGrade", () => {
  it.each([
    [1, "A"],
    [0.9, "A"],
    [0.89, "B"],
    [0.8, "B"],
    [0.79, "C"],
    [0.7, "C"],
    [0.69, "D"],
    [0.6, "D"],
    [0.59, "F"],
    [0, "F"],
  ])("grades %s as %s", (score, grade) => {
    expect(calculateGrade(score)).toBe(grade);
  });
});

describe("computeResult", () => {
  const submit = (selectedAnswers: Record<number, number>) =>
    computeResult(world.db, {
      userId: world.user.id,
      quizId: quiz.id,
      selectedAnswers,
    });

  it("scores a perfect attempt and records it with its answers", () => {
    const result = submit({
      [mc.id]: mc.options[1].id,
      [tf.id]: tf.options[0].id,
    });

    expect(result).toMatchObject({
      score: 1,
      passed: true,
      grade: "A",
      totalCorrect: 2,
      totalQuestions: 2,
    });
    expect(result?.questionResults).toEqual([
      {
        questionId: mc.id,
        correct: true,
        selectedOptionId: mc.options[1].id,
        correctOptionId: mc.options[1].id,
      },
      {
        questionId: tf.id,
        correct: true,
        selectedOptionId: tf.options[0].id,
        correctOptionId: tf.options[0].id,
      },
    ]);

    const answers = world.db
      .select()
      .from(schema.quizAnswers)
      .where(eq(schema.quizAnswers.attemptId, result?.attemptId ?? -1))
      .all();
    expect(answers).toHaveLength(2);
  });

  it("marks wrong and unanswered questions, and records only answers given", () => {
    const result = submit({ [mc.id]: mc.options[0].id });

    expect(result).toMatchObject({
      score: 0,
      passed: false,
      grade: "F",
      totalCorrect: 0,
    });
    expect(result?.questionResults).toEqual([
      {
        questionId: mc.id,
        correct: false,
        selectedOptionId: mc.options[0].id,
        correctOptionId: mc.options[1].id,
      },
      {
        questionId: tf.id,
        correct: false,
        selectedOptionId: null,
        correctOptionId: null,
      },
    ]);
    const answers = world.db
      .select()
      .from(schema.quizAnswers)
      .where(eq(schema.quizAnswers.attemptId, result?.attemptId ?? -1))
      .all();
    expect(answers).toHaveLength(1);
  });

  it("does not pass at exactly 70%", () => {
    const extra = Array.from({ length: 8 }, (_, i) =>
      addQuestion(world.db, quiz.id, {
        text: `Q${i}`,
        type: QuestionType.TrueFalse,
        position: 10 + i,
        options: ["True", "False"],
        correct: 0,
      })
    );
    const answers: Record<number, number> = {};
    for (const q of extra.slice(0, 7)) answers[q.id] = q.options[0].id;

    const result = submit(answers);
    expect(result?.score).toBeCloseTo(0.7);
    expect(result?.passed).toBe(false);
  });

  it("keeps the best attempt", () => {
    submit({ [mc.id]: mc.options[1].id });
    submit({ [mc.id]: mc.options[1].id, [tf.id]: tf.options[0].id });
    submit({});

    expect(getBestAttempt(world.db, world.user.id, quiz.id)).toMatchObject({
      score: 1,
      passed: true,
    });
    expect(
      getBestAttempt(world.db, world.instructor.id, quiz.id)
    ).toBeUndefined();
  });

  it("scores a quiz with no questions as 0", () => {
    const empty = addQuiz(world.db, lessonId);
    const result = computeResult(world.db, {
      userId: world.user.id,
      quizId: empty.id,
      selectedAnswers: {},
    });
    expect(result).toMatchObject({
      score: 0,
      totalQuestions: 0,
      passed: false,
    });
  });

  it("returns null for a quiz that does not exist", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      computeResult(world.db, {
        userId: world.user.id,
        quizId: 9999,
        selectedAnswers: {},
      })
    ).toBeNull();
    log.mockRestore();
  });
});
