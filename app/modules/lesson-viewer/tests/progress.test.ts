import { describe, it, expect, beforeEach } from "vitest";
import { LessonProgressStatus } from "~/db/schema";
import {
  calculateWatchProgress,
  getLastWatchPosition,
  getLessonProgress,
  getLessonProgressForCourse,
  markLessonComplete,
  markLessonInProgress,
} from "../progress.server";
import { addLesson, addModule, addWatchEvent, setUp } from "./fixtures";

let world: ReturnType<typeof setUp>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  world = setUp();
  const mod = addModule(world.db, world.course.id, { title: "M", position: 1 });
  lessonId = addLesson(world.db, mod.id, { title: "L1", position: 1 }).id;
  otherLessonId = addLesson(world.db, mod.id, { title: "L2", position: 2 }).id;
});

describe("lesson progress", () => {
  it("has no progress before the student opens the lesson", () => {
    expect(
      getLessonProgress(world.db, world.user.id, lessonId)
    ).toBeUndefined();
  });

  it("marks a lesson in progress, then completed", () => {
    markLessonInProgress(world.db, world.user.id, lessonId);
    expect(getLessonProgress(world.db, world.user.id, lessonId)?.status).toBe(
      LessonProgressStatus.InProgress
    );

    const done = markLessonComplete(world.db, world.user.id, lessonId);
    expect(done.status).toBe(LessonProgressStatus.Completed);
    expect(done.completedAt).not.toBeNull();
    expect(getLessonProgress(world.db, world.user.id, lessonId)?.id).toBe(
      done.id
    );
  });

  it("completes a lesson that was never opened", () => {
    const done = markLessonComplete(world.db, world.user.id, lessonId);
    expect(done.status).toBe(LessonProgressStatus.Completed);
    expect(done.completedAt).not.toBeNull();
  });

  it("does not move a completed lesson back to in progress", () => {
    markLessonComplete(world.db, world.user.id, lessonId);
    const again = markLessonInProgress(world.db, world.user.id, lessonId);
    expect(again.status).toBe(LessonProgressStatus.Completed);
  });

  it("moves a not-started lesson to in progress", () => {
    markLessonInProgress(world.db, world.user.id, lessonId);
    const again = markLessonInProgress(world.db, world.user.id, lessonId);
    expect(again.status).toBe(LessonProgressStatus.InProgress);
  });

  it("lists the student's progress across the course only", () => {
    markLessonInProgress(world.db, world.user.id, lessonId);
    markLessonComplete(world.db, world.user.id, otherLessonId);
    markLessonComplete(world.db, world.instructor.id, lessonId);

    const rows = getLessonProgressForCourse(
      world.db,
      world.user.id,
      world.course.id
    );
    expect(
      rows.map((r) => [r.lessonId, r.status]).sort((a, b) => +a[0] - +b[0])
    ).toEqual([
      [lessonId, LessonProgressStatus.InProgress],
      [otherLessonId, LessonProgressStatus.Completed],
    ]);
  });

  it("returns nothing for a course with no modules", () => {
    expect(getLessonProgressForCourse(world.db, world.user.id, 9999)).toEqual(
      []
    );
  });
});

describe("course with a module but no lessons", () => {
  it("returns no progress", () => {
    const fresh = setUp();
    addModule(fresh.db, fresh.course.id, { title: "Empty", position: 1 });
    expect(
      getLessonProgressForCourse(fresh.db, fresh.user.id, fresh.course.id)
    ).toEqual([]);
  });
});

describe("video watching", () => {
  it("resumes from the latest watch event", () => {
    expect(getLastWatchPosition(world.db, world.user.id, lessonId)).toBe(0);
    addWatchEvent(world.db, {
      userId: world.user.id,
      lessonId,
      positionSeconds: 90,
      at: "2026-01-01T10:00:00.000Z",
    });
    addWatchEvent(world.db, {
      userId: world.user.id,
      lessonId,
      positionSeconds: 30,
      at: "2026-01-01T11:00:00.000Z",
    });
    expect(getLastWatchPosition(world.db, world.user.id, lessonId)).toBe(30);
  });

  it("reports the furthest point watched as a percentage, capped at 100", () => {
    const at = "2026-01-01T10:00:00.000Z";
    const args = { userId: world.user.id, lessonId, videoDurationSeconds: 200 };
    expect(calculateWatchProgress(world.db, args)).toBe(0);

    addWatchEvent(world.db, {
      userId: world.user.id,
      lessonId,
      positionSeconds: 51,
      at,
    });
    addWatchEvent(world.db, {
      userId: world.user.id,
      lessonId,
      positionSeconds: 10,
      at,
    });
    expect(calculateWatchProgress(world.db, args)).toBe(26);

    addWatchEvent(world.db, {
      userId: world.user.id,
      lessonId,
      positionSeconds: 500,
      at,
    });
    expect(calculateWatchProgress(world.db, args)).toBe(100);
  });

  it("reports 0 for a video with no duration", () => {
    addWatchEvent(world.db, {
      userId: world.user.id,
      lessonId,
      positionSeconds: 50,
      at: "2026-01-01T10:00:00.000Z",
    });
    expect(
      calculateWatchProgress(world.db, {
        userId: world.user.id,
        lessonId,
        videoDurationSeconds: 0,
      })
    ).toBe(0);
  });
});
