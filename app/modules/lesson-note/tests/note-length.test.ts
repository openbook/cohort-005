import { describe, it, expect } from "vitest";
import { noteLength } from "../index";

describe("noteLength", () => {
  it("reports an empty draft as empty", () => {
    expect(noteLength("")).toEqual({
      count: 0,
      empty: true,
      tooLong: false,
      label: "0 / 2,000",
    });
  });

  it("treats a whitespace-only draft as empty, as the server does", () => {
    const length = noteLength("   \n\t ");
    expect(length.count).toBe(0);
    expect(length.empty).toBe(true);
  });

  it("does not count leading and trailing whitespace", () => {
    const length = noteLength("  hello  ");
    expect(length.count).toBe(5);
    expect(length.empty).toBe(false);
    expect(length.label).toBe("5 / 2,000");
  });

  it("allows a note of exactly the limit", () => {
    const length = noteLength("a".repeat(2000));
    expect(length.tooLong).toBe(false);
    expect(length.count).toBe(2000);
    expect(length.label).toBe("2,000 / 2,000");
  });

  it("flags a note one character over the limit", () => {
    const length = noteLength("a".repeat(2001));
    expect(length.tooLong).toBe(true);
    expect(length.count).toBe(2001);
    expect(length.label).toBe("2,001 / 2,000");
  });
});
