// The file-issue action's script (action.yml), a module of its own so its
// choice of issue is tested (file-issue.test.mjs, in `make web-check`):
// github-script hands it its `github`, `context` and `core`, and the inputs
// come in the environment.
//
// - `ISSUE` set: a comment on that issue, whatever its title (a quarantined
//   test's own issue, which its annotation names). Nothing is searched for
//   and nothing opened.
// - Otherwise the open issue this workflow opened under `TITLE` gets the
//   comment, or one is opened under it, with `LABELS` (comma-separated).
//
// The body: what the run was (`RUN`, or else "The nightly run" for a
// scheduled one and "The push" for any other), what failed (`FAILED`, or
// else the jobs `RESULTS` says failed), `DETAIL` under it when given, the
// run's link, and `ADVICE`.

/** The comment's or the issue's text. */
function bodyOf({ context, env }) {
  const { owner, repo } = context.repo;
  const run = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  const failed = env.FAILED
    ? env.FAILED
    : Object.entries(JSON.parse(env.RESULTS || "{}"))
        .filter(([, v]) => v.result === "failure")
        .map(([k]) => `\`${k}\``)
        .join(", ");
  const why = env.RUN || (context.eventName === "schedule" ? "The nightly run" : "The push");
  return [
    `${why} at ${context.sha.slice(0, 7)} failed: ${failed}.`,
    "",
    ...(env.DETAIL ? [env.DETAIL, ""] : []),
    `Run: ${run}`,
    "",
    env.ADVICE,
  ].join("\n");
}

/** Comment on the named issue, or on the open one under the title, or open
 *  one. Resolves to { action: "commented" | "opened", number }. */
async function fileIssue({ github, context, core, env = process.env }) {
  const { owner, repo } = context.repo;
  const body = bodyOf({ context, env });
  const named = String(env.ISSUE || "").trim();
  if (named) {
    if (!/^\d+$/.test(named)) throw new Error(`issue is not an issue number: ${named}`);
    const issue_number = Number(named);
    await github.rest.issues.createComment({ owner, repo, issue_number, body });
    core.info(`commented on #${issue_number}`);
    return { action: "commented", number: issue_number };
  }
  const title = env.TITLE;
  if (!title) throw new Error("file-issue needs a title, or an issue to comment on");
  const open = await github.paginate(github.rest.issues.listForRepo, {
    owner, repo, state: "open", creator: "github-actions[bot]", per_page: 100,
  });
  const existing = open.find((i) => i.title === title && !i.pull_request);
  if (existing) {
    await github.rest.issues.createComment({ owner, repo, issue_number: existing.number, body });
    core.info(`commented on #${existing.number}`);
    return { action: "commented", number: existing.number };
  }
  const labels = String(env.LABELS || "").split(",").map((l) => l.trim()).filter(Boolean);
  const { data } = await github.rest.issues.create({ owner, repo, title, body, ...(labels.length ? { labels } : {}) });
  core.info(`opened #${data.number}`);
  return { action: "opened", number: data.number };
}

module.exports = { fileIssue, bodyOf };
