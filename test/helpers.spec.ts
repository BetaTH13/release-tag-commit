import { describe, it, expect } from "vitest";
import { parseTagFromName, compareTags, detectVersionIncrease, nextTag, formatTagToString } from "../src/index.js";

describe("parseTagFromName", () => {
    it("parses v-prefixed and plain", () => {
        expect(parseTagFromName("v1.2.3")).toEqual([1, 2, 3]);
        expect(parseTagFromName("1.2.3")).toEqual([1, 2, 3]);
    });
    it("reject invalid", () => {
        expect(parseTagFromName("something")).toBeNull();
        expect(parseTagFromName("v1.2")).toBeNull();
        expect(parseTagFromName("1.2")).toBeNull();
        expect(parseTagFromName("v1.2.3-beta")).toBeNull();
    });
});

describe("compareTags", () => {
    it("orders correctly", () => {
        expect(compareTags([1, 2, 3], [1, 2, 4])).toBe(-1);
        expect(compareTags([2, 0, 0], [1, 0, 0])).toBe(1);
        expect(compareTags([1, 0, 0], [1, 0, 0])).toBe(0);
    });
});

describe("detectVersionIncrease", () => {
    it("detect major", () => {
        expect(detectVersionIncrease("major changes")).toBe("major");
        expect(detectVersionIncrease("MAJOR changes")).toBe("major");
        expect(detectVersionIncrease("something BREAKING CHANGE")).toBe("major");
        expect(detectVersionIncrease("something BREAKING change")).toBe("major");
        expect(detectVersionIncrease("BREAKING change: test test")).toBe("major");
        expect(detectVersionIncrease("feat!: test test")).toBe("major");
    });
    it("detect minor", () => {
        expect(detectVersionIncrease("minor changes")).toBe("minor");
        expect(detectVersionIncrease("MINOR changes")).toBe("minor");
        expect(detectVersionIncrease("feat: changes")).toBe("minor");
        expect(detectVersionIncrease("FEAT: changes")).toBe("minor");
    });
    it("detect patch", () => {
        expect(detectVersionIncrease("patch some changes")).toBe("patch");
        expect(detectVersionIncrease("PATCH changes")).toBe("patch");
        expect(detectVersionIncrease("fix: changes")).toBe("patch");
        expect(detectVersionIncrease("FIX: changes")).toBe("patch");
    });
    it("default to patch", () => {
        expect(detectVersionIncrease("something")).toBe(null);
    });
});

describe("nextTag", () => {
    it("upgrade major", () => {
        expect(nextTag(1, 2, 3, "major")).toEqual([2, 0, 0]);
        expect(nextTag(0, 0, 0, "major")).toEqual([1, 0, 0]);
    });
    it("upgrade minor", () => {
        expect(nextTag(1, 2, 3, "minor")).toEqual([1, 3, 0]);
        expect(nextTag(0, 0, 0, "minor")).toEqual([0, 1, 0]);
    });
    it("upgrade patch", () => {
        expect(nextTag(1, 2, 3, "patch")).toEqual([1, 2, 4]);
        expect(nextTag(0, 0, 0, "patch")).toEqual([0, 0, 1]);
    });
});


describe("formatTagToString", () => {
    it("detect major", () => {
        expect(formatTagToString(1, 2, 3, true)).toBe("v1.2.3");
        expect(formatTagToString(1, 2, 3, false)).toBe("1.2.3");
    });
});
