import {test, expect} from "@playwright/test";
import {createHash} from "node:crypto";
import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";

const assets = ["index.html", "dashboard.css", "local-loader.css", "view.js",
  "local-loader.js", "workflow.svg", "workflow.mmd", ".nojekyll"];
const phases = ["Discovery", "Qualification", "Publication", "Resume build",
  "Resume review", "Application handoff", "Application"];

function syntheticPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n% Synthetic blank test document, not a resume.\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(`${pdf}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

const pdf = syntheticPdf();
const hash = createHash("sha256").update(pdf).digest("hex");
function handoff(overrides = {}) {
  return {
    scope: "application", artifactSha256: hash, validation: "passed",
    independentReview: "verified", routeStop: "clear", reservation: "clear",
    duplicate: "clear", authorization: "auto-cleared", personalAttestation: "not-required",
    ...overrides,
  };
}
function job(overrides = {}) {
  return {
    id: "synthetic-role", name: "Synthetic role", phase: "Application handoff",
    owner: "Private coordinator", status: "Approved", score: 100, scoreLabel: "100 / 100",
    published: true, waitingOnUser: false, nextStep: "Synthetic recorded next step.",
    links: [{label: "Synthetic role", url: "https://example.invalid/role"}], evidence: [],
    artifact: {label: "Synthetic blank PDF", path: "fixture.pdf", sha256: hash, notice: "Synthetic test artifact only."},
    handoff: handoff(), ...overrides,
  };
}
function data(jobs) {
  return {schemaVersion: 1, title: "Synthetic jobs", summary: "Synthetic test data only.",
    attention: "Producer summary.", jobs, blockers: []};
}
function files(jobs, bytes = pdf) {
  return [
    {name: "data.json", content: JSON.stringify(data(jobs))},
    {name: "fixture.pdf", content: [...bytes]},
  ];
}
async function selectFiles(page, jobs, bytes = pdf) {
  await page.locator("#local-folder").evaluate((input, entries) => {
    const transfer = new DataTransfer();
    for (const entry of entries) {
      const file = new File([typeof entry.content === "string" ? entry.content : new Uint8Array(entry.content)], entry.name);
      Object.defineProperty(file, "webkitRelativePath", {value: `synthetic/${entry.name}`});
      transfer.items.add(file);
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", {bubbles: true}));
  }, files(jobs, bytes));
}
async function load(page, jobs = [job()]) {
  await page.goto("/?mode=snapshot&view=all");
  await selectFiles(page, jobs);
  await expect(page.locator("#load-status")).toContainText(`Loaded ${jobs.length} jobs locally.`);
  await expect(page.locator("#load-error")).toBeHidden();
}
const row = page => page.locator("#opportunity-grid tbody tr").first();

test("AC1: configured auto-clear uses one exact-artifact handoff without another human wait", async ({page}) => {
  await load(page);
  await expect(row(page)).toHaveAttribute("data-state", "Auto-cleared");
  await expect(row(page)).toHaveAttribute("data-waiting", "false");
  await expect(row(page)).toContainText("NEW per-role application session");
  await expect(row(page)).toContainText("without another resume approval");
  await expect(page.locator('[data-view="mine"] span')).toHaveText("0");
  await expect(page.locator(".grid-summary")).toContainText("0 waiting on you");
});

test("AC1: human-required policy asks for the scoped decision only once", async ({page}) => {
  await load(page, [job({handoff: handoff({authorization: "human-required"})})]);
  await expect(row(page)).toHaveAttribute("data-state", "Waiting on you");
  await expect(row(page)).toHaveAttribute("data-waiting", "true");
  await expect(row(page)).toContainText("decision for this exact PDF and application scope");
  await page.locator('[data-view="mine"]').click();
  await expect(row(page)).toBeVisible();
  await selectFiles(page, [job({handoff: handoff({authorization: "human-approved"})})]);
  await expect(page.locator('[data-view="mine"] span')).toHaveText("0");
  await expect(row(page)).toHaveAttribute("data-state", "Ready");
  await expect(row(page)).toHaveAttribute("data-waiting", "false");
  await expect(page.locator("#grid-empty-title")).toHaveText("Nothing is waiting on you.");
});

test("AC1: automatic policy never supplies a missing personal attestation", async ({page}) => {
  await load(page, [job({handoff: handoff({personalAttestation: "required"})})]);
  await expect(row(page)).toHaveAttribute("data-state", "Waiting on you");
  await expect(row(page)).toContainText("missing personal attestation");
});

test("AC2: phase 7 is a new per-role browser session with every submission safeguard", async ({page}) => {
  const source = await readFile("workflow.mmd", "utf8");
  const application = source.split('subgraph APPLICATION["PHASE 7: Application"]')[1];
  for (const phrase of [
    "NEW per-role browser application session", "Separate from the resume builder",
    "live role, route stops", "reservations and prior applications", "applicable confirmed answers",
    "exact approved PDF", "Required pre-submit review", "tool confirmations and access barriers",
    "Submit once", "Verify site confirmation", "never blind retry",
  ]) expect(application).toContain(phrase);
  expect(application).toMatch(/style APPLICATION_SKILL .*stroke-dasharray:6 4/);
  await load(page, [job({phase: "Application", status: "Complete", handoff: undefined})]);
  await expect(row(page)).toHaveAttribute("data-state", "Complete");
  await expect(row(page)).toHaveAttribute("data-waiting", "false");
  await expect(row(page)).toContainText("Execution status is reported by the private per-role session");
});

const nonClearChecks = [
  ["validation", "failed", "Blocked"],
  ["validation", "pending", "In review"],
  ["independentReview", "pending", "In review"],
  ["independentReview", "rejected", "Blocked"],
  ["independentReview", "unknown", "Blocked"],
  ["routeStop", "stopped", "Blocked"],
  ["routeStop", "unknown", "Blocked"],
  ["reservation", "conflict", "Blocked"],
  ["reservation", "unknown", "Blocked"],
  ["duplicate", "found", "Blocked"],
  ["duplicate", "unknown", "Blocked"],
  ["authorization", "unknown", "Blocked"],
  ["personalAttestation", "unknown", "Blocked"],
];
for (const [field, value, status] of nonClearChecks) {
  test(`AC3: ${field}=${value} cannot clear an application handoff`, async ({page}) => {
    await load(page, [job({handoff: handoff({[field]: value})})]);
    await expect(row(page)).toHaveAttribute("data-state", status);
    await expect(row(page)).toHaveAttribute("data-waiting", "false");
    await expect(row(page)).toContainText("No application handoff is cleared");
  });
}
for (const field of Object.keys(handoff())) {
  test(`AC3: missing ${field} never counts as a passed prerequisite`, async ({page}) => {
    await load(page, [job({handoff: handoff({[field]: undefined})})]);
    await expect(row(page)).toHaveAttribute("data-state", "Blocked");
    await expect(row(page)).toContainText("No application handoff is cleared");
  });
}

test("AC3: threshold score and old approval metadata cannot replace handoff evidence", async ({page}) => {
  await load(page, [job({handoff: undefined, humanApproval: {status: "approved"}})]);
  await expect(row(page)).toHaveAttribute("data-state", "Blocked");
  await expect(row(page)).toContainText("Handoff evidence is not reported");
});

test("AC3: draft or absent PDF cannot clear even a policy-reported handoff", async ({page}) => {
  await load(page, [job({artifact: {label: "Draft not available"}})]);
  await expect(row(page)).toHaveAttribute("data-state", "Blocked");
  await expect(row(page)).toContainText("exact locally verified PDF");
});

test("AC3: another artifact's receipts cannot clear the current PDF", async ({page}) => {
  await load(page, [job({handoff: handoff({artifactSha256: "0".repeat(64)})})]);
  await expect(row(page)).toHaveAttribute("data-state", "Blocked");
  await expect(row(page)).toContainText("not a draft or an earlier artifact");
});

test("AC3: changed PDF bytes fail the existing hash check and retain a visibly stale snapshot", async ({page}) => {
  await load(page);
  await selectFiles(page, [job()], Buffer.concat([pdf, Buffer.from("changed")]));
  await expect(page.locator("#load-error")).toContainText("Resume PDF hash mismatch");
  await expect(page.locator("#load-status")).toContainText("last valid snapshot, which may be stale");
  await expect(row(page)).toHaveAttribute("data-state", "Auto-cleared");
});

test("AC3: header, local path and unverified reviewer results cannot bypass validation", async ({page}) => {
  await page.goto("/?mode=snapshot&view=all");
  await selectFiles(page, [job()], Buffer.from("not a PDF"));
  await expect(page.locator("#load-error")).toContainText("Resume artifact is not a PDF");
  await selectFiles(page, [job({artifact: {...job().artifact, path: "../fixture.pdf"}})]);
  await expect(page.locator("#load-error")).toContainText("Unsafe local file reference");
  await selectFiles(page, [job({handoff: handoff({independentReview: "approved"})})]);
  await expect(page.locator("#load-error")).toContainText("Unknown handoff independentReview");
  await expect(page.locator("#local-root")).toBeEmpty();
});

test("AC3: a known failure takes precedence over a pending reviewer or requested decision", async ({page}) => {
  await load(page, [job({handoff: handoff({independentReview: "pending", routeStop: "stopped", authorization: "human-required"})})]);
  await expect(row(page)).toHaveAttribute("data-state", "Blocked");
  await expect(row(page)).toHaveAttribute("data-waiting", "false");
  await expect(row(page)).toContainText("Route-stop check did not clear");
});

test("AC4: application clearance never authorizes other actions or provides a dispatch control", async ({page}) => {
  await load(page);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.getByRole("button", {name: /^(apply|submit|approve|send|upload)\b/i})).toHaveCount(0);
  await page.locator(".public-workflow summary").click();
  await expect(page.locator(".public-workflow")).toContainText("excludes outreach, profile edits and unrelated uploads");
  await expect(page.locator(".public-workflow")).toContainText("Required tool confirmations and access barriers still apply");
  await selectFiles(page, [job({handoff: handoff({scope: "outreach"})})]);
  await expect(page.locator("#load-error")).toContainText("Unknown handoff scope");
});

test("AC5: deployed bundle is exactly eight data-free assets and synthetic fixtures contain no private identifiers", async ({page}) => {
  expect((await readdir("dist")).sort()).toEqual([...assets].sort());
  const content = (await Promise.all(assets.map(name => readFile(resolve("dist", name), "utf8")))).join("\n");
  const fixtures = JSON.stringify(files([job()]));
  for (const text of [content, fixtures]) {
    expect(text).not.toMatch(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i);
    expect(text).not.toMatch(/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/);
    expect(text).not.toMatch(/ghapp:\/\/[^"'\s]+/);
    expect(text).not.toMatch(/[A-Z]:[\\/](?:Users|repos)[\\/]/i);
  }
  expect(content).not.toMatch(/%PDF-\d/);
  await page.goto("/");
  await expect(page.locator("#local-root")).toBeEmpty();
  expect(await page.locator("#view-template").evaluate(template => template.content.querySelector("tbody").childElementCount)).toBe(0);
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content")).toContain("connect-src 'none'");
});

test("AC5: local loads make no upload, external request or browser-storage write", async ({page}) => {
  const requests = [];
  page.on("request", request => requests.push({url: request.url(), method: request.method()}));
  await load(page);
  expect(requests.every(request => request.url.startsWith("http://127.0.0.1:4177/") && request.method === "GET")).toBe(true);
  expect(await page.evaluate(async () => ({
    local: localStorage.length, session: sessionStorage.length, databases: (await indexedDB.databases()).length,
  }))).toEqual({local: 0, session: 0, databases: 0});
  await page.locator("#clear-data").click();
  await expect(page.locator("#local-root")).toBeEmpty();
});

test("AC6: diagram, committed Pages SVG, built SVG and dashboard share the seven phases and all labels", async ({page}) => {
  const source = await readFile("workflow.mmd", "utf8");
  const labels = [...source.matchAll(/(?:\[|accTitle:\s*)(?:"([^"]+)"|([^\r\n]+))/g)]
    .map(match => match[1] || match[2]).filter(label => !label.includes("accDescr"));
  const compact = text => text.replace(/<br\s*\/?>/g, "").replace(/\s+/g, "");
  const svgLabels = [];
  for (const path of ["workflow.svg", resolve("dist", "workflow.svg")]) {
    const svg = await readFile(path, "utf8");
    svgLabels.push(await page.evaluate(svg => {
      const document = new DOMParser().parseFromString(svg, "image/svg+xml");
      if (document.querySelector("parsererror")) throw new Error("Invalid SVG");
      if (document.querySelector("script,foreignObject")) throw new Error("Unexpected active SVG content");
      return [...document.querySelectorAll("text,title")].map(node => node.textContent).join(" ");
    }, svg));
  }
  for (const text of svgLabels) {
    for (const label of labels) expect(compact(text)).toContain(compact(label));
  }
  expect(compact(svgLabels[0])).toBe(compact(svgLabels[1]));
  const sourcePhases = [...source.matchAll(/subgraph \w+\["PHASE \d: ([^"]+)"\]/g)].map(match => match[1]);
  expect(sourcePhases).toEqual(phases);
  await load(page);
  expect(await page.locator("#grid-phase option").allTextContents()).toEqual(["All phases", ...phases]);
  expect(source).not.toContain("PHASE 8");
  expect(source).not.toContain("Not permission to apply or send");
  expect(source).not.toContain("YOU: Authorize the specific application");
});

test("AC6: numbered main steps are unique and phase progression never goes backwards", async () => {
  const source = await readFile("workflow.mmd", "utf8");
  expect([...source.matchAll(/\["(\d+)\. /g)].map(match => Number(match[1])).sort((a, b) => a - b))
    .toEqual(Array.from({length: 17}, (_, index) => index + 1));
  const stack = [];
  const phaseOf = {};
  const edges = [];
  for (const line of source.split("\n")) {
    const subgraph = line.match(/^\s*subgraph (\w+)\["(?:PHASE (\d): )?/);
    if (subgraph) {
      const phase = subgraph[2] ? Number(subgraph[2]) : stack.at(-1);
      stack.push(phase);
      phaseOf[subgraph[1]] = phase;
    } else if (line.trim() === "end") stack.pop();
    const node = line.match(/^\s*(\w+)\["/);
    if (node) phaseOf[node[1]] = stack.at(-1);
    const edge = line.match(/^\s*(\w+)\s+(?:-->|-\.).*(?:-->|\.->|\|)\s*(\w+)\s*$/)
      || line.match(/^\s*(\w+)\s+-->\s+(\w+)\s*$/);
    if (edge) edges.push([edge[1], edge[2]]);
  }
  expect(edges.length).toBeGreaterThan(30);
  for (const [from, to] of edges) {
    expect(phaseOf[from], from).toBeDefined();
    expect(phaseOf[to], to).toBeDefined();
    expect(phaseOf[to], `${from} -> ${to}`).toBeGreaterThanOrEqual(phaseOf[from]);
  }
});

test("AC6: In review is filterable, not red Blocked and never a human approval", async ({page}) => {
  await load(page, [
    job({id: "synthetic-pending", phase: "Resume review", status: "In review", handoff: undefined}),
    job({id: "synthetic-blocked", name: "Synthetic blocked role", phase: "Resume review", status: "Blocked", handoff: undefined}),
  ]);
  const pending = page.locator('[data-id="synthetic-pending"]');
  const blocked = page.locator('[data-id="synthetic-blocked"]');
  await expect(pending).toHaveAttribute("data-waiting", "false");
  expect(await pending.locator(".state").evaluate(node => getComputedStyle(node).color))
    .not.toBe(await blocked.locator(".state").evaluate(node => getComputedStyle(node).color));
  await page.locator("#grid-state").selectOption("In review");
  await expect(pending).toBeVisible();
  await expect(blocked).toBeHidden();
  await expect(page.locator('[data-view="mine"] span')).toHaveText("0");
  await expect(page.locator('[data-view="blocked"] span')).toHaveText("1");
});

test("AC6: legacy phase labels load without inventing scope or repeating past decisions", async ({page}) => {
  await load(page, [
    job({phase: "Human review", handoff: undefined}),
    job({id: "synthetic-legacy", name: "Synthetic legacy role", phase: "Authorized action", status: "Complete", handoff: undefined}),
  ]);
  await expect(row(page)).toHaveAttribute("data-phase", "Application handoff");
  await expect(row(page)).toHaveAttribute("data-state", "Blocked");
  const legacy = page.locator('[data-id="synthetic-legacy"]');
  await expect(legacy).toHaveAttribute("data-phase", "Application");
  await expect(legacy).toHaveAttribute("data-state", "Complete");
  await expect(legacy).toHaveAttribute("data-waiting", "false");
  await expect(legacy).toContainText("application scope is not established by this phase label");
});

async function installLiveFolder(page, jobs) {
  await page.addInitScript(entries => {
    window.testEntries = entries;
    window.testPermission = "granted";
    window.testReads = 0;
    const handle = {
      queryPermission: async () => window.testPermission,
      async *entries() {
        window.testReads++;
        for (const entry of window.testEntries) {
          yield [entry.name, {kind: "file", getFile: async () => new File([
            typeof entry.content === "string" ? entry.content : new Uint8Array(entry.content),
          ], entry.name, {lastModified: 1})}];
        }
      },
    };
    window.showDirectoryPicker = async options => {
      if (options.mode !== "read") throw new Error("Only read access is allowed");
      return handle;
    };
  }, files(jobs));
}

test("AC6: live-folder query preferences and filters survive a content-hash refresh", async ({page}) => {
  const jobs = [
    job({id: "synthetic-alpha", name: "Alpha role", handoff: handoff({independentReview: "pending"})}),
    job({id: "synthetic-beta", name: "Beta role", handoff: handoff({independentReview: "pending"})}),
  ];
  await page.setViewportSize({width: 1000, height: 900});
  await installLiveFolder(page, jobs);
  await page.goto("/?mode=live&refresh=45&view=all");
  await expect(page.locator("#mode-help")).toContainText("refresh every 45s, initial view all");
  await page.locator("#connect-folder").click();
  await expect(page.locator("#load-status")).toContainText("Live folder connected. 2 jobs");
  await page.locator("#grid-search").fill("Alpha");
  await page.locator("#grid-phase").selectOption("Application handoff");
  await page.locator("#grid-owner").selectOption("Private coordinator");
  await page.locator("#grid-state").selectOption("In review");
  await page.locator('th[data-sort="score"] button').click();
  await page.locator(".grid-scroll").evaluate(node => { node.scrollLeft = 100; });
  const scroll = await page.locator(".grid-scroll").evaluate(node => node.scrollLeft);
  jobs[0].score = 99;
  jobs[0].scoreLabel = "99 / 100";
  await page.evaluate(entries => { window.testEntries = entries; }, files(jobs));
  await page.locator("#refresh-folder").click();
  await expect(page.locator('[data-id="synthetic-alpha"]')).toHaveAttribute("data-score", "99");
  await expect(page.locator("#grid-search")).toHaveValue("Alpha");
  await expect(page.locator("#grid-phase")).toHaveValue("Application handoff");
  await expect(page.locator("#grid-owner")).toHaveValue("Private coordinator");
  await expect(page.locator("#grid-state")).toHaveValue("In review");
  await expect(page.locator('th[data-sort="score"]')).toHaveAttribute("aria-sort", "descending");
  expect(await page.locator(".grid-scroll").evaluate(node => node.scrollLeft)).toBe(scroll);
  await expect(page.locator('[data-id="synthetic-beta"]')).toBeHidden();
  await expect(page.locator('[data-view="all"]')).toHaveAttribute("aria-pressed", "true");
});

test("AC6: live polling honors the interval, artifact dialog and revoked folder access", async ({page}) => {
  await installLiveFolder(page, [job()]);
  await page.clock.install();
  await page.goto("/?mode=live&refresh=15&view=all");
  await page.locator("#connect-folder").click();
  await expect(page.locator("#load-status")).toContainText("Live folder connected. 1 jobs");
  expect(await page.evaluate(() => window.testReads)).toBe(1);
  await page.clock.runFor(15000);
  await expect.poll(() => page.evaluate(() => window.testReads)).toBe(2);
  await expect(page.locator("#load-status")).toContainText("no file changes");
  await page.getByRole("link", {name: "Synthetic blank PDF", exact: true}).click();
  await expect(page.locator("#artifact-dialog")).toBeVisible();
  await page.clock.runFor(30000);
  expect(await page.evaluate(() => window.testReads)).toBe(2);
  await page.locator("#close-artifact").click();
  await page.evaluate(() => { window.testPermission = "denied"; });
  await page.locator("#refresh-folder").click();
  await expect(page.locator("#load-error")).toContainText("Folder permission is no longer granted");
  await expect(page.locator("#refresh-folder")).toBeDisabled();
  await expect(page.locator("#load-status")).toContainText("live data may be stale");
});

for (const preferences of ["mode=bad", "refresh=14", "refresh=3601", "refresh=1.5", "view=unknown"]) {
  test(`AC6: invalid query preference ${preferences} remains rejected`, async ({page}) => {
    await page.goto(`/?${preferences}`);
    await expect(page.locator("#load-error")).toContainText("Invalid URL preferences");
    await expect(page.locator("#local-folder")).toBeDisabled();
  });
}

test("AC6: responsive view and generated application handoff remain readable", async ({page}, testInfo) => {
  await load(page, [
    job({id: "synthetic-auto", name: "Synthetic automatic handoff"}),
    job({id: "synthetic-human", name: "Synthetic required decision", handoff: handoff({authorization: "human-required"})}),
    job({id: "synthetic-review", name: "Synthetic pending review", phase: "Resume review", status: "In review", handoff: undefined}),
  ]);
  await page.screenshot({path: testInfo.outputPath("dashboard-desktop.png"), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path: testInfo.outputPath("dashboard-mobile.png"), fullPage: true});
  await page.locator("#workflow summary").click();
  const image = page.locator("#workflow img");
  await expect(image).toBeVisible();
  expect(await image.evaluate(node => node.getBoundingClientRect().width / node.naturalWidth)).toBeGreaterThanOrEqual(0.99);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto("/workflow.svg");
  await page.setViewportSize({width: 1600, height: 1200});
  const handoffDiagram = page.locator("#workflow-HANDOFF");
  await expect(handoffDiagram).toBeVisible();
  await handoffDiagram.screenshot({path: testInfo.outputPath("handoff-diagram.png")});
  await page.locator("#workflow-APPLICATION").screenshot({path: testInfo.outputPath("application-diagram.png")});
});
