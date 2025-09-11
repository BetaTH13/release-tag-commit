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
            commitMessages: ["fix: add feature"]
        });
        await mod.run();
        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.git.createRef).toHaveBeenCalledWith(
            expect.objectContaining({ ref: "refs/tags/v1.2.4" })
        );
    });

    it("creates a MAJOR tag", async () => {
        const { gh, mod } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["MAJOR!: breaking change"]
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

    it("skips versioning when no matching keywords are found", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["chore: refactor code"]
        });

        await mod.run();

        const octo = gh.github.getOctokit.mock.results[0].value;

        expect(coreMock.info).toHaveBeenCalledWith(
            "No matching keywords found for version update. Version update skipped"
        );
        expect(octo.rest.git.createRef).not.toHaveBeenCalled();
        expect(coreMock.setFailed).not.toHaveBeenCalled();
    });
    it("starts from 0.0.0 when there are no valid semver tags", async () => {
        // No tags (or all invalid) -> baseline 0.0.0
        const { gh, mod, coreMock } = await importWithMocks({
            tags: [],
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
    it("creates a tag without 'v' prefix when v_prefix is false", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            tags: [{ name: "1.2.3" }],    // existing tag w/o 'v'
            commitMessages: ["fix: bug"]  // patch -> 1.2.4
        });

        // Ensure the action reads no 'v' prefix
        coreMock.getInput.mockImplementation((name: string) => {
            if (name === "v_prefix") return "false";
            if (name === "token") return "TEST_TOKEN";
            return "";
        });

        await mod.run();

        const octo = gh.github.getOctokit.mock.results[0].value;

        // 1) The existence check should also use no-`v`
        expect(octo.rest.git.getRef).toHaveBeenCalledWith(
            expect.objectContaining({ ref: "tags/1.2.4" })
        );

        // 2) We should create exactly one tag…
        expect(octo.rest.git.createRef).toHaveBeenCalledTimes(1);

        // …with the exact payload (no 'v' in ref)
        expect(octo.rest.git.createRef).toHaveBeenCalledWith({
            owner: "octo",
            repo: "hello-world",
            ref: "refs/tags/1.2.4",
            sha: "abc123", // from default mock PR
        });

        // 3) And we never attempt a 'v' variant
        expect(octo.rest.git.createRef).not.toHaveBeenCalledWith(
            expect.objectContaining({ ref: "refs/tags/v1.2.4" })
        );
    });
    it("calls getReleaseByTag and creates a release with generated notes", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],     // latest tag
            commitMessages: ["fix: bug"],   // => bump patch -> v1.2.4
            tagExists: false,               // ensure we don't short-circuit anything
            releaseExists: false            // simulate no existing release for the tag
        });

        // Ensure inputs enable the release path for THIS test
        coreMock.getInput.mockImplementation((name: string) => {
            if (name === "v_prefix") return "true";
            if (name === "token") return "TEST_TOKEN";
            if (name === "create_release") return "true";
            if (name === "mark_release_as_latest") return "true";
            if (name === "generate_release_notes") return "true";
            return "";
        });

        await mod.run();

        const octo = gh.github.getOctokit.mock.results[0].value;

        // 1) It checked for an existing release
        expect(octo.rest.repos.getReleaseByTag).toHaveBeenCalled();

        const calls = octo.rest.repos.getReleaseByTag.mock.calls;
        const firstArg = calls[0][0];
        expect(firstArg).toMatchObject({
            owner: "octo",
            repo: "hello-world",
            tag: "v1.2.4",
        });

        // 2) It created a release with generated notes
        expect(octo.rest.repos.createRelease).toHaveBeenCalledWith(
            expect.objectContaining({
                owner: "octo",
                repo: "hello-world",
                tag_name: "v1.2.4",
                target_commitish: "abc123",
                name: "v1.2.4",
                generate_release_notes: true,
                make_latest: "true",
                draft: false,
                prerelease: false,
            })
        );
    });

    it("does not create a Release when create_release is false", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["fix: bug"]
        });

        // Override just this input
        coreMock.getInput.mockImplementation((name: string) => {
            if (name === "v_prefix") return "true";
            if (name === "token") return "TEST_TOKEN";
            if (name === "create_release") return "false"; // <-- important
            if (name === "mark_release_as_latest") return "true";
            if (name === "generate_release_notes") return "true";
            return "";
        });

        await mod.run();

        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.repos.createRelease).not.toHaveBeenCalled();
    });

    it("marks the Release as not latest when mark_release_as_latest is false", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["fix: bug"],
            releaseExists: false
        });

        coreMock.getInput.mockImplementation((name: string) => {
            if (name === "v_prefix") return "true";
            if (name === "token") return "TEST_TOKEN";
            if (name === "create_release") return "true";
            if (name === "mark_release_as_latest") return "false"; // <-- important
            if (name === "generate_release_notes") return "true";
            return "";
        });

        await mod.run();

        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.repos.createRelease).toHaveBeenCalledWith(
            expect.objectContaining({
                make_latest: "false",
                generate_release_notes: true
            })
        );
    });

    it("skips creating a Release if one already exists for the tag", async () => {
        const { gh, mod } = await importWithMocks({
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["fix: bug"],
            releaseExists: true // <-- simulate existing release
        });

        await mod.run();

        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.repos.getReleaseByTag).toHaveBeenCalled();
        expect(octo.rest.repos.createRelease).not.toHaveBeenCalled();
    });
    it("posts a preview comment on open PRs and does not create a tag", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            pr: { merged: false, number: 42 } as any, // open PR, not merged
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["fix: something"] // => patch bump preview
        });

        // enable commenting
        coreMock.getInput.mockImplementation((name: string) => {
            if (name === "v_prefix") return "true";
            if (name === "token") return "TEST_TOKEN";
            if (name === "comment_pr") return "true";
            // leave release inputs default (true in your default mock, but irrelevant here)
            return "";
        });

        await mod.run();

        const octo = gh.github.getOctokit.mock.results[0].value;

        // Should have tried to comment on the PR conversation
        expect(octo.rest.issues.listComments).toHaveBeenCalledWith(
            expect.objectContaining({ issue_number: 42 })
        );
        expect(octo.rest.issues.createComment).toHaveBeenCalledTimes(1);
        // No tag should be created in preview mode
        expect(octo.rest.git.createRef).not.toHaveBeenCalled();
        expect(coreMock.setFailed).not.toHaveBeenCalled();
    });

    it("updates existing sticky bot comment instead of creating a duplicate", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            pr: { merged: false, number: 7 } as any,
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["fix: quick patch"]
        });

        // Arrange BEFORE run(): return an existing bot comment with our marker
        gh.spies.rest.issues = gh.spies.rest.issues || {
            listComments: vi.fn(async () => ({ data: [] })),
            createComment: vi.fn(async () => ({ data: { id: 101 } })),
            updateComment: vi.fn(async () => ({ data: { id: 999 } })),
        };
        gh.spies.rest.issues.listComments.mockResolvedValueOnce({
            data: [
                {
                    id: 999,
                    body: "<!-- release-tag-commit-bot:start -->old\n<!-- release-tag-commit-bot:end -->",
                    user: { type: "Bot" },
                },
            ],
        });

        // If your `makeGithubMock` doesn’t wire `issues` into `rest`, do it now:
        if (!('issues' in gh.spies.rest)) {
            // @ts-ignore - test-only wiring
            gh.spies.rest.issues = gh.spies.rest.issues;
        }

        coreMock.getInput.mockImplementation((name: string) => {
            if (name === "v_prefix") return "true";
            if (name === "token") return "TEST_TOKEN";
            if (name === "comment_pr") return "true";
            return "";
        });

        await mod.run();

        // Now get the instance that run() created
        const octo = gh.github.getOctokit.mock.results[0].value;

        expect(octo.rest.issues.updateComment).toHaveBeenCalledWith(
            expect.objectContaining({ comment_id: 999 })
        );
        expect(octo.rest.issues.createComment).not.toHaveBeenCalled();
        expect(octo.rest.git.createRef).not.toHaveBeenCalled(); // preview → no tag
        expect(coreMock.setFailed).not.toHaveBeenCalled();
    });

    it("posts a 'No bump detected' comment when no matching keywords exist", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            pr: { merged: false, number: 11 } as any,
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["chore: refactor"] // no bump
        });

        coreMock.getInput.mockImplementation((name: string) => {
            if (name === "v_prefix") return "true";
            if (name === "token") return "TEST_TOKEN";
            if (name === "comment_pr") return "true";
            return "";
        });

        await mod.run();

        const octo = gh.github.getOctokit.mock.results[0].value;

        expect(coreMock.info).toHaveBeenCalledWith(
            "No matching keywords found for version update. Version update skipped"
        );
        expect(octo.rest.issues.createComment).toHaveBeenCalledTimes(1);
        expect(octo.rest.git.createRef).not.toHaveBeenCalled();
        expect(coreMock.setFailed).not.toHaveBeenCalled();
    });

    it("updates the confirmation comment after a merged PR", async () => {
        const { gh, mod, coreMock } = await importWithMocks({
            pr: { merged: true, number: 7, merge_commit_sha: "abc123" } as any,
            tags: [{ name: "v1.2.3" }],
            commitMessages: ["fix: quick patch"], // => patch -> v1.2.4
            tagExists: false,                      // ensure a tag is created
            releaseExists: false                   // we’ll disable release creation via inputs below
        });

        if (!gh.spies.rest.issues) {
            gh.spies.rest.issues = {
                listComments: vi.fn(async () => ({ data: [] })),
                createComment: vi.fn(async () => ({ data: { id: 101 } })),
                updateComment: vi.fn(async () => ({ data: { id: 999 } })),
            };
        }

        gh.spies.rest.issues.listComments.mockResolvedValueOnce({
            data: [
                {
                    id: 999,
                    body: "<!-- release-tag-commit-bot:start -->old\n<!-- release-tag-commit-bot:end -->",
                    user: { type: "Bot" },
                },
            ],
        });

        // Inputs: enable commenting; keep release off to focus the test
        coreMock.getInput.mockImplementation((name: string) => {
            if (name === "v_prefix") return "true";
            if (name === "token") return "TEST_TOKEN";
            if (name === "comment_pr") return "true";
            if (name === "create_release") return "false";
            if (name === "mark_release_as_latest") return "false";
            if (name === "generate_release_notes") return "false";
            return "";
        });

        await mod.run();

        const octo = gh.github.getOctokit.mock.results[0].value;
        expect(octo.rest.issues.updateComment).toHaveBeenCalledWith(
            expect.objectContaining({ comment_id: 999 })
        );
        expect(octo.rest.issues.createComment).not.toHaveBeenCalled();
        const updatedBody = octo.rest.issues.updateComment.mock.calls[0][0].body as string;
        expect(updatedBody).toContain("**Next tag:** `v1.2.4`");
        expect(updatedBody).toContain("Status: PR is merged; tag will be created (or already created) on the merge commit.");
        expect(octo.rest.git.getRef).toHaveBeenCalledWith(
            expect.objectContaining({ ref: "tags/v1.2.4" })
        );
        expect(octo.rest.git.createRef).toHaveBeenCalledWith(
            expect.objectContaining({ ref: "refs/tags/v1.2.4", sha: "abc123" })
        );
        expect(octo.rest.repos.createRelease).not.toHaveBeenCalled();
        expect(coreMock.setFailed).not.toHaveBeenCalled();
    });
});
