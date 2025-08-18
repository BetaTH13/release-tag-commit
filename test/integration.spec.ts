import { beforeEach, describe, expect, it, vi } from "vitest";
process.env.NODE_ENV = "test";

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

describe("integration test", () => {
    it("fails when PR not merged", async () => {
        const { mod, coreMock } = await importWithMocks({ pr: { merged: false, number: 1 } as any });
        await mod.run();
        expect(coreMock.setFailed).toHaveBeenCalledWith("Not a merged PR.");
    });

    it("fails when no merge_commit_sha", async () => {
        const { mod, coreMock } = await importWithMocks({
            pr: { merged: true, number: 1, merge_commit_sha: undefined } as any
        });
        await mod.run();
        expect(coreMock.setFailed).toHaveBeenCalledWith("PR has no merge_commit_sha. Cannot create a tag.");
    });

    it("creates a PATCH tag when commit messages include fix", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["fix: bug"]
        });
        await mod.run();
        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.git.createRef).toHaveBeenCalledWith(
            expect.objectContaining({ ref: "refs/tags/v1.2.4" })
        );
        expect(coreMock.setFailed).not.toHaveBeenCalled();
    });

    it("creates a MINOR tag", async () => {
        const { gh, mod } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["minor: add feature"]
        });
        await mod.run();
        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.git.createRef).toHaveBeenCalledWith(
            expect.objectContaining({ ref: "refs/tags/v1.3.0" })
        );
    });

    it("creates a MAJOR tag", async () => {
        const { gh, mod } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["MAJOR: breaking change"]
        });
        await mod.run();
        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.git.createRef).toHaveBeenCalledWith(
            expect.objectContaining({ ref: "refs/tags/v2.0.0" })
        );
    });

    it("does nothing if the next tag already exists", async () => {
        const { gh, mod } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["fix: bug"],
            tagExists: true
        });
        await mod.run();
        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.git.getRef).toHaveBeenCalled();
        expect(octo.rest.git.createRef).not.toHaveBeenCalled();
    });

    it("uses PR title/body when commits don't indicate level", async () => {
        const { gh, mod } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["chore: refactor"],
            pr: {
                merged: true,
                number: 77,
                merge_commit_sha: "abc999",
                title: "release: minor bump",
                body: "minor"
            }
        });
        await mod.run();
        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.git.createRef).toHaveBeenCalledWith(
            expect.objectContaining({ ref: "refs/tags/v1.3.0" })
        );
    });
    it("starts from 0.0.0 when there are no valid semver tags", async () => {
        // No tags (or all invalid) -> baseline 0.0.0
        const { gh, mod, coreMock } = await importWithMocks({
            tags: [], // try also: [{ name: "release" }, { name: "v1.2" }, { name: "foo" }]
            commitMessages: ["fix: first patch"] // => bump patch from 0.0.0 -> 0.0.1
        });

        await mod.run();

        // Logs should mention the baseline and show latest/next
        expect(coreMock.info).toHaveBeenCalledWith(
            expect.stringContaining("Starting from 0.0.0 baseline")
        );
        expect(coreMock.info).toHaveBeenCalledWith(
            expect.stringContaining("Latest tag: v0.0.0, Next tag: v0.0.1")
        );

        // And a tag should be created for v0.0.1
        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.git.createRef).toHaveBeenCalledWith(
            expect.objectContaining({ ref: "refs/tags/v0.0.1" })
        );
    });
});
