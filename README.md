# 🚀 release-tag-commit

GitHub Action to automatically create tags and (optionally) releases when pull requests are merged.

This action analyzes commit messages inside a merged PR to determine the correct semantic version bump:

- `fix:` → patch version bump
- `feat:` → minor version bump
- `!:`, or commits containing `BREAKING CHANGE` → major version bump

It will then:
- Create the next tag in sequence.
- Optionally create a GitHub Release.
- Optionally auto-generate release notes.
- Optionally mark the release as **latest**.

---


## ⚙️ Inputs

| Name                     | Required | Default   | Description                                                                 |
|--------------------------|----------|-----------|-----------------------------------------------------------------------------|
| `token`                  | ✅       | –         | GitHub token (use `${{ secrets.GITHUB_TOKEN }}`).                           |
| `v_prefix`               | ❌       | `"false"` | Prefix tags with `v` (e.g. `v1.2.3`).                                      |
| `create_release`         | ❌       | `"false"` | If `"true"`, create a GitHub Release after tagging.                         |
| `mark_release_as_latest` | ❌       | `"true"`  | If `"true"`, mark the created release as latest.                            |
| `generate_release_notes` | ❌       | `"true"`  | If `"true"`, let GitHub auto-generate release notes.                        |

⚠️ **Note:** All inputs must be strings (`"true"` / `"false"`) because GitHub Actions passes inputs as strings.

---

## 🧩 Commit Message Rules

The following rules are used to decide the next semantic version bump:

- **Patch bump** → if at least one commit message starts with `fix:`
- **Minor bump** → if at least one commit message starts with `feat:`
- **Major bump** → if at least one commit message includes `!:` in the header or contains `BREAKING CHANGE`
- If no matching keywords are found, no new tag is created.

---