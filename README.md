# GitHub Project → Trello Sync

Synchronize a personal or organization-owned GitHub Project with a Trello board
without Zapier, a hosted server, or another automation service. Users can run the
integration after updates or at a chosen time interval.
GitHub Actions calls the GitHub GraphQL and Trello REST APIs directly.

## What it synchronizes

Each GitHub Project Issue becomes a Trello card. Existing cards are updated on every
run, including the Issue title, description, matching labels, mapped assignees, and
the destination list.

| GitHub Project status | Trello list |
| --- | --- |
| `Backlog`, `Ready`, `Todo`, `To do` | Todo |
| `In progress`, `In review`, `Review` | In Progress |
| `Done`, `Complete`, `Completed` | Done |

Cards are linked to Issues through a `[#issue-number]` title prefix. Do not remove
that prefix from synchronized Trello cards.

The included workflow currently uses update-driven synchronization:

- Relevant Issue changes run the synchronization immediately.
- A manual run is always available from GitHub Actions.

See [Choose exactly one synchronization mode](#6-choose-exactly-one-synchronization-mode) to
choose interval-driven synchronization instead.

## Prerequisites

- A GitHub repository with Issues enabled.
- A personal or organization-owned GitHub Project containing Issues from that repository.
- A Trello board with Todo, In Progress, and Done lists.
- Admin access to configure GitHub Actions secrets.
- A Trello account that is a member of the destination board.

Draft Project items and pull requests are not synchronized.

## 1. Find the GitHub Project owner and number

Open the Project and inspect its URL:

```text
https://github.com/users/USERNAME/projects/5/views/1
```

- Project owner: `USERNAME`
- Project number: `5`
- `1` after `/views/` is the view number and is not used.

For an organization Project, the URL looks like:

```text
https://github.com/orgs/ORGANIZATION/projects/5/views/1
```

- Project owner: `ORGANIZATION`
- Project number: `5`

The integration automatically checks both `user.projectV2` and
`organization.projectV2`, so the same configuration supports either ownership type.

## 2. Create the GitHub Project token

Open **GitHub → Settings → Developer settings → Personal access tokens → Tokens
(classic) → Generate new token (classic)**.

Select only the access needed by this integration:

- `repo` — required to read Issues from a private repository.
- `read:project` — required to query Project items and Status values.

The workflow reads GitHub data; it does not need the `project` write scope or the
`workflow` scope. Choose an expiration date and rotate the token before it expires.

For an organization Project, also confirm that:

- The token owner can view the Project and every repository being synchronized.
- The organization permits classic personal access tokens.
- If the organization uses SAML SSO, the token is authorized for that organization.
- The `repo` scope is enabled when the organization repository is private.

Copy the generated token immediately. It will be stored as `PROJECT_TOKEN` later.

## 3. Create a Trello API key and token

1. Open [Trello app administration](https://trello.com/power-ups/admin).
2. Create or select an app.
3. Open its **API key** page and copy the **API Key**. Do not use the app Secret.
4. Generate a Trello user token with this URL, replacing `YOUR_API_KEY`:

```text
https://trello.com/1/authorize?expiration=never&name=GitHub-Trello-Sync&scope=read,write&response_type=token&key=YOUR_API_KEY
```

5. Select **Allow** and copy the generated token.

The Trello token acts as the authorizing user and must have access to the target
board. Treat both API tokens as passwords.

Test the Trello credentials without sharing the completed URL:

```text
https://api.trello.com/1/members/me?key=YOUR_API_KEY&token=YOUR_API_TOKEN
```

## 4. Find the Trello board and list IDs

List the boards accessible to the Trello token:

```text
https://api.trello.com/1/members/me/boards?fields=name&key=YOUR_API_KEY&token=YOUR_API_TOKEN
```

Copy the `id` for the destination board. Then list its lists:

```text
https://api.trello.com/1/boards/YOUR_BOARD_ID/lists?fields=name&key=YOUR_API_KEY&token=YOUR_API_TOKEN
```

Copy the IDs for the Todo, In Progress, and Done lists. Confirm that every returned
list has the expected board ID and is not archived.

## 5. Configure GitHub Actions secrets

Open the repository and go to **Settings → Secrets and variables → Actions →
Secrets → New repository secret**.

Add all of the following as repository secrets:

| Secret | Value |
| --- | --- |
| `GH_PROJECT_OWNER` | GitHub username or organization login that owns the Project |
| `GH_PROJECT_NUMBER` | Number after `/projects/` in the Project URL |
| `PROJECT_TOKEN` | Classic GitHub token with `repo` and `read:project` |
| `TRELLO_API_KEY` | Trello app API Key |
| `TRELLO_API_TOKEN` | Trello user token with `read,write` access |
| `TRELLO_BOARD_ID` | Destination Trello board ID |
| `TRELLO_TODO_LIST_ID` | Todo list ID |
| `TRELLO_INPROGRESS_LIST_ID` | In Progress list ID |
| `TRELLO_DONE_LIST_ID` | Done list ID |
| `TRELLO_MEMBER_MAP` | GitHub-to-Trello username mappings as JSON |

Use an empty JSON array if member synchronization is not needed:

```json
[]
```

To synchronize assignees, use GitHub and Trello usernames—not display names:

```json
["github-user:trello-user", "another-github-user:another-trello-user"]
```

Mapped Trello users must already be members of the board. Matching is
case-insensitive.

## 6. Choose exactly one synchronization mode

The workflow's `on` section is the user's trigger configuration. Keep only the
automatic trigger for the behavior you want:

| Choice | Keep |
| --- | --- |
| After every Issue update | `issues` |
| At a time interval | `schedule` |

Combining automatic trigger modes is not supported. A caller workflow must contain
exactly one of `issues` or `schedule`. Do not put both in the same workflow.

`workflow_dispatch` should normally remain enabled so a user can test or reconcile
manually; it does not count as an automatic trigger.

To change the interval, edit the cron expression under `schedule`. For example,
every 15 minutes is:

```yaml
schedule:
  - cron: "*/15 * * * *"
    timezone: Europe/Copenhagen
```

GitHub Actions permits scheduled runs as often as every five minutes. Scheduled
runs can occasionally be delayed by GitHub Actions load.

### Trigger examples

Create `.github/workflows/trello-sync.yml` in the repository whose Issues are in
the GitHub Project. Choose exactly one of these `on` configurations, then use the
`jobs` configuration from
[Reusing it from another repository](#reusing-it-from-another-repository).

Run after every relevant Issue update:

```yaml
on:
  issues:
    types: [opened, edited, deleted, transferred, closed, reopened, assigned, unassigned, labeled, unlabeled, milestoned, demilestoned]
  workflow_dispatch:
```

Run every 15 minutes:

```yaml
on:
  schedule:
    - cron: "*/15 * * * *"
      timezone: Europe/Copenhagen
  workflow_dispatch:
```

For example, changing an Issue title triggers the update-driven configuration
immediately. Moving only its GitHub Project status requires interval mode.

### Project status updates

The `issues` event covers Issue changes such as title, description, labels,
assignees, and open/closed state. Moving an item between statuses in a GitHub
Project does not emit a native GitHub Actions workflow event. Keep `schedule` if
those moves must be discovered automatically.

## 7. Configure labels

The integration matches GitHub and Trello labels by name, ignoring capitalization.
Create the equivalent labels on the Trello board before running the workflow.
GitHub labels without a matching Trello label are ignored.

## 8. Test the synchronization

1. Commit and push `.github/workflows/sync-github-issues-to-trello.yml`, `action.yml`,
   and `src/trello-sync.mjs` to the default branch.
2. Open **Actions → GitHub Project → Trello**.
3. Select **Run workflow → Run workflow**.
4. Open the completed run and review the **Trello reconciliation** summary.
5. Confirm that cards were created or updated in the expected Trello lists.

A successful summary resembles:

```text
5 created, 3 updated, 0 skipped
```

## Reusing it from another repository

Keep the full implementation in this repository. A different repository can call the
reusable workflow with a small workflow file:

```yaml
name: GitHub Project → Trello

on:
  # This example uses interval mode. Replace this block with the `issues` block
  # from the trigger examples above to use update-driven mode instead.
  schedule:
    - cron: "0 9,12,16 * * 1-5"
      timezone: Europe/Copenhagen

  workflow_dispatch:

jobs:
  sync:
    uses: rajipkanxo01/Trello-Github-Sync/.github/workflows/sync-github-issues-to-trello.yml@main
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
