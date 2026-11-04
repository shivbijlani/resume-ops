"use strict";
(() => {
  const picker = document.getElementById("local-folder");
  const root = document.getElementById("local-root");
  const status = document.getElementById("load-status");
  const error = document.getElementById("load-error");
  const clear = document.getElementById("clear-data");
  const dialog = document.getElementById("artifact-dialog");
  let generation = 0;
  let blobUrls = [];
  const phases = ["Discovery", "Qualification", "Publication", "Resume build", "Resume review", "Human review", "Authorized action"];
  const states = ["Blocked", "Not built", "Rejected", "Parked", "Research", "Awaiting scoring", "Ready", "Approved", "Waiting on you", "Complete"];
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
      if (!phases.includes(job.phase) || !states.includes(job.status)) throw new Error("Unknown phase or status");
      if (typeof job.published !== "boolean" || typeof job.waitingOnUser !== "boolean") throw new Error("Job flags must be booleans");
      if (job.waitingOnUser !== (job.status === "Waiting on you")) throw new Error("Waiting-on-user status mismatch");
      if (job.score !== null && (typeof job.score !== "number" || !Number.isFinite(job.score) || job.score < 0 || job.score > 100)) throw new Error("Invalid score");
      if (!job.artifact || typeof job.artifact.label !== "string") throw new Error("Artifact label is required");
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
  clear.addEventListener("click", () => {
    generation++;
    clearView();
    picker.value = "";
    error.hidden = true;
    status.textContent = "Private data cleared from this page. No browser storage was used.";
  });
  document.getElementById("close-artifact").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => document.getElementById("artifact-frame").removeAttribute("src"));

  async function importFiles(files) {
    const ticket = ++generation;
    clearView();
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
        Object.assign(row.dataset, {id: job.id, item: job.name, phase: job.phase, owner: job.owner,
          state: job.status, score: job.score === null ? "" : String(job.score),
          published: String(job.published), waiting: String(job.waitingOnUser)});
        const item = node("td");
        if (job.links.length === 1) item.append(node("a", job.name, {href: safeUrl(job.links[0].url), rel: "noreferrer"}));
        else { item.append(document.createTextNode(job.name), node("br")); addLinks(item, job.links); }
        const state = node("td");
        state.append(node("span", job.status, {class: "state"}));
        row.append(item, node("td", job.phase), node("td", job.owner), state, node("td", job.scoreLabel), node("td", job.nextStep));
        const artifact = node("td", job.artifact.label);
        if (job.artifact.path) {
          const file = getFile(job.artifact.path);
          if (file.size > 20 * 1024 * 1024) throw new Error("Resume PDF exceeds 20 MB");
          const bytes = await file.arrayBuffer();
          if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Resume artifact is not a PDF");
          const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
          if (hash !== text(job.artifact.sha256, "PDF hash").toLowerCase()) throw new Error("Resume PDF hash mismatch");
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
        const evidence = node("td");
        addLinks(evidence, job.evidence);
        row.append(artifact, evidence);
        body.append(row);
      }
      const blockers = fragment.querySelector("#process-blockers");
      if (!data.blockers.length) blockers.append(node("p", "No process blockers recorded."));
      for (const [index, blocker] of data.blockers.entries()) {
        const article = node("article", "", {class: "process-item"});
        const header = node("header");
        header.append(node("h3", text(blocker.title, "Blocker title")), node("span", `${text(blocker.phase, "Phase")} · ${text(blocker.owner, "Owner")}`));
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
        return;
      }
      root.replaceChildren(fragment);
      blobUrls = pendingUrls;
      window.initializeOpportunityDashboard();
      clear.disabled = false;
      status.textContent = `Loaded ${data.jobs.length} jobs locally. No upload or browser storage. Clear the page when finished.`;
      picker.value = "";
    } catch (failure) {
      for (const url of pendingUrls) URL.revokeObjectURL(url);
      if (ticket !== generation) return;
      clearView();
      error.hidden = false;
      error.textContent = `Could not load folder: ${failure.message}. Fix the selected data or choose the correct dashboard folder.`;
      status.textContent = "No private data is loaded.";
      picker.value = "";
    }
  }
  picker.addEventListener("change", () => importFiles([...picker.files]));
})();
