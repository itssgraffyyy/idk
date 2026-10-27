(() => {
  let active = null;
  document.addEventListener(
    "click",
    () => {
      if (active) active.clicks++;
    },
    true,
  );
  document.addEventListener(
    "invalid",
    (e) => {
      if (active) {
        active.errors++;
        active.invalid.add(e.target);
      }
    },
    true,
  );
  document.addEventListener(
    "toggle",
    (e) => {
      if (active && e.target.tagName === "DETAILS" && e.target.open)
        active.help++;
    },
    true,
  );
  window.measureWorkflowError = () => {
    if (active) active.errors++;
  };
  window.discardWorkflowMeasurement = () => {
    active = null;
    document.querySelector("#measurement-controls")?.remove();
    document.querySelector("#attention-overview")?.replaceChildren();
  };
  document.addEventListener(
    "change",
    (e) => {
      if (
        !active ||
        !["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)
      )
        return;
      if (!active.fields.has(e.target)) {
        active.fields.add(e.target);
        active.manualFields++;
      }
      if (active.invalid.has(e.target) && e.target.validity.valid) {
        active.invalid.delete(e.target);
        active.validationCorrections++;
      }
    },
    true,
  );
  const el = (tag, text, parent) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.append(n);
    return n;
  };
  const duration = (value) =>
    value == null
      ? "No completed observations"
      : `${(value / 3600000).toFixed(2)} hours`;
  window.mountOverview = ({ user, api, run, views, detail }) => {
    active = null;
    document.querySelector("#measurement-controls")?.remove();
    const controls = el("details");
    el("summary", "Optional workflow measurement", controls);
    document.querySelector("#notice").after(controls);
    controls.id = "measurement-controls";
    controls.className = "measurement-controls";
    if (user.role !== "audit_reviewer") {
      const label = el("label", "Optional task measurement ", controls),
        select = el("select", undefined, label);
      select.setAttribute("aria-label", "Task to measure");
      for (const task of [
        "submission",
        "review",
        "correction",
        "clearance",
        "evidence",
        "clarification",
      ]) {
        const o = el("option", task, select);
        o.value = task;
      }
      const start = el("button", "Start task measurement", controls),
        finish = el("button", "Finish and save measurement", controls),
        cancel = el("button", "Discard measurement", controls);
      const status = el(
        "span",
        "Off. No document content is collected.",
        controls,
      );
      status.setAttribute("aria-live", "polite");
      finish.hidden = cancel.hidden = true;
      start.onclick = () => {
        active = {
          task: select.value,
          started: performance.now(),
          clicks: 0,
          errors: 0,
          help: 0,
          manualFields: 0,
          validationCorrections: 0,
          fields: new WeakSet(),
          invalid: new WeakSet(),
        };
        start.hidden = true;
        select.disabled = true;
        finish.hidden = cancel.hidden = false;
        status.textContent =
          "Measuring duration and counts in this tab. Finish within two hours.";
      };
      const reset = () => {
        active = null;
        start.hidden = false;
        select.disabled = false;
        finish.hidden = cancel.hidden = true;
      };
      cancel.onclick = () => {
        reset();
        status.textContent = "Discarded; nothing saved.";
      };
      finish.onclick = () =>
        run(async () => {
          if (!active) return;
          const sample = active;
          const body = {
            task: sample.task,
            durationMs: Math.round(performance.now() - sample.started),
            clicks: sample.clicks,
            errors: sample.errors,
            help: sample.help,
            manualFields: sample.manualFields,
            validationCorrections: sample.validationCorrections,
          };
          await api("/workflow-measurements", "POST", body);
          reset();
          status.textContent =
            "Measurement saved. Self-selected timing is not proof of productivity gains.";
        });
    } else controls.remove();
    let nav = document.querySelector("#overview-nav");
    if (!nav) {
      nav = el(
        "button",
        "Overview and analytics",
        document.querySelector("aside"),
      );
      nav.id = "overview-nav";
      nav.className = "nav";
    }
    nav.hidden = false;
    const render = async (parent, full = false, days = 30) => {
      parent.replaceChildren();
      const title = el(
        "h2",
        full ? "Operational analytics" : "Your attention",
        parent,
      );
      title.tabIndex = -1;
      const d = await api("/analytics?days=" + days);
      el(
        "p",
        `${d.cases} accessible cases · ${d.recordedCurrentInstruments} current recorded instruments · ${d.linkedObligations} linked obligations`,
        parent,
      );
      el(
        "p",
        "Recorded information requires evidence review. A maturity event never confirms bank release.",
        parent,
      ).className = "muted";
      const attention = d.attention.filter((c) => c.reasons.length);
      el(
        "p",
        attention.length
          ? `${attention.length} cases have attention signals.`
          : "No attention signals in the current accessible inventory.",
        parent,
      );
      const list = el("ul", undefined, parent);
      for (const c of attention.slice(0, full ? 100 : 5)) {
        const item = el("li", undefined, list),
          open = el("button", c.name, item);
        open.onclick = () => run(() => detail(c.id));
        el(
          "span",
          ` — ${c.reasons.join("; ")}. Stage: ${c.stage.replaceAll("_", " ")}. ${c.ageDays} days since update.`,
          item,
        );
      }
      if (attention.length > (full ? 100 : 5))
        el(
          "p",
          `Showing first ${full ? 100 : 5} prioritized cases. Use work queues for all records.`,
          parent,
        );
      if (!full) {
        const more = el("button", "View operational analytics", parent);
        more.onclick = () => run(() => open());
        return;
      }
      el(
        "p",
        `Inventory as of ${d.asOf}. Event history: ${d.history.since} through ${d.history.through}. ${d.scope}`,
        parent,
      );
      const label = el("label", "History window ", parent),
        select = el("select", undefined, label);
      select.setAttribute("aria-label", "Analytics history window");
      for (const n of [7, 30, 90, 365]) {
        const o = el("option", `${n} days`, select);
        o.value = n;
        o.selected = n === days;
      }
      select.onchange = () =>
        run(() => render(parent, true, Number(select.value)));
      const table = (heading, rows) => {
        const group = el("details", undefined, parent);
        el("summary", `${heading} (${rows.length})`, group);
        group.open = heading === "Current backlog by stage";
        const wrap = el("div", undefined, group);
        wrap.className = "wide";
        const t = el("table", undefined, wrap),
          caption = el("caption", heading, t);
        caption.className = "sr-only";
        const head = el("tr", undefined, el("thead", undefined, t));
        for (const name of ["Metric", "Value"])
          el("th", name, head).scope = "col";
        const body = el("tbody", undefined, t);
        for (const [key, value] of rows) {
          const tr = el("tr", undefined, body);
          el("th", key, tr).scope = "row";
          el("td", String(value), tr);
        }
      };
      table("Current backlog by stage", Object.entries(d.stages));
      table("Latest finding categories", Object.entries(d.bottlenecks));
      table(
        "Historical activity",
        Object.entries(d.historyCounts).filter(
          ([, v]) => typeof v === "number",
        ),
      );
      table(
        "Processing outcomes",
        Object.entries(d.historyCounts.processingJobs),
      );
      table(
        "Findings emitted by evaluation date",
        Object.entries(d.exceptionTrends),
      );
      table(
        "Completed event timings",
        Object.entries(d.timing).map(([key, v]) => [
          key,
          `${duration(v.meanMs)} (${v.samples} observations)`,
        ]),
      );
      if (d.teams)
        table(
          "Current workload by assigned account ID",
          Object.entries(d.teams),
        );
      table(
        "Optional task measurements",
        Object.entries(d.measurements).map(([key, v]) => [
          key,
          `${v.samples} samples; ${duration(v.meanDurationMs)} mean; ${v.clicks} clicks, ${v.manualFields} fields changed, ${v.validationCorrections} validation corrections, ${v.errors} errors, ${v.help} help opens total`,
        ]),
      );
      const definitions = el("details", undefined, parent);
      el("summary", "Metric definitions and limits", definitions);
      for (const [key, text] of Object.entries(d.definitions))
        el("p", `${key}: ${text}`, definitions);
      el(
        "p",
        "Incomplete tasks are excluded from elapsed-time averages. No completed samples means unknown, not zero. Overview rejects more than 500 cases or 10,000 events per history category; it does not silently publish partial statistics.",
        definitions,
      );
      title.focus();
    };
    const open = async () => {
      views("management");
      await render(document.querySelector("#management"), true);
    };
    nav.onclick = () => run(open);
    let preview = document.querySelector("#attention-overview");
    if (!preview) {
      preview = el("div");
      preview.id = "attention-overview";
      preview.className = "card";
      document.querySelector("#registry").before(preview);
    }
    render(preview).catch((error) => {
      preview.replaceChildren();
      el("p", "Overview unavailable: " + error.message, preview);
      const retry = el("button", "Retry overview", preview);
      retry.onclick = () => run(() => render(preview));
    });
  };
})();
