import { describe, it, expect, beforeEach } from "vitest";
import {
  flattenCourseLessons,
  getCourseWithDetails,
  getLessonById,
  getModuleById,
  getUserById,
} from "../course.server";
import { addLesson, addModule, setUp } from "./fixtures";

let world: ReturnType<typeof setUp>;

beforeEach(() => {
  world = setUp();
});

describe("getCourseWithDetails", () => {
  it("returns null for a course that does not exist", () => {
    expect(getCourseWithDetails(world.db, 9999)).toBeNull();
  });

  it("returns a course with no modules", () => {
    const course = getCourseWithDetails(world.db, world.course.id);
    expect(course).toMatchObject({
      id: world.course.id,
      title: "Test Course",
      instructorName: "Test Instructor",
      categoryName: "Programming",
      modules: [],
    });
  });

  it("orders modules and their lessons by position", () => {
    const second = addModule(world.db, world.course.id, {
      title: "Second",
      position: 2,
    });
    const first = addModule(world.db, world.course.id, {
      title: "First",
      position: 1,
    });
    addLesson(world.db, first.id, { title: "B", position: 2 });
    addLesson(world.db, first.id, { title: "A", position: 1 });
    addLesson(world.db, second.id, { title: "C", position: 1 });

    const course = getCourseWithDetails(world.db, world.course.id);

    expect(
      course?.modules.map((m) => [m.title, m.lessons.map((l) => l.title)])
    ).toEqual([
      ["First", ["A", "B"]],
      ["Second", ["C"]],
    ]);
  });
});

describe("single-row lookups", () => {
  it("finds a lesson, its module and a user by id", () => {
    const mod = addModule(world.db, world.course.id, {
      title: "M",
      position: 1,
    });
    const lesson = addLesson(world.db, mod.id, { title: "L", position: 1 });

    expect(getLessonById(world.db, lesson.id)?.title).toBe("L");
    expect(getModuleById(world.db, mod.id)?.title).toBe("M");
    expect(getUserById(world.db, world.user.id)?.name).toBe("Test User");
  });

  it("returns undefined for ids that do not exist", () => {
    expect(getLessonById(world.db, 9999)).toBeUndefined();
    expect(getModuleById(world.db, 9999)).toBeUndefined();
    expect(getUserById(world.db, 9999)).toBeUndefined();
  });
});

describe("flattenCourseLessons", () => {
  it("lists every lesson in course order with its module", () => {
    expect(
      flattenCourseLessons({
        modules: [
          {
            id: 1,
            title: "One",
            lessons: [
              { id: 10, title: "a", moduleId: 1 },
              { id: 11, title: "b", moduleId: 1 },
            ],
          },
          {
            id: 2,
            title: "Two",
            lessons: [{ id: 20, title: "c", moduleId: 2 }],
          },
        ],
      })
    ).toEqual([
      { id: 10, title: "a", moduleId: 1, moduleTitle: "One" },
      { id: 11, title: "b", moduleId: 1, moduleTitle: "One" },
      { id: 20, title: "c", moduleId: 2, moduleTitle: "Two" },
    ]);
  });
});
