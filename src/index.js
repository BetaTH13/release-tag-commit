import * as core from "@actions/core";
import * as github from "@actions/github";

// based on the retrieved tags
export function parseTagFromName(tagName) {
    const regex = new RegExp(/^(?:v)?(\d+)\.(\d+)\.(\d+)$/);
    const m = regex.exec((tagName || "").trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Helper function to compare Tags. 
export function compareTags(tag, tagOther) {
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
export function detectVersionIncrease(text) {
    const commitLowerCase = text.toLowerCase();
    const majorExp = new RegExp(/\bmajor\b/i);
    const minorExp = new RegExp(/\bminor\b/i);
    const patchExp = new RegExp(/\bpatch\b/i);
    const fixExp = new RegExp(/fix\b/i);
    if (majorExp.test(commitLowerCase)) {
        return "major";
    }
    if (minorExp.test(commitLowerCase)) {
        return "minor";
    }
    if (patchExp.test(commitLowerCase) || fixExp.test(commitLowerCase)) {
        return "patch";
    }
    return "patch";
}

export function nextTag(major, minor, patch, versionToIncrease) {
    if (versionToIncrease == "major") {
        return [major + 1, 0, 0];
    }
    if (versionToIncrease == "minor") {
        return [major, minor + 1, 0];
    }
    return [major, minor, patch + 1];
}

export function formatTagToString(major, minor, patch, vPrefix) {
    return `${vPrefix ? "v" : ""}${major}.${minor}.${patch}`; 
}

export async function run() {
    try {
        // inputs and environment

        const vPrefix = String(core.getInput("v_prefix") || "true").toLowerCase() === "true";
        const token = core.getInput("token");
        const { owner, repo } = github.context.repo;
        console.log("Test here", owner, repo);
        const isPrEvent = github.context.eventName === "pull_request" && !!github.context.payload.pull_request;
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

        const sortedTags = allTags
            .slice()
            .sort((a, b) => compareTags(parseTagFromName(b), parseTagFromName(a)));

        const latest = sortedTags[0];
        const newTag = nextTag(latest[0], latest[1], latest[2], versionToIncrease);
        const tagAsString = formatTagToString(newTag, vPrefix);
        core.info(`Latest tag: ${formatTagToString(latest)}, Next tag: ${tagAsString}`);

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
        console.log("Test here");
        core.info(`New tag created ${tagAsString}`);

    } catch (error) {
        core.setFailed(error?.message);
    }
}

/* global process */
if (process.env.NODE_ENV !== "test") {
    run();
}
