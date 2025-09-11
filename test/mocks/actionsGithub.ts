import { vi } from "vitest";

type MergeablePR = {
  merged: boolean;
  number: number;
  merge_commit_sha?: string;
  title?: string;
  body?: string | null;
};

type IssueComment = { id: number; body: string; user?: { type?: string } };

export function makeGithubMock(opts?: {
  eventName?: string;
  pr?: MergeablePR | null;
  tags?: Array<{ name: string }>;
  tagExists?: boolean;
  commitMessages?: string[];
  releaseExists?: boolean;
}) {
  const {
    eventName = "pull_request",
    pr = { merged: true, number: 123, merge_commit_sha: "abc123", title: "feat", body: "" },
    tags = [{ name: "v1.2.3" }, { name: "v1.2.2" }],
    tagExists = false,
    commitMessages = ["fix: sample"],
    releaseExists = false 
  } = opts || {};

  const context = {
    eventName,
    repo: { owner: "octo", repo: "hello-world" },
    payload: { pull_request: pr }
  };

  const rest = {
    repos: {
      getCommit: vi.fn(async () => ({
        data: { commit: { message: commitMessages[0] ?? "" } }
      })),
      listTags: vi.fn(),
      getReleaseByTag: releaseExists
        ? vi.fn(async () => ({
            data: { id: 1, html_url: "https://example.com/release", tag_name: "v1.2.4" }
          }))
        : vi.fn(async () => {
            const err: any = new Error("Not Found");
            err.status = 404;
            throw err;
          }),
      createRelease: vi.fn(async () => ({
        data: { id: 2, html_url: "https://example.com/new-release" }
      }))
    },
    pulls: {
      listCommits: vi.fn(async () => ({
        data: (commitMessages.length ? commitMessages : ["fix: x"]).map(m => ({
          commit: { message: m }
        }))
      }))
    },
    git: {
      getRef: tagExists
        ? vi.fn(async () => ({ data: { ref: "refs/tags/existing" } }))
        : vi.fn(async () => {
            const err: any = new Error("Not Found");
            err.status = 404;
            throw err;
          }),
      createRef: vi.fn(async () => ({ data: { ref: "refs/tags/new" } }))
    },
    issues: {
      listComments: vi.fn(async () => ({ data: [] as IssueComment[] })), // default: no existing comments
      createComment: vi.fn(async () => ({ data: { id: 101 } })),
      updateComment: vi.fn(async () => ({ data: { id: 101 } })),
    },
  };

  const paginate = vi.fn(async (fn: any) => {
    if (fn === rest.pulls.listCommits) {
      return (commitMessages.length ? commitMessages : ["fix: x"]).map(m => ({
        commit: { message: m }
      }));
    }
    return tags;
  });

  const getOctokit = vi.fn(() => ({ rest, paginate }));

  return {
    github: { context, getOctokit },
    spies: { rest, paginate, getOctokit }
  };
}