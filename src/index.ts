import * as core from "@actions/core";
import * as github from "@actions/github";

/* global console */

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

// Determines if what needs to increase
export function detectVersionIncrease(text: string) {
    const commitLowerCase = text.toLowerCase();
    const majorExp = new RegExp(/\bmajor\b/i);
    const minorExp = new RegExp(/\bminor\b/i);
    const patchExp = new RegExp(/\bpatch\b/i);

    const fixExp = new RegExp(/fix/i);
    const featExp = new RegExp(/feat/i);

    const breakingChange = new RegExp(/breaking change/i);
    const exclamationMark = new RegExp(/!/i);
    if (majorExp.test(commitLowerCase) || breakingChange.test(commitLowerCase) || exclamationMark.test(commitLowerCase)) {
        return "major";
    }
    if (minorExp.test(commitLowerCase) || featExp.test(commitLowerCase)) {
        return "minor";
    }
    if (patchExp.test(commitLowerCase) || fixExp.test(commitLowerCase)) {
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

export async function run() {
    try {
        // inputs and environment
        const vPrefix: boolean = String(core.getInput("v_prefix") || "true").toLowerCase() === "true";
        const token: string = core.getInput("token");
        const { owner, repo } = github.context.repo;
        const isPrEvent: boolean = github.context.eventName === "pull_request" && !!github.context.payload.pull_request;
        if (!isPrEvent) {
            core.setFailed("Not a PR event");
        }

        const pr = github.context.payload.pull_request;
        const octokit = github.getOctokit(token);
        
        if (!pr?.merged) {
            core.setFailed("Not a merged PR.");
        }

        const mergeCommitSha = pr?.merge_commit_sha;
        const commitMessages = [];
        if (mergeCommitSha) {
            const mergeCommit = await octokit.rest.repos.getCommit({ owner, repo, ref: mergeCommitSha });
            commitMessages.push(mergeCommit.data.commit.message);
        } else {
            core.setFailed("PR has no merge_commit_sha. Cannot create a tag.");
            return;
        }

        const allCommitsFromPr = await octokit.paginate(
            octokit.rest.pulls.listCommits,
            { owner, repo, pull_number: pr.number, per_page: 100 }
        );
        commitMessages.push(...allCommitsFromPr.map(commit => commit?.commit?.message || ""));

        let versionToIncrease = detectVersionIncrease(commitMessages.join(","));
        if (!versionToIncrease) {
            const prContent = `${pr.title}\n${pr.body ?? ""}`;
            versionToIncrease = detectVersionIncrease(prContent);
        }
        
        versionToIncrease = versionToIncrease || "patch";
        core.info(
            `Version to increase: ${versionToIncrease}`
        );

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

        if (parsed.length === 0) {
            core.setFailed("No valid semver tags found in the repository.");
            return;
        }

        parsed.sort((a, b) => compareTags(b.parsed, a.parsed));
        const latest = parsed[0];
        const [major, minor, patch] = latest.parsed;
        const newTag = nextTag(major, minor, patch, versionToIncrease);
        const tagAsString = formatTagToString(newTag[0], newTag[1], newTag[2], vPrefix);
        core.info(`Latest tag: ${latest.name}, Next tag: ${tagAsString}`);

        try {
            await octokit.rest.git.getRef({ owner, repo, ref: `tags/${tagAsString}` });
            core.info(`Tag ${tagAsString} already exists. Nothing to do.`);
            return;
        } catch {
            core.info(`Tag ${tagAsString} does not exist can continue processing.`);
        }

        await octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/tags/${tagAsString}`,
            sha: mergeCommitSha,
        });
        core.info(`New tag created ${tagAsString}`);

    } catch (error: any) {
        core.setFailed(error?.message ?? String(error));
    }
}

run();