import * as core from "@actions/core";
import * as github from "@actions/github";

// based on the retrieved tags
export function parseTagFromName(tagName: string): number[] | null {
    const regex = new RegExp(/^(?:v)?(\d+)\.(\d+)\.(\d+)$/);
    const m = regex.exec((tagName || "").trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Helper function to compare Tags. 
export function compareTags(tag: number[], tagOther: number[]) {
    for (let i = 0; i < 3; i++) {
        const ver = tag[i];
        const other = tagOther[i];
        if (ver > other) {
            return 1;
        }
        if (ver < other) {
            return -1;
        }
    }
    return 0;
}

// Determines what needs to increase
export function detectVersionIncrease(text: string) {
    const commitLowerCase = text.toLowerCase();
    const header = commitLowerCase.split(/\r?\n/, 1)[0];

    const breackingChangeInHead = new RegExp(/^[a-z]+(?:\([^)]+\))?!:\s/i);
    const featExp = new RegExp(/^feat(?:\([^)]+\))?:\s/i);
    const fixExp = new RegExp(/^fix(?:\([^)]+\))?:\s/i);
    const breakingChangeInText = new RegExp(/^\s*breaking changes?:?/mi);

    if (breackingChangeInHead.test(header) || breakingChangeInText.test(commitLowerCase)) {
        return "major";
    }
    if (featExp.test(header)) {
        return "minor";
    }
    if (fixExp.test(header)) {
        return "patch";
    }
    return null;
}

export function nextTag(major: number, minor: number, patch: number, versionToIncrease: string) {
    if (versionToIncrease == "major") {
        return [major + 1, 0, 0];
    }
    if (versionToIncrease == "minor") {
        return [major, minor + 1, 0];
    }
    return [major, minor, patch + 1];
}

export function formatTagToString(major: number, minor: number, patch: number, vPrefix: boolean) {
    return `${vPrefix ? "v" : ""}${major}.${minor}.${patch}`;
}

export async function upsertPrComment(octokit: any, owner: string, repo: string, prNumber: number, body: string, marker = "release-tag-commit-bot") {
    const markerStart = `<!-- ${marker}:start -->`;
    const markerEnd = `<!-- ${marker}:end -->`;
    const wrapped = `${markerStart}\n${body}\n${markerEnd}`;

    const { data: comments } = await octokit.rest.issues.listComments({ owner, repo, issue_number: prNumber, per_page: 100 });
    const existing = comments.find((c: any) => typeof c.body === 'string' && c.body.includes(markerStart) && c.user?.type === 'Bot');

    if (existing) {
        await octokit.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: wrapped });
    } else {
        await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: wrapped });
    }
}

export async function run() {
    try {
        // convert inputs
        const vPrefix: boolean = String(core.getInput("v_prefix") || "").toLowerCase() === "true";
        const token: string = core.getInput("token");
        const createRelease: boolean = String(core.getInput("create_release") || "").toLowerCase() === "true";
        const markLatest: boolean = String(core.getInput("mark_release_as_latest") || "").toLowerCase() === "true";
        const generateNotes: boolean = String(core.getInput("generate_release_notes") || "").toLowerCase() === "true";
        const commentPr: boolean = String(core.getInput("comment_pr") || "").toLowerCase() === "true";

        //retrieve context data
        const { owner, repo } = github.context.repo;
        const pr = github.context.payload.pull_request;
        const octokit = github.getOctokit(token);

        // must be a PR context
        if (!pr) {
            core.setFailed("Not a PR context.");
            return;
        }

        //check if merged PR
        const isMerged = !!pr.merged;

        // collect PR commits (works for preview + merged)
        const allCommitsFromPr = await octokit.paginate(
            octokit.rest.pulls.listCommits,
            { owner, repo, pull_number: pr.number, per_page: 100 }
        );
        const commitMessages: string[] = allCommitsFromPr.map(c => c?.commit?.message || "");

        // if merged, also include merge commit message in detection/logs
        let mergeCommitSha: string | undefined = pr.merge_commit_sha as string | undefined;
        if (isMerged) {
            if (!mergeCommitSha) {
                core.setFailed("PR has no merge_commit_sha. Cannot create a tag.");
                return;
            }
            try {
                const mergeCommit = await octokit.rest.repos.getCommit({ owner, repo, ref: mergeCommitSha });
                commitMessages.unshift(mergeCommit.data.commit.message || "");
            } catch {
                core.info("Could not read merge commit message; continuing.");
            }
        }

        // determine version increase (from all commit messages)
        let versionToIncrease = detectVersionIncrease(commitMessages.join(","));
        if (!versionToIncrease) {
            core.info("No matching keywords found for version update. Version update skipped");
            if (commentPr) {
                const body = `📝 No bump detected.\n\n- I looked for \`feat\`, \`fix\`, or \`BREAKING CHANGE\` in the PR commits.\n- No new tag will be created on merge.`;
                await upsertPrComment(octokit, owner, repo, pr.number, body);
            }
            return;
        }

        // latest tag → next tag
        const allTags = await octokit.paginate(
            octokit.rest.repos.listTags,
            { owner, repo, per_page: 100 }
        );
        const parsed = allTags
            .map(t => {
                const p = parseTagFromName(t?.name);
                return p ? { name: t.name, parsed: p as [number, number, number] } : null;
            })
            .filter((x): x is { name: string; parsed: [number, number, number] } => !!x);

        // determine latest tag
        let latestName: string;
        let latestParsed: number[];
        if (parsed.length === 0) {
            latestParsed = [0, 0, 0];
            latestName = formatTagToString(0, 0, 0, vPrefix);
            core.info("No valid tags found. Starting from 0.0.0 baseline.");
        } else {
            parsed.sort((a, b) => compareTags(b.parsed, a.parsed));
            latestName = parsed[0].name;
            latestParsed = parsed[0].parsed;
        }

        // determine next tag and format
        const [major, minor, patch] = latestParsed;
        const newTag = nextTag(major, minor, patch, versionToIncrease);
        const tagAsString = formatTagToString(newTag[0], newTag[1], newTag[2], vPrefix);
        core.info(`Latest tag: ${latestName}, Next tag: ${tagAsString}`);

        // comment (preview or confirmation)
        if (commentPr) {
            const body = `🔖 **Next tag:** \`${tagAsString}\`\n\n` +
                `- Reason: **${versionToIncrease}** bump inferred from commit messages.\n` +
                `- Prefix \`v\`: **${vPrefix ? "on" : "off"}**\n` +
                (isMerged
                    ? `- Status: PR is merged; tag will be created (or already created) on the merge commit.`
                    : `- Status: Preview only; tag will be created if this PR is merged.`);
            await upsertPrComment(octokit, owner, repo, pr.number, body);
        }

        // exits here if it's a preview (PR not merged)
        if (!isMerged) {
            core.info("Preview only; not creating tags or releases.");
            return;
        }

        // check if tag already exists. (fail safe)
        let tagExists = false;
        try {
            await octokit.rest.git.getRef({ owner, repo, ref: `tags/${tagAsString}` });
            tagExists = true;
            core.info(`Tag ${tagAsString} already exists. Nothing to do.`);
        } catch {
            core.info(`Tag ${tagAsString} does not exist; can continue processing.`);
        }
        
        if (!tagExists) {
            await octokit.rest.git.createRef({
                owner,
                repo,
                ref: `refs/tags/${tagAsString}`,
                sha: mergeCommitSha!,
            });
            core.info(`New tag created ${tagAsString}`);
        }

        // create release if requested also checks if it doesn't exist yet fail safe
        if (createRelease) {
            try {
                const existing = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag: tagAsString }).then(
                    r => r.data,
                    () => null
                );
                if (existing) {
                    core.info(`Release for tag ${tagAsString} already exists: ${existing.html_url}`);
                } else {
                    const release = await octokit.rest.repos.createRelease({
                        owner,
                        repo,
                        tag_name: tagAsString,
                        target_commitish: mergeCommitSha!,
                        name: tagAsString,
                        generate_release_notes: generateNotes,
                        draft: false,
                        prerelease: false,
                        make_latest: markLatest ? "true" : "false",
                    });
                    core.info(`Release created: ${release.data.html_url}`);
                }
            } catch (err: any) {
                core.warning(`Failed to create release for ${tagAsString}: ${err?.message ?? String(err)}`);
            }
        }
    } catch (error: any) {
        core.setFailed(error?.message ?? String(error));
    }
}

// only run if not in test environment for testing
if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
    void run();
}