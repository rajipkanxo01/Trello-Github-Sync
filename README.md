# GitHub Project → Trello Sync

Keep a Trello board updated from a GitHub Project without Zapier, a hosted server
or another automation service.

The integration creates one Trello card for each GitHub Issue in the configured
Project. Later runs update the card's title, description, labels, assignees and
destination list.

| GitHub Project status | Trello list |
| --- | --- |
| `Backlog`, `Ready`, `Todo`, `To do` | Todo |
| `In progress`, `In review`, `Review` | In Progress |
| `Done`, `Complete`, `Completed` | Done |

Pull requests and draft Project items are ignored. Synchronized cards are identified
by a `[#issue-number]` prefix; do not remove this prefix from Trello card titles.

## What you need

- A GitHub repository with Issues enabled.
- A personal or organization-owned GitHub Project containing Issues from that
  repository.
- A Trello board with Todo, In Progress and Done lists.
- Permission to create Actions secrets in the GitHub repository.
- A Trello account that is a member of the destination board.

## 1. Find the GitHub Project owner and number

Open the GitHub Project and inspect its URL.

For a personal Project:

```text
https://github.com/users/USERNAME/projects/5/views/1
```

- `GH_PROJECT_OWNER`: `USERNAME`
- `GH_PROJECT_NUMBER`: `5`

For an organization Project:

```text
https://github.com/orgs/ORGANIZATION/projects/5/views/1
```

- `GH_PROJECT_OWNER`: `ORGANIZATION`
- `GH_PROJECT_NUMBER`: `5`

Use the owner of the **Project**, which may differ from the repository owner. The
number following `/views/` is not the Project number.

## 2. Create a GitHub token

Open **GitHub → Settings → Developer settings → Personal access tokens → Tokens
(classic) → Generate new token (classic)**.

Enable:

- `read:project` to read Project items and Status values.
- `repo` to read Issues from private repositories.

The token owner must be able to view the Project and repository. If an organization
uses SAML SSO, authorize the token for that organization. The organization must also
permit classic personal access tokens.

Copy the token and save it later as `PROJECT_TOKEN`.

## 3. Create a Trello API key and token

1. Open [Trello app administration](https://trello.com/power-ups/admin).
2. Create or select an app.
3. Open its API key page and copy the **API Key**. Do not use the app Secret.
4. Open the following URL after replacing `YOUR_API_KEY`:

```text
https://trello.com/1/authorize?expiration=never&name=GitHub-Trello-Sync&scope=read,write&response_type=token&key=YOUR_API_KEY
```

5. Select **Allow** and copy the generated Trello user token.

The authorizing Trello user must have access to the destination board. Treat both
tokens as passwords.

You can verify the credentials in a browser without sharing the completed URL:

```text
https://api.trello.com/1/members/me?key=YOUR_API_KEY&token=YOUR_API_TOKEN
```

## 4. Find the Trello board and list IDs

List the boards accessible to the Trello token:

```text
https://api.trello.com/1/members/me/boards?fields=name&key=YOUR_API_KEY&token=YOUR_API_TOKEN
```

Copy the `id` of the destination board, then list that board's lists:

```text
https://api.trello.com/1/boards/YOUR_BOARD_ID/lists?fields=name&key=YOUR_API_KEY&token=YOUR_API_TOKEN
```

Copy the `id` values for the Todo, In Progress and Done lists. Use list IDs—not
label IDs—and confirm the lists are not archived.

## 5. Add repository secrets

In the repository whose Issues should be synchronized, open **Settings → Secrets
and variables → Actions → New repository secret**.

Add every secret below:

| Secret | Value |
| --- | --- |
| `GH_PROJECT_OWNER` | Username or organization login that owns the Project |
| `GH_PROJECT_NUMBER` | Number following `/projects/` in the Project URL |
| `PROJECT_TOKEN` | GitHub token created in step 2 |
| `TRELLO_API_KEY` | Trello API Key |
| `TRELLO_API_TOKEN` | Trello user token |
| `TRELLO_BOARD_ID` | Destination Trello board ID |
| `TRELLO_TODO_LIST_ID` | Todo list ID |
| `TRELLO_INPROGRESS_LIST_ID` | In Progress list ID |
| `TRELLO_DONE_LIST_ID` | Done list ID |
| `TRELLO_MEMBER_MAP` | GitHub-to-Trello username mappings as JSON |

If assignees do not need to be synchronized, set `TRELLO_MEMBER_MAP` to:

```json
[]
```

To synchronize assignees, map GitHub usernames to Trello usernames:

```json
["github-user:trello-user", "another-github-user:another-trello-user"]
```

Use usernames rather than display names. Mapped Trello users must already be board
members. Matching is case-insensitive.

## 6. Add the workflow

Create this file in the repository whose Issues should be synchronized:

```text
.github/workflows/trello-sync.yml
```

Copy the following workflow:

```yaml
name: GitHub Project → Trello

on:
  # Issue changes synchronize immediately.
  issues:
    types: [opened, edited, deleted, transferred, closed, reopened, assigned, unassigned, labeled, unlabeled, milestoned, demilestoned]

  # Project-only status changes are discovered at these scheduled times.
  schedule:
    - cron: "0 9,12,16 * * 1-5"
      timezone: Europe/Copenhagen

  # Allows manual synchronization from the Actions page.
  workflow_dispatch:

jobs:
  sync:
    uses: rajipkanxo01/Trello-Github-Sync/.github/workflows/sync-github-issues-to-trello.yml@v1
    secrets:
      GH_PROJECT_OWNER: ${{ secrets.GH_PROJECT_OWNER }}
      GH_PROJECT_NUMBER: ${{ secrets.GH_PROJECT_NUMBER }}
      PROJECT_TOKEN: ${{ secrets.PROJECT_TOKEN }}
      TRELLO_API_KEY: ${{ secrets.TRELLO_API_KEY }}
      TRELLO_API_TOKEN: ${{ secrets.TRELLO_API_TOKEN }}
      TRELLO_BOARD_ID: ${{ secrets.TRELLO_BOARD_ID }}
      TRELLO_TODO_LIST_ID: ${{ secrets.TRELLO_TODO_LIST_ID }}
      TRELLO_INPROGRESS_LIST_ID: ${{ secrets.TRELLO_INPROGRESS_LIST_ID }}
      TRELLO_DONE_LIST_ID: ${{ secrets.TRELLO_DONE_LIST_ID }}
      TRELLO_MEMBER_MAP: ${{ secrets.TRELLO_MEMBER_MAP }}
```

Commit and push the file to the repository's default branch.

### Change the schedule

The example runs at 09:00, 12:00 and 16:00 on weekdays in Copenhagen time. To
reconcile every 15 minutes instead, replace the `schedule` section with:

```yaml
schedule:
  - cron: "*/15 * * * *"
    timezone: Europe/Copenhagen
```

GitHub Project status movements do not emit a repository `issues` event. Keep the
schedule trigger if dragging an item to In progress or In review must update Trello
automatically. Scheduled Actions can occasionally be delayed by GitHub.

## 7. Test the synchronization

1. Open the target repository's **Actions** page.
2. Select **GitHub Project → Trello**.
3. Select **Run workflow → Run workflow**.
4. Open the completed run and review the **Trello reconciliation** summary.
5. Confirm that cards appear in the expected Trello lists.

A successful run may report:

```text
5 created, 3 updated, 0 skipped
```

Afterward, test both paths:

1. Edit or assign a GitHub Issue and confirm an Actions run starts immediately.
2. Move an Issue between GitHub Project statuses and confirm Trello is updated at
   the next scheduled run.

## Troubleshooting

### Project owner not found

Confirm that `GH_PROJECT_OWNER` exactly matches the login in the Project URL—not
the organization's display name. For example, a Project URL under
`/orgs/DADIU2024/` uses `DADIU2024`.

### Project not found or inaccessible

Confirm that `GH_PROJECT_NUMBER` is the number following `/projects/` and that the
owner of `PROJECT_TOKEN` can view the Project. For private repositories, ensure the
token has `repo`; for organization resources, check SSO authorization and token
policies.

### Items are reported as draft/non-Issue

Pull requests and draft items are intentionally skipped. If real Issues are also
reported this way, the token usually cannot read the repository. Add `repo` access
and authorize the token for the organization if required.

### Cards do not move after dragging a Project item

Dragging a Project item does not start an `issues` workflow. Wait for the next
scheduled run or use **Run workflow** to reconcile immediately.

### Trello returns 401 or 403

Confirm that `TRELLO_API_KEY` contains the API Key, `TRELLO_API_TOKEN` contains the
generated user token and that the token's user is a member of the destination
board with write access.

### Assignees are not synchronized

Confirm that `TRELLO_MEMBER_MAP` is valid JSON, uses usernames and that every
mapped Trello user is already a member of the board.

## License

Licensed under the [MIT License](LICENSE).
