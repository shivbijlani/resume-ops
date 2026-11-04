window.initializeOpportunityDashboard = function () {
(() => {
  const root = document.getElementById("opportunity-grid-panel");
  const table = document.getElementById("opportunity-grid");
  const body = table.tBodies[0];
  const rows = [...body.rows];
  const search = document.getElementById("grid-search");
  const phase = document.getElementById("grid-phase");
  const owner = document.getElementById("grid-owner");
  const state = document.getElementById("grid-state");
  const empty = document.getElementById("grid-empty");
  const phases = ["Discovery", "Qualification", "Publication", "Resume build", "Resume review", "Application handoff", "Application"];
  let view = "attention";
  let sort = "attention";
  let ascending = true;
  const views = {
    attention: row => row.dataset.kind !== "process" && (row.dataset.state === "Blocked" || row.dataset.waiting === "true"),
    mine: row => row.dataset.waiting === "true",
    blocked: row => row.dataset.kind !== "process" && row.dataset.state === "Blocked",
    all: row => row.dataset.kind !== "process",
    process: row => row.dataset.kind === "process",
    published: row => row.dataset.published === "true",
  };
  function populate(select, values) {
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
  }
  function rank(row) {
    return row.dataset.waiting === "true" ? 0 : row.dataset.state === "Blocked" ? 1 : row.dataset.state === "Not built" ? 2 : 3;
  }
  function compare(a, b) {
    let result;
    if (sort === "attention") result = rank(a) - rank(b);
    else if (sort === "score") {
      const av = Number(a.dataset.score), bv = Number(b.dataset.score);
      if (a.dataset.score === "") return b.dataset.score === "" ? 0 : 1;
      if (b.dataset.score === "") return -1;
      result = av - bv;
    } else if (sort === "phase") result = phases.indexOf(a.dataset.phase) - phases.indexOf(b.dataset.phase);
    else result = (a.dataset[sort] || "").localeCompare(b.dataset[sort] || "");
    return (ascending ? result : -result) || a.dataset.item.localeCompare(b.dataset.item);
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const ordered = [...rows].sort(compare);
    let shown = 0;
    for (const row of ordered) {
      const match = views[view](row)
        && (!phase.value || row.dataset.phase === phase.value)
        && (!owner.value || row.dataset.owner === owner.value)
        && (!state.value || row.dataset.state === state.value)
        && (!query || row.textContent.toLocaleLowerCase().includes(query));
      row.hidden = !match;
      if (match) shown++;
      body.append(row);
    }
    const total = rows.filter(views[view]).length;
    document.getElementById("grid-count").textContent = `${shown} of ${total} ${view === "process" ? "process items" : "jobs"}`;
    table.parentElement.hidden = shown === 0;
    empty.hidden = shown !== 0;
    document.getElementById("grid-empty-title").textContent =
      view === "mine" && !query && !phase.value && !owner.value && !state.value
        ? "Nothing is waiting on you."
        : "No items match these filters.";
    document.getElementById("grid-empty-help").textContent =
      view === "mine"
        ? "No current question or approval needs your response. Agent-owned blockers are in Needs attention."
        : "Clear filters or switch views to broaden the results.";
    for (const button of root.querySelectorAll("[data-view]")) {
      button.setAttribute("aria-pressed", String(button.dataset.view === view));
    }
    for (const header of table.querySelectorAll("th[data-sort]")) {
      header.setAttribute("aria-sort", header.dataset.sort === sort ? (ascending ? "ascending" : "descending") : "none");
      header.querySelector(".sort-marker").textContent = header.dataset.sort === sort ? (ascending ? " ↑" : " ↓") : "";
    }
  }
  function reset() {
    search.value = phase.value = owner.value = state.value = "";
    sort = "attention";
    ascending = true;
    render();
  }
  try {
    populate(phase, phases);
    populate(owner, [...new Set(rows.map(r => r.dataset.owner))].sort());
    populate(state, [...new Set(rows.map(r => r.dataset.state))].sort());
    for (const button of root.querySelectorAll("[data-view]")) {
      const count = rows.filter(views[button.dataset.view]).length;
      button.querySelector("span").textContent = count;
      button.addEventListener("click", () => { view = button.dataset.view; reset(); });
    }
    for (const header of table.querySelectorAll("th[data-sort]")) {
      header.querySelector("button").addEventListener("click", () => {
        ascending = sort === header.dataset.sort ? !ascending : header.dataset.sort !== "score";
        sort = header.dataset.sort;
        render();
      });
    }
    search.addEventListener("input", render);
    for (const select of [phase, owner, state]) select.addEventListener("change", render);
    document.getElementById("grid-reset").addEventListener("click", reset);
    document.getElementById("grid-empty-reset").addEventListener("click", () => { view = "all"; reset(); });
    render();
  } catch (error) {
    for (const row of rows) row.hidden = false;
    table.parentElement.hidden = false;
    empty.hidden = true;
    const notice = document.getElementById("grid-error");
    notice.hidden = false;
    notice.textContent = `Table controls could not start: ${error.message}. All saved rows are shown. Reload the page to retry.`;
  }
})();

for (const button of document.querySelectorAll("[data-copy-request]")) {
  const section = button.closest(".repair-request");
  const textarea = document.getElementById(button.dataset.copyRequest);
  const feedback = section.querySelector(".repair-feedback");
  textarea.addEventListener("input", () => {
    feedback.textContent = "Edited draft. Copy again before sending; nothing has been sent.";
  });
  button.addEventListener("click", async () => {
    if (!textarea.value.trim()) {
      feedback.textContent = "The request is empty. Add your instructions before copying.";
      textarea.focus();
      return;
    }
    button.disabled = true;
    feedback.textContent = "Copying request...";
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable on this page");
      await navigator.clipboard.writeText(textarea.value);
      feedback.textContent = "Copied. Open the owner session, paste, and send. No work has started from this button.";
    } catch (error) {
      textarea.focus();
      textarea.select();
      feedback.textContent = `Could not copy automatically: ${error.message}. The text is selected; copy it manually, then paste and send in the owner session.`;
    } finally {
      button.disabled = false;
    }
  });
}

};
