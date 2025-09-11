import { describe, it, expect, vi } from "vitest";
import { parseTagFromName, compareTags, detectVersionIncrease, nextTag, formatTagToString } from "../src/index.js";

import coreMock from "./mocks/actionsCore";
import { makeGithubMock } from "./mocks/actionsGithub";

async function importWithMocks(opts?: Parameters<typeof makeGithubMock>[0]) {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock("@actions/core", () => coreMock);
    const gh = makeGithubMock(opts);
    vi.doMock("@actions/github", () => gh.github as any);

    const mod = await import("../src/index");
    return { mod, coreMock, gh };
}

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
    it("detect major via breaking change", () => {
        expect(detectVersionIncrease("BREAKING change: test test")).toBe("major");
        expect(detectVersionIncrease("breaking change: test test")).toBe("major");
    });
    it("detect major via !", () => {
        expect(detectVersionIncrease("feat!: test test")).toBe("major");
        expect(detectVersionIncrease("feat(JIRA-123)!: test test")).toBe("major");
    });
    it("detect major via breaking change in footoer", () => {
        expect(detectVersionIncrease("feat: something\nBreaking changes: on something")).toBe("major");
        expect(detectVersionIncrease("fix: test test\nBreaking changes:\nSomething else")).toBe("major");
        expect(detectVersionIncrease("fix: test test\nBreaking changes\nSomething else")).toBe("major");
    });
    it("detect minor via feat", () => {
        expect(detectVersionIncrease("feat: changes")).toBe("minor");
        expect(detectVersionIncrease("FEAT: changes")).toBe("minor");
    });
    it("detect patch via fix", () => {
        expect(detectVersionIncrease("fix: changes")).toBe("patch");
        expect(detectVersionIncrease("FIX(JIRA-123): changes")).toBe("patch");
    });
    it("defaults to null", () => {
        expect(detectVersionIncrease("something")).toBe(null);
        expect(detectVersionIncrease("docs: something")).toBe(null);
        expect(detectVersionIncrease("feat something")).toBe(null);
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

describe("upsertPrComment (using integration mocks)", () => {
  it("creates a PR conversation comment when none exists", async () => {
    const { mod, gh } = await importWithMocks({
      pr: { merged: false, number: 88 } as any,
    });

    // Get an octokit instance from the same mocked factory the action uses
    const octo: any = gh.github.getOctokit();

    // Ensure the Issues API exists (minimal wiring if your mock didn't add it yet)
    octo.rest.issues ??= {
      listComments: vi.fn(async () => ({ data: [] })),
      createComment: vi.fn(async () => ({ data: { id: 101 } })),
      updateComment: vi.fn(async () => ({ data: { id: 101 } })),
    };

    // No existing sticky comment
    (octo.rest.issues.listComments as any).mockResolvedValueOnce({ data: [] });

    await mod.upsertPrComment(
      octo,
      gh.github.context.repo.owner,
      gh.github.context.repo.repo,
      88,
      "Hello from bot",
      "release-tag-commit-bot"
    );

    expect(octo.rest.issues.listComments).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 88 })
    );
    expect(octo.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(octo.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it("updates existing sticky bot comment instead of creating a duplicate", async () => {
    const { mod, gh } = await importWithMocks({
      pr: { merged: false, number: 7 } as any,
    });

    const octo: any = gh.github.getOctokit();
    octo.rest.issues ??= {
      listComments: vi.fn(async () => ({ data: [] })),
      createComment: vi.fn(async () => ({ data: { id: 101 } })),
      updateComment: vi.fn(async () => ({ data: { id: 999 } })),
    };

    // Pretend a previous bot comment with our marker already exists
    (octo.rest.issues.listComments as any).mockResolvedValueOnce({
      data: [
        {
          id: 999,
          body: "<!-- release-tag-commit-bot:start -->old\n<!-- release-tag-commit-bot:end -->",
          user: { type: "Bot" },
        },
      ],
    });

    await mod.upsertPrComment(
      octo,
      gh.github.context.repo.owner,
      gh.github.context.repo.repo,
      7,
      "New content",
      "release-tag-commit-bot"
    );

    expect(octo.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 999 })
    );
    expect(octo.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("ignores non-bot marker comment and creates a new one", async () => {
    const { mod, gh } = await importWithMocks({
      pr: { merged: false, number: 55 } as any,
    });

    const octo: any = gh.github.getOctokit();
    octo.rest.issues ??= {
      listComments: vi.fn(async () => ({ data: [] })),
      createComment: vi.fn(async () => ({ data: { id: 101 } })),
      updateComment: vi.fn(async () => ({ data: { id: 123 } })),
    };

    // Existing comment has the marker but is from a non-bot user → should create a new comment
    (octo.rest.issues.listComments as any).mockResolvedValueOnce({
      data: [
        {
          id: 123,
          body: "<!-- release-tag-commit-bot:start -->user content\n<!-- release-tag-commit-bot:end -->",
          user: { type: "User" },
        },
      ],
    });

    await mod.upsertPrComment(
      octo,
      gh.github.context.repo.owner,
      gh.github.context.repo.repo,
      55,
      "Fresh bot content",
      "release-tag-commit-bot"
    );

    expect(octo.rest.issues.createComment).toHaveBeenCalledTimes(1);
    expect(octo.rest.issues.updateComment).not.toHaveBeenCalled();
  });
});
