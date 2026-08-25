import { appendFile, readFile } from "node:fs/promises";

const API = "https://api.trello.com/1";
const UPDATE_ACTIONS = new Set(["opened", "edited", "labeled", "unlabeled", "assigned", "unassigned"]);
const REQUIRED = ["TRELLO_API_KEY", "TRELLO_API_TOKEN", "TRELLO_BOARD_ID", "TRELLO_TODO_LIST_ID", "TRELLO_DONE_LIST_ID", "TRELLO_MEMBER_MAP"];

function config() {
  const missing = REQUIRED.filter(name => !process.env[name]);
  if (missing.length) throw new Error(`Missing GitHub Actions secrets: ${missing.join(", ")}`);
  let entries;
  try { entries = JSON.parse(process.env.TRELLO_MEMBER_MAP); } catch { entries = null; }
  if (!Array.isArray(entries)) throw new Error('TRELLO_MEMBER_MAP must be JSON such as [] or ["github:trello"]');
  return {
    key: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_API_TOKEN,
    board: process.env.TRELLO_BOARD_ID,
    todo: process.env.TRELLO_TODO_LIST_ID,
    done: process.env.TRELLO_DONE_LIST_ID,
    members: Object.fromEntries(entries.map(entry => {
      const [github, trello] = entry.toLowerCase().split(":");
      if (!github || !trello) throw new Error(`Invalid member mapping: ${entry}`);
      return [github.trim(), trello.trim()];
    })),
  };
}

async function request(settings, path, { method = "GET", body } = {}) {
  const separator = path.includes("?") ? "&" : "?";
  const auth = `key=${encodeURIComponent(settings.key)}&token=${encodeURIComponent(settings.token)}`;
  const response = await fetch(`${API}${path}${separator}${auth}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Trello ${method} ${path} failed (${response.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function summary(issue, action, result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const markdown = `## Trello synchronization\n\n| | |\n|---|---|\n| Issue | [#${issue.number}](${issue.html_url}) ${issue.title} |\n| Trigger | ${action} |\n| Result | ${result} |\n`;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
}

async function main() {
  const settings = config();
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const { action, issue } = event;
  if (!issue) throw new Error("This action must be triggered by a GitHub Issue event");
  const prefix = `[#${issue.number}]`;
  const cards = await request(settings, `/boards/${settings.board}/cards?fields=id,name,idList`);
  const card = cards.find(candidate => candidate.name.startsWith(prefix));

  async function fields() {
    const [labels, members] = await Promise.all([
      request(settings, `/boards/${settings.board}/labels?fields=id,name`),
      request(settings, `/boards/${settings.board}/members?fields=id,username`),
    ]);
    const labelNames = new Set(issue.labels.map(label => label.name.toLowerCase()));
    const usernames = new Set(issue.assignees.map(a => settings.members[a.login.toLowerCase()]).filter(Boolean));
    return {
      name: `${prefix} ${issue.title}`,
      desc: `${issue.body || ""}\n\nGitHub: ${issue.html_url}`.trim(),
      idLabels: labels.filter(l => l.name && labelNames.has(l.name.toLowerCase())).map(l => l.id).join(","),
      idMembers: members.filter(m => usernames.has(m.username.toLowerCase())).map(m => m.id).join(","),
    };
  }

  if (action === "opened" && !card) {
    await request(settings, "/cards", { method: "POST", body: { ...(await fields()), idList: settings.todo, pos: "bottom" } });
    await summary(issue, action, "Card created in Todo");
  } else {
    if (!card) throw new Error(`No Trello card beginning with ${prefix} was found`);
    if (UPDATE_ACTIONS.has(action)) {
      await request(settings, `/cards/${card.id}`, { method: "PUT", body: await fields() });
      await summary(issue, action, "Card details synchronized");
    } else if (action === "closed") {
      await request(settings, `/cards/${card.id}`, { method: "PUT", body: { idList: settings.done } });
      await summary(issue, action, "Card moved to Done");
    } else if (action === "reopened") {
      await request(settings, `/cards/${card.id}`, { method: "PUT", body: { idList: settings.todo } });
      await summary(issue, action, "Card moved to Todo");
    }
  }
  console.log(`Trello synchronized for issue #${issue.number} (${action})`);
}

main().catch(error => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
