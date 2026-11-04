"use strict";
(() => {
  const picker = document.getElementById("local-folder");
  const root = document.getElementById("local-root");
  const status = document.getElementById("load-status");
  const error = document.getElementById("load-error");
  const clear = document.getElementById("clear-data");
  const dialog = document.getElementById("artifact-dialog");
  const connect = document.getElementById("connect-folder");
  const refresh = document.getElementById("refresh-folder");
  const modeHelp = document.getElementById("mode-help");
  const preferences = new URLSearchParams(location.search);
  const mode = preferences.get("mode") || "live";
  const refreshSeconds = Number(preferences.get("refresh") || "30");
  const initialView = preferences.get("view") || "attention";
  const validViews = ["attention", "mine", "blocked", "all", "published"];
  const liveSupported = typeof window.showDirectoryPicker === "function";
  let generation = 0;
  let blobUrls = [];
  let liveHandle = null;
  let liveTimer = null;
  let liveBusy = false;
  let lastSignature = "";
  const phases = ["Discovery", "Qualification", "Publication", "Resume build", "Resume review", "Application handoff", "Application"];
  const states = ["Blocked", "Not built", "Rejected", "Parked", "Research", "Awaiting scoring", "In review", "Ready", "Approved", "Auto-cleared", "Waiting on you", "Complete"];
  const phaseAliases = {"Human review": "Application handoff", "Authorized action": "Application"};
  const handoffValues = {
    scope: ["application", "unknown"],
    validation: ["passed", "pending", "failed", "unknown"],
    independentReview: ["verified", "pending", "rejected", "unknown"],
    routeStop: ["clear", "pending", "stopped", "unknown"],
    reservation: ["clear", "pending", "conflict", "unknown"],
    duplicate: ["clear", "pending", "found", "unknown"],
    authorization: ["auto-cleared", "human-required", "human-approved", "unknown"],
    personalAttestation: ["complete", "required", "not-required", "unknown"],
  };
  function phaseName(value) {
    return Object.hasOwn(phaseAliases, value) ? phaseAliases[value] : value;
  }
  function handoffView(job, verifiedHash) {
    const result = (status, nextStep) => ({status, waitingOnUser: status === "Waiting on you", nextStep});
    const blocked = reason => result("Blocked", `${reason} No application handoff is cleared.`);
    const handoff = job.handoff;
    if (!handoff) return blocked("Handoff evidence is not reported. The private coordinator must refresh this record.");
    if (handoff.scope !== "application") return blocked("Application-only authorization is not confirmed.");
    if (!verifiedHash || handoff.artifactSha256?.toLowerCase() !== verifiedHash) {
      return blocked("The handoff must identify this exact locally verified PDF, not a draft or an earlier artifact.");
    }
    const checks = [
      ["validation", "passed", "Exact-PDF validation"],
      ["independentReview", "verified", "All required independent approvals"],
      ["routeStop", "clear", "Route-stop check"],
      ["reservation", "clear", "Reservation check"],
      ["duplicate", "clear", "Duplicate-application check"],
    ];
    const failed = checks.find(([key, passed]) => handoff[key] && ![passed, "pending", "unknown"].includes(handoff[key]));
    if (failed) return blocked(`${failed[2]} did not clear (${handoff[failed[0]]}).`);
    const unknown = checks.find(([key]) => !handoff[key] || handoff[key] === "unknown");
    if (unknown) return blocked(`${unknown[2]} is missing or unknown.`);
    const pending = checks.filter(([key]) => handoff[key] === "pending");
    if (pending.length) {
      return result("In review", `Pending: ${pending.map(([, , label]) => label).join(", ")}. No application handoff is cleared.`);
    }
    if (!handoff.authorization || handoff.authorization === "unknown") return blocked("Configured application authorization is missing or unknown.");
    if (!handoff.personalAttestation || handoff.personalAttestation === "unknown") return blocked("Personal-attestation requirements are unknown.");
    if (handoff.authorization === "human-required" || handoff.personalAttestation === "required") {
      const needs = [];
      if (handoff.authorization === "human-required") needs.push("the policy-required decision for this exact PDF and application scope");
      if (handoff.personalAttestation === "required") needs.push("a missing personal attestation");
      return result("Waiting on you", `Provide ${needs.join(" and ")} in the private session. Record it once, then recheck this handoff.`);
    }
    // These are coordinator-reported receipts, not an authorization issued by this page.
    return result(handoff.authorization === "auto-cleared" ? "Auto-cleared" : "Ready",
      `${handoff.authorization === "auto-cleared" ? "Existing private policy clears" : "The required human decision is recorded for"} this exact PDF and application scope. Handoff is to a NEW per-role application session, without another resume approval. This page starts nothing.`);
  }
  function node(tag, value = "", attributes = {}) {
    const element = document.createElement(tag);
    element.textContent = value;
    for (const [key, val] of Object.entries(attributes)) element.setAttribute(key, val);
    return element;
  }
  function text(value, field) {
    if (typeof value !== "string") throw new Error(`${field} must be text`);
    return value;
  }
  function safeUrl(value) {
    if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value)) throw new Error("Invalid link");
    const parsed = new URL(value);
    if (!["https:", "http:", "ghapp:"].includes(parsed.protocol) || !parsed.host || parsed.username || parsed.password) {
      throw new Error("Links must be HTTP(S) or app session URLs without credentials");
    }
    return value;
  }
  function addLinks(target, values) {
    if (!Array.isArray(values)) throw new Error("Links must be an array");
    for (const [index, link] of values.entries()) {
      if (index) target.append(document.createTextNode(" · "));
      target.append(node("a", text(link.label, "Link label"), {href: safeUrl(link.url), rel: "noreferrer"}));
    }
  }
  function validate(data) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.jobs) || !Array.isArray(data.blockers)) {
      throw new Error("Expected dashboard schemaVersion 1 with jobs and blockers arrays");
    }
    for (const key of ["title", "summary", "attention"]) text(data[key], key);
    const ids = new Set();
    for (const job of data.jobs) {
      text(job.id, "Job id");
      if (ids.has(job.id)) throw new Error("Duplicate job id");
      ids.add(job.id);
      for (const key of ["name", "owner", "nextStep", "scoreLabel"]) text(job[key], key);
      if (!phases.includes(phaseName(job.phase)) || !states.includes(job.status)) throw new Error("Unknown phase or status");
      if (job.status === "Auto-cleared" && phaseName(job.phase) !== "Application handoff") throw new Error("Auto-cleared is an Application handoff status");
      if (typeof job.published !== "boolean" || typeof job.waitingOnUser !== "boolean") throw new Error("Job flags must be booleans");
      if (job.waitingOnUser !== (job.status === "Waiting on you")) throw new Error("Waiting-on-user status mismatch");
      if (job.score !== null && (typeof job.score !== "number" || !Number.isFinite(job.score) || job.score < 0 || job.score > 100)) throw new Error("Invalid score");
      if (!job.artifact || typeof job.artifact.label !== "string") throw new Error("Artifact label is required");
      if (job.handoff !== undefined) {
        if (!job.handoff || typeof job.handoff !== "object" || Array.isArray(job.handoff)) throw new Error("Handoff must be an object");
        for (const [key, values] of Object.entries(handoffValues)) {
          if (job.handoff[key] !== undefined && !values.includes(job.handoff[key])) throw new Error(`Unknown handoff ${key}`);
        }
        if (job.handoff.artifactSha256 !== undefined && !/^[a-f0-9]{64}$/i.test(text(job.handoff.artifactSha256, "Handoff PDF hash"))) {
          throw new Error("Invalid handoff PDF hash");
        }
      }
    }
  }
  function filePath(value) {
    if (typeof value !== "string" || !value || /^[\\/]|^[a-z]:/i.test(value)) throw new Error("File references must be relative");
    const parts = value.replaceAll("\\", "/").split("/");
    if (parts.some(part => !part || part === "." || part === "..")) throw new Error("Unsafe local file reference");
    return parts.join("/");
  }
  function clearView() {
    if (dialog.open) dialog.close();
    document.getElementById("artifact-frame").removeAttribute("src");
    document.getElementById("download-artifact").removeAttribute("href");
    document.getElementById("artifact-title").textContent = "Resume artifact";
    document.getElementById("artifact-notice").textContent = "";
    root.replaceChildren();
    for (const url of blobUrls) URL.revokeObjectURL(url);
    blobUrls = [];
    clear.disabled = true;
  }
  function disconnect() {
    liveHandle = null;
    lastSignature = "";
    if (liveTimer !== null) clearInterval(liveTimer);
    liveTimer = null;
    refresh.disabled = true;
  }
  clear.addEventListener("click", () => {
    generation++;
    disconnect();
    clearView();
    picker.value = "";
    error.hidden = true;
    status.textContent = "Private data cleared from this page. No browser storage was used.";
  });
  document.getElementById("close-artifact").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => document.getElementById("artifact-frame").removeAttribute("src"));

  function captureView() {
    const table = document.getElementById("opportunity-grid");
    if (!table) return {view: initialView};
    const sort = table.querySelector('th[aria-sort="ascending"],th[aria-sort="descending"]');
    return {
      view: document.querySelector('[data-view][aria-pressed="true"]')?.dataset.view || initialView,
      search: document.getElementById("grid-search").value,
      phase: document.getElementById("grid-phase").value,
      owner: document.getElementById("grid-owner").value,
      state: document.getElementById("grid-state").value,
      sort: sort?.dataset.sort, direction: sort?.getAttribute("aria-sort"),
      scroll: document.querySelector(".grid-scroll").scrollLeft,
    };
  }
  function restoreView(saved) {
    document.querySelector(`[data-view="${saved.view}"]`).click();
    for (const key of ["search", "phase", "owner", "state"]) {
      const control = document.getElementById(`grid-${key}`);
      if (saved[key] && (control.tagName !== "SELECT" || [...control.options].some(o => o.value === saved[key]))) control.value = saved[key];
      control.dispatchEvent(new Event(key === "search" ? "input" : "change"));
    }
    if (saved.sort) {
      const header = [...document.querySelectorAll("th[data-sort]")].find(h => h.dataset.sort === saved.sort);
      header.querySelector("button").click();
      if (header.getAttribute("aria-sort") !== saved.direction) header.querySelector("button").click();
    }
    document.querySelector(".grid-scroll").scrollLeft = saved.scroll || 0;
  }
  async function importFiles(files, live = false) {
    const ticket = ++generation;
    const savedView = captureView();
    error.hidden = true;
    status.textContent = "Reading selected files locally...";
    const pendingUrls = [];
    try {
      if (!files.length) throw new Error("No files selected");
      if (files.length > 200 || files.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) throw new Error("Choose only the dashboard folder (maximum 200 files / 100 MB)");
      const candidates = files.filter(file => file.name === "data.json");
      if (candidates.length !== 1) throw new Error("Select a folder containing exactly one data.json");
      const dataFile = candidates[0];
      if (dataFile.size > 5 * 1024 * 1024) throw new Error("data.json exceeds 5 MB");
      const dataPath = dataFile.webkitRelativePath || dataFile.name;
      const prefix = dataPath.slice(0, -dataFile.name.length);
      const fileMap = new Map(files.map(file => [file.webkitRelativePath || file.name, file]));
      const getFile = relative => {
        const file = fileMap.get(prefix + filePath(relative));
        if (!file) throw new Error(`Selected folder is missing referenced file: ${relative}`);
        return file;
      };
      const data = JSON.parse(await dataFile.text());
      validate(data);
      const fragment = document.getElementById("view-template").content.cloneNode(true);
      fragment.querySelector("h1").textContent = data.title;
      fragment.querySelector(".status").textContent = data.summary;
      fragment.querySelector(".grid-summary").textContent = data.attention;
      const body = fragment.querySelector("#opportunity-grid tbody");
      for (const job of data.jobs) {
        const row = node("tr");
        const item = node("td");
        if (job.links.length === 1) item.append(node("a", job.name, {href: safeUrl(job.links[0].url), rel: "noreferrer"}));
        else { item.append(document.createTextNode(job.name), node("br")); addLinks(item, job.links); }
        const artifact = node("td", job.artifact.label);
        let verifiedHash = null;
        if (job.artifact.path) {
          const file = getFile(job.artifact.path);
          if (file.size > 20 * 1024 * 1024) throw new Error("Resume PDF exceeds 20 MB");
          const bytes = await file.arrayBuffer();
          if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Resume artifact is not a PDF");
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
          if (hash !== text(job.artifact.sha256, "PDF hash").toLowerCase()) throw new Error("Resume PDF hash mismatch");
          verifiedHash = hash;
          const notice = text(job.artifact.notice, "PDF notice");
          const url = URL.createObjectURL(new Blob([bytes], {type: "application/pdf"}));
          pendingUrls.push(url);
          const link = node("a", job.artifact.label, {href: url});
          link.addEventListener("click", event => {
            event.preventDefault();
            document.getElementById("artifact-title").textContent = job.artifact.label;
            document.getElementById("artifact-notice").textContent = notice;
            document.getElementById("artifact-frame").src = url;
            document.getElementById("download-artifact").href = url;
            dialog.showModal();
          });
          artifact.replaceChildren(link);
        }
        const phase = phaseName(job.phase);
        const displayed = phase === "Application handoff" ? handoffView(job, verifiedHash) : job;
        Object.assign(row.dataset, {id: job.id, item: job.name, phase, owner: job.owner,
          state: displayed.status, score: job.score === null ? "" : String(job.score),
          published: String(job.published), waiting: String(displayed.waitingOnUser)});
        const state = node("td");
        state.append(node("span", displayed.status, {class: "state"}));
        const nextStep = node("td", displayed.nextStep);
        if (phase === "Application") {
          nextStep.append(node("p", job.phase === "Authorized action"
            ? "Legacy action record: application scope is not established by this phase label. The private coordinator must reconcile it."
            : "Execution status is reported by the private per-role session, not authorized or started by this page.", {class: "muted"}));
        }
        row.append(item, node("td", phase), node("td", job.owner), state, node("td", job.scoreLabel), nextStep);
        const evidence = node("td");
        addLinks(evidence, job.evidence);
        row.append(artifact, evidence);
        body.append(row);
      }
      const rows = [...body.rows];
      fragment.querySelector(".grid-summary").textContent = `${rows.length} jobs: ${rows.filter(row => row.dataset.waiting === "true").length} waiting on you, ${rows.filter(row => row.dataset.state === "In review").length} in review, ${rows.filter(row => row.dataset.state === "Blocked").length} blocked.`;
      const blockers = fragment.querySelector("#process-blockers");
      if (!data.blockers.length) blockers.append(node("p", "No process blockers recorded."));
      for (const [index, blocker] of data.blockers.entries()) {
        const article = node("article", "", {class: "process-item"});
        const header = node("header");
        header.append(node("h3", text(blocker.title, "Blocker title")), node("span", `${phaseName(text(blocker.phase, "Phase"))} · ${text(blocker.owner, "Owner")}`));
        article.append(header, node("p", `Blocked: ${text(blocker.problem, "Problem")}`), node("p", `Clears when: ${text(blocker.clearsWhen, "Clearance")}`));
        const details = node("details", "", {class: "repair-request"});
        const id = `repair-${index}`;
        const textarea = node("textarea", text(blocker.request, "Repair request"), {id, rows: "6"});
        const actions = node("div", "", {class: "repair-actions"});
        actions.append(node("button", "Copy request", {type: "button", "data-copy-request": id}),
          node("a", "Open owner session", {href: safeUrl(blocker.ownerUrl), rel: "noreferrer"}));
        details.append(node("summary", "Prepare repair request"),
          node("p", "Copy, open the owner session, then paste and send. This page does not launch work."),
          node("label", "Editable request", {for: id}), textarea, actions,
          node("p", "Draft only. Nothing sent.", {class: "repair-feedback", role: "status", "aria-live": "polite"}));
        const evidence = node("p", "", {class: "muted"});
        addLinks(evidence, blocker.evidence);
        article.append(details, evidence);
        blockers.append(article);
      }
      const journal = fragment.querySelector("#journal");
      if (data.journal) {
        const file = getFile(data.journal);
        if (file.size > 5 * 1024 * 1024) throw new Error("Journal exceeds 5 MB");
        const entries = (await file.text()).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
        for (const entry of entries.reverse()) {
          const details = node("details");
          const refs = node("p");
          addLinks(refs, entry.links || []);
          details.append(node("summary", text(entry.summary, "Journal summary")), node("p", text(entry.detail, "Journal detail")), refs);
          journal.append(details);
        }
      } else journal.append(node("p", "No journal supplied."));
      if (ticket !== generation) {
        for (const url of pendingUrls) URL.revokeObjectURL(url);
        return false;
      }
      clearView();
      root.replaceChildren(fragment);
      blobUrls = pendingUrls;
      window.initializeOpportunityDashboard();
      restoreView(savedView);
      clear.disabled = false;
      status.textContent = live
        ? `Live folder connected. ${data.jobs.length} jobs; checked ${new Date().toLocaleTimeString()}. Refreshes every ${refreshSeconds}s while visible.`
        : `Loaded ${data.jobs.length} jobs locally. Snapshot only; reselect to refresh.`;
      picker.value = "";
      return true;
    } catch (failure) {
      for (const url of pendingUrls) URL.revokeObjectURL(url);
      if (ticket !== generation) return false;
      error.hidden = false;
      error.textContent = `Could not load folder: ${failure.message}. Fix the selected data or choose the correct dashboard folder.`;
      status.textContent = root.childElementCount ? "Refresh failed. Showing the last valid snapshot, which may be stale." : "No private data is loaded.";
      picker.value = "";
      return false;
    }
  }
  async function readDirectory(handle) {
    const files = [];
    let total = 0;
    async function visit(directory, prefix, depth) {
      if (depth > 8) throw new Error("Dashboard folder nesting exceeds 8 levels");
      for await (const [name, entry] of directory.entries()) {
        if (entry.kind === "directory") await visit(entry, prefix + name + "/", depth + 1);
        else {
          const file = await entry.getFile();
          total += file.size;
          if (files.length >= 200 || total > 100 * 1024 * 1024) throw new Error("Dashboard folder exceeds 200 files / 100 MB");
          Object.defineProperty(file, "webkitRelativePath", {value: prefix + name});
          files.push(file);
        }
      }
    }
    await visit(handle, "", 0);
    return files;
  }
  async function signature(files) {
    const parts = [];
    for (const file of [...files].sort((a, b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath))) {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      parts.push(file.webkitRelativePath + ":" + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, "0")).join(""));
    }
    return parts.join("|");
  }
  async function refreshLive() {
    if (!liveHandle || liveBusy || document.hidden || dialog.open) return;
    liveBusy = true;
    refresh.disabled = true;
    const handle = liveHandle;
    const ticket = generation;
    try {
      if (await handle.queryPermission({mode: "read"}) !== "granted") {
        disconnect();
        throw new Error("Folder permission is no longer granted. Connect the folder again");
      }
      const files = await readDirectory(handle);
      const current = await signature(files);
      if (handle !== liveHandle || ticket !== generation) return;
      if (current !== lastSignature) {
        if (await importFiles(files, true)) lastSignature = current;
      } else {
        error.hidden = true;
        status.textContent = `Live folder connected. Checked ${new Date().toLocaleTimeString()}; no file changes. Refreshes every ${refreshSeconds}s while visible.`;
      }
    } catch (failure) {
      if (handle !== liveHandle && liveHandle !== null) return;
      error.hidden = false;
      error.textContent = `Live refresh ${liveHandle ? "failed" : "paused"}: ${failure.message}.`;
      status.textContent = root.childElementCount ? "Showing the last valid snapshot; live data may be stale." : "No private data loaded.";
    } finally {
      liveBusy = false;
      refresh.disabled = !liveHandle;
    }
  }
  connect.addEventListener("click", async () => {
    try {
      const handle = await window.showDirectoryPicker({mode: "read"});
      generation++;
      disconnect();
      liveHandle = handle;
      error.hidden = true;
      clear.disabled = false;
      await refreshLive();
      if (liveHandle) liveTimer = setInterval(refreshLive, refreshSeconds * 1000);
    } catch (failure) {
      if (failure.name === "AbortError") return;
      error.hidden = false;
      error.textContent = `Could not connect folder: ${failure.message}. Use mode=snapshot in the URL if live folder access is unsupported.`;
    }
  });
  refresh.addEventListener("click", refreshLive);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshLive(); });
  picker.addEventListener("change", () => {
    disconnect();
    importFiles([...picker.files]);
  });
  if (!["live", "snapshot"].includes(mode) || !Number.isInteger(refreshSeconds) || refreshSeconds < 15 || refreshSeconds > 3600 || !validViews.includes(initialView)) {
    picker.disabled = true;
    error.hidden = false;
    error.textContent = "Invalid URL preferences. Use mode=live or snapshot, refresh=15..3600 seconds, and view=attention, mine, blocked, all or published.";
  } else if (mode === "live" && liveSupported) {
    connect.hidden = refresh.hidden = false;
    picker.hidden = document.getElementById("snapshot-label").hidden = true;
    modeHelp.textContent = `Live mode preset by URL: refresh every ${refreshSeconds}s, initial view ${initialView}. Connect once to grant read access. Reloading this page requires reconnecting; no handle is stored.`;
    status.textContent = "Connect your private dashboard folder to load and refresh local data.";
  } else {
    modeHelp.textContent = mode === "live"
      ? "This browser does not support live folder access. Snapshot mode is available below; reselect the folder to refresh."
      : `Snapshot mode preset by URL, initial view ${initialView}. Reselect the folder when files change.`;
  }
})();
