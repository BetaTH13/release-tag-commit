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
    it("fails when not a PR event", async () => {
        const { mod, coreMock } = await importWithMocks({ eventName: "push", pr: undefined });
        await mod.run();
        expect(coreMock.setFailed).toHaveBeenCalledWith("Not a PR event");
    });

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
    it("fails when the repository has NO tags (parsed.length === 0)", async () => {
        const { mod, coreMock, gh } = await importWithMocks({
            tags: [],                       // ← no tags from API
            commitMessages: ["fix: bug"]    // any message; we never reach tagging
        });
        
        await mod.run();

        expect(coreMock.setFailed).toHaveBeenCalledWith(
            "No valid semver tags found in the repository."
        );

        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.git.getRef).not.toHaveBeenCalled();
        expect(octo.rest.git.createRef).not.toHaveBeenCalled();
    });

    it("fails when ALL tags are invalid (no valid semver)", async () => {
        const { mod, coreMock, gh } = await importWithMocks({
            tags: [
                { name: "release-1.2.3" },
                { name: "v1.2" },
                { name: "v1.2.3-beta.1" },
                { name: "foo" }
            ],
            commitMessages: ["minor: feature"]
        });

        await mod.run();

        expect(coreMock.setFailed).toHaveBeenCalledWith(
            "No valid semver tags found in the repository."
        );

        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.git.getRef).not.toHaveBeenCalled();
        expect(octo.rest.git.createRef).not.toHaveBeenCalled();
    });
});
