import { appendFile } from "node:fs/promises";

const required = ["TRELLO_API_KEY", "TRELLO_API_TOKEN", "TRELLO_BOARD_ID", "TRELLO_TODO_LIST_ID", "TRELLO_INPROGRESS_LIST_ID", "TRELLO_DONE_LIST_ID", "TRELLO_MEMBER_MAP", "PROJECT_TOKEN", "GH_PROJECT_OWNER", "GH_PROJECT_NUMBER", "GITHUB_REPOSITORY"];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}`);

let memberMap;
try {
  memberMap = Object.fromEntries(JSON.parse(process.env.TRELLO_MEMBER_MAP).map(entry => {
    const [github, trello] = entry.toLowerCase().split(":");
    if (!github || !trello) throw new Error();
    return [github.trim(), trello.trim()];
  }));
} catch {
  throw new Error('TRELLO_MEMBER_MAP must be JSON such as [] or ["github:trello"]');
}

const config = {
  key: process.env.TRELLO_API_KEY,
  token: process.env.TRELLO_API_TOKEN,
  board: process.env.TRELLO_BOARD_ID,
  projectOwner: process.env.GH_PROJECT_OWNER,
  projectNumber: Number(process.env.GH_PROJECT_NUMBER),
  repository: process.env.GITHUB_REPOSITORY.toLowerCase(),
  lists: {
    todo: process.env.TRELLO_TODO_LIST_ID,
    progress: process.env.TRELLO_INPROGRESS_LIST_ID,
    done: process.env.TRELLO_DONE_LIST_ID,
  },
};

async function trello(path, { method = "GET", body } = {}) {
  const separator = path.includes("?") ? "&" : "?";
  const auth = `key=${encodeURIComponent(config.key)}&token=${encodeURIComponent(config.token)}`;
  return api(`https://api.trello.com/1${path}${separator}${auth}`, { method, body }, `Trello ${method} ${path}`);
}

async function api(url, { method = "GET", body, headers = {} } = {}, label = method) {
  const response = await fetch(url, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function projectItems() {
  const projectFields = `projectV2(number:$number){items(first:100,after:$after){nodes{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}} content{... on Issue{number title body url state repository{nameWithOwner} labels(first:100){nodes{name}} assignees(first:100){nodes{login}}}}} pageInfo{hasNextPage endCursor}}}`;
  const query = `query($login:String!,$number:Int!,$after:String){repositoryOwner(login:$login){... on User{${projectFields}} ... on Organization{${projectFields}}}}`;
  const items = [];
  let after = null;
  do {
    const result = await api("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PROJECT_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" },
      body: { query, variables: { login: config.projectOwner, number: config.projectNumber, after } },
    }, "GitHub Project query");
    if (result.errors) throw new Error(`GitHub Project query failed: ${JSON.stringify(result.errors)}`);
    const connection = result.data?.repositoryOwner?.projectV2?.items;
    if (!connection) throw new Error("Personal or organization Project not found, or PROJECT_TOKEN cannot access it");
    items.push(...connection.nodes);
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  return items;
}

function targetList(status) {
  const value = status?.toLowerCase();
  if (["backlog", "ready", "todo", "to do"].includes(value)) return config.lists.todo;
  if (["in progress", "in review", "review"].includes(value)) return config.lists.progress;
  if (["done", "complete", "completed"].includes(value)) return config.lists.done;
  return null;
}

async function main() {
  const [items, cards, labels, members] = await Promise.all([
    projectItems(),
    trello(`/boards/${config.board}/cards?fields=id,name,idList`),
    trello(`/boards/${config.board}/labels?fields=id,name`),
    trello(`/boards/${config.board}/members?fields=id,username`),
  ]);
  let created = 0, updated = 0;
  const skipped = { notIssue: 0, otherRepository: 0, unknownStatus: 0 };

  for (const item of items) {
    const issue = item.content;
    if (!issue?.repository) {
      skipped.notIssue++;
      continue;
    }
    if (issue.repository.nameWithOwner.toLowerCase() !== config.repository) {
      skipped.otherRepository++;
      console.log(`Skipping ${issue.url}: belongs to ${issue.repository.nameWithOwner}, not ${config.repository}`);
      continue;
    }
    const idList = targetList(item.fieldValueByName?.name);
    if (!idList) {
      skipped.unknownStatus++;
      console.log(`Skipping ${issue.url}: unsupported status ${JSON.stringify(item.fieldValueByName?.name ?? "No status")}`);
      continue;
    }
    const prefix = `[#${issue.number}]`;
    const card = cards.find(candidate => candidate.name.startsWith(prefix));
    const issueLabels = new Set(issue.labels.nodes.map(label => label.name.toLowerCase()));
    const usernames = new Set(issue.assignees.nodes.map(a => memberMap[a.login.toLowerCase()]).filter(Boolean));
    const body = {
      name: `${prefix} ${issue.title}`,
      desc: `${issue.body || ""}\n\nGitHub: ${issue.url}`.trim(),
      idList,
      idLabels: labels.filter(l => l.name && issueLabels.has(l.name.toLowerCase())).map(l => l.id).join(","),
      idMembers: members.filter(m => usernames.has(m.username.toLowerCase())).map(m => m.id).join(","),
    };
    if (card) {
      await trello(`/cards/${card.id}`, { method: "PUT", body });
      updated++;
    } else {
      await trello("/cards", { method: "POST", body: { ...body, pos: "bottom" } });
      created++;
    }
  }

  const skippedTotal = skipped.notIssue + skipped.otherRepository + skipped.unknownStatus;
  const result = `${created} created, ${updated} updated, ${skippedTotal} skipped`;
  const details = `Draft/non-Issue: ${skipped.notIssue}; other repository: ${skipped.otherRepository}; unsupported/no status: ${skipped.unknownStatus}`;
  console.log(result);
  console.log(details);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Trello reconciliation\n\n${result}\n\n${details}\n`);
  }
}

main().catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1; });
