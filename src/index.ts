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
    const featExp =  new RegExp(/^feat(?:\([^)]+\))?:\s/i); 
    const fixExp =new RegExp(/^fix(?:\([^)]+\))?:\s/i);
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

export async function run() {
    try {
        // inputs and environment
        const vPrefix: boolean = String(core.getInput("v_prefix") || "").toLowerCase() === "true";
        const token: string = core.getInput("token");
        const { owner, repo } = github.context.repo;

        const pr = github.context.payload.pull_request;
        const octokit = github.getOctokit(token);

        if (!pr?.merged) {
            core.setFailed("Not a merged PR.");
            return;
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
        if (!versionToIncrease ) {
            core.info("No matching keywords found for version update. Version update skipped");
            return;
        }

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

        let latestName: string;
        let latestParsed: number[];
        
        if (parsed.length === 0) {
            latestParsed = [0, 0, 0];
            latestName = formatTagToString(0, 0, 0, vPrefix); 
            core.info("No valid semver tags found. Starting from 0.0.0 baseline.");
        } else {
            parsed.sort((a, b) => compareTags(b.parsed, a.parsed));
            latestName = parsed[0].name;
            latestParsed = parsed[0].parsed;
        }

        const [major, minor, patch] = latestParsed;
        const newTag = nextTag(major, minor, patch, versionToIncrease);
        const tagAsString = formatTagToString(newTag[0], newTag[1], newTag[2], vPrefix);
        core.info(`Latest tag: ${latestName}, Next tag: ${tagAsString}`);

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

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  void run();
}