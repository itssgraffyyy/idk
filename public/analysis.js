window.mountAnalysis = function ({ c, user, api, run, detail, escape }) {
  const panel = document.createElement("details");
  panel.className = "card";
  panel.setAttribute("aria-label", "Relationships and scenarios");
  panel.innerHTML =
    '<summary>Relationships and scenarios</summary><div class="analysis-content"></div>';
  document.querySelector("#detail .columns > div:last-child").append(panel);
  let loaded = false;
  const node = (tag, text, parent) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    parent.append(n);
    return n;
  };
  const field = (parent, label, value, type = "text") => {
    const l = node("label", label, parent),
      input = node("input", undefined, l);
    input.type = type;
    input.value = value ?? "";
    return input;
  };
  const table = (parent, headers, rows) => {
    const wrapper = node("div", undefined, parent);
    wrapper.className = "table-wrap";
    const t = node("table", undefined, wrapper),
      thead = node("thead", undefined, t),
      head = node("tr", undefined, thead);
    headers.forEach((h) => node("th", h, head));
    const tbody = node("tbody", undefined, t);
    for (const row of rows) {
      const tr = node("tr", undefined, tbody);
      for (const value of row) {
        const td = node("td", undefined, tr);
        if (value instanceof Node) td.append(value);
        else td.textContent = value ?? "Unknown";
      }
    }
    return t;
  };
  panel.ontoggle = () => {
    if (!panel.open || loaded) return;
    run(async () => {
      const host = panel.querySelector(".analysis-content"),
        root = "/cases/" + c.id;
      node(
        "p",
        "Only records you can currently access are linked. Similarities are review signals, not fraud findings or bank confirmation.",
        host,
      );
      const graph = await api(root + "/relationships"),
        byId = new Map(graph.nodes.map((n) => [n.id, n]));
      node("h3", "Review signals", host);
      if (!graph.signals.length)
        node(
          "p",
          "No cross-record signals within the bounded authorized scope.",
          host,
        );
      table(
        host,
        ["Priority", "Signal", "Explanation"],
        graph.signals.map((s) => [s.severity, s.code, s.explanation]),
      );
      const navigate = (n) => {
        if (n.documentId && n.caseId) {
          const a = document.createElement("button");
          a.type = "button";
          a.textContent = n.label + " — inspect protected source";
          a.onclick = () =>
            run(async () => {
              if (n.caseId !== c.id) await detail(n.caseId);
              await window.openEvidenceViewer({
                c: { id: n.caseId },
                api,
                run,
                escape,
                versionId: n.documentId,
                extractionId: n.extractionId || null,
              });
              document.querySelector("#document-preview")?.scrollIntoView();
            });
          return a;
        }
        if (n.type === "case" && n.caseId !== c.id) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = n.label + " — open case";
          b.onclick = () => run(() => detail(n.caseId));
          return b;
        }
        return n.label;
      };
      const related = node("details", undefined, host);
      node("summary", "Linked records and source versions", related);
      table(
        related,
        ["From", "Relationship", "To"],
        graph.links.map((l) => [
          navigate(byId.get(l.from) || { label: l.from }),
          l.relationship,
          navigate(byId.get(l.to) || { label: l.to }),
        ]),
      );
      if (user.role === "institution_admin") {
        const declaration = node("details", undefined, host);
        node("summary", "Declare sponsoring legal entity", declaration);
        node(
          "p",
          "Self-declared registration details only. This does not confirm identity or grant access.",
          declaration,
        );
        const existing = await api(root + "/legal-entity"),
          form = node("form", undefined, declaration),
          inputs = {};
        for (const [key, label] of [
          ["name", "Legal entity name"],
          ["jurisdiction", "Registration jurisdiction"],
          ["registration", "Registration identifier"],
          ["sourceReference", "Declaration source reference"],
        ])
          inputs[key] = field(form, label, existing.payload?.[key]);
        node("button", "Save legal entity declaration", form);
        form.onsubmit = (e) => {
          e.preventDefault();
          run(async () => {
            const body = { revision: existing.revision };
            for (const [key, input] of Object.entries(inputs))
              body[key] = input.value;
            const saved = await api(root + "/legal-entity", "POST", body);
            existing.revision = saved.revision;
            node(
              "p",
              "Saved as an unverified institution declaration.",
              declaration,
            );
          });
        };
      }
      const scenarios = node("details", undefined, host);
      node("summary", "Read-only what-if analysis", scenarios);
      node(
        "p",
        "Freeze a snapshot, change assumptions and compare declared coverage. Analysis cannot modify operational evidence, approvals, clearances or banking.",
        scenarios,
      );
      const resultHost = node("div", undefined, scenarios);
      resultHost.setAttribute("aria-live", "polite");
      const display = (record) => {
        resultHost.replaceChildren();
        const r = record.payload.result;
        node(
          "h4",
          "Hypothetical result — no approval or bank confirmation",
          resultHost,
        );
        node(
          "p",
          "Policy: " +
            r.policy.outcome +
            "; configuration " +
            r.policyConfigurationSHA256,
          resultHost,
        );
        node(
          "p",
          "Frozen baseline policy: " +
            r.baseline.policy.outcome +
            " as of " +
            r.baseline.asOf +
            ". " +
            r.comparisonAssumption,
          resultHost,
        );
        table(
          resultHost,
          [
            "Baseline from",
            "To",
            "Maximum single deposit (paise)",
            "Declared result",
          ],
          r.baseline.continuity.segments.map((s) => [
            s.starts,
            s.ends,
            s.maximumSingleAmountPaise,
            s.status,
          ]),
        );
        table(
          resultHost,
          ["From", "To", "Maximum single deposit (paise)", "Declared result"],
          r.continuity.segments.map((s) => [
            s.starts,
            s.ends,
            s.maximumSingleAmountPaise,
            s.status,
          ]),
        );
        for (const missing of r.missingEvidence)
          node("p", "Missing evidence: " + missing, resultHost);
        for (const blocker of r.clearance.blockers || [])
          node("p", "Clearance blocker: " + blocker.code, resultHost);
        const assumptions = node("details", undefined, resultHost);
        node(
          "summary",
          "Assumptions and unresolved operational blockers",
          assumptions,
        );
        for (const a of r.assumptions) node("p", a, assumptions);
        for (const b of r.recordedAdministrativeBlockers)
          node("p", b.code, assumptions);
        const replay = node("button", "Verify exact replay", resultHost);
        replay.type = "button";
        replay.onclick = () =>
          run(async () => {
            const check = await api(
              root + "/analysis/records/" + record.id + "/replay",
            );
            node(
              "p",
              check.reproduced
                ? "Stored snapshot reproduced exactly."
                : "Replay unavailable.",
              resultHost,
            );
          });
      };
      const history = node("div", undefined, scenarios);
      let cursor = null;
      const more = node("button", "Load saved analyses", history);
      more.type = "button";
      more.onclick = () =>
        run(async () => {
          const page = await api(
            root +
              "/analysis/history?limit=20" +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          );
          for (const item of page.items.filter((r) => r.kind === "scenario")) {
            const open = node(
              "button",
              "Open scenario " + item.created,
              history,
            );
            open.type = "button";
            open.onclick = () =>
              run(async () =>
                display(await api(root + "/analysis/records/" + item.id)),
              );
          }
          cursor = page.nextCursor;
          more.disabled = !cursor;
        });
      if (user.role !== "audit_reviewer") {
        const freeze = node("button", "Freeze analysis snapshot", scenarios);
        freeze.type = "button";
        let editor;
        freeze.onclick = () =>
          run(async () => {
            const ops = await api(root + "/operations"),
              snapshot = await api(root + "/analysis/snapshots", "POST", {
                inputRevision: ops.input_revision,
              }),
              base = snapshot.payload;
            editor?.remove();
            editor = node("form", undefined, scenarios);
            node(
              "p",
              "Frozen case revision " +
                base.caseRevision +
                ", input revision " +
                base.inputRevision +
                ". Later case changes do not rebase this analysis.",
              editor,
            );
            const asOf = field(
                editor,
                "Policy assessment date",
                new Date().toISOString().slice(0, 10),
                "date",
              ),
              starts = field(
                editor,
                "Coverage start",
                base.obligation.starts,
                "date",
              ),
              ends = field(
                editor,
                "Coverage end",
                base.obligation.ends,
                "date",
              ),
              amount = field(
                editor,
                "Obligation amount (integer paise)",
                base.obligation.amount_paise,
                "number",
              );
            amount.step = "1";
            amount.min = "1";
            const policyLabel = node(
                "label",
                "Policy version in frozen configuration",
                editor,
              ),
              policy = node("select", undefined, policyLabel);
            node("option", "Automatic selection by date", policy).value = "";
            for (const p of base.capsule.configuration.policies) {
              const opt = node(
                "option",
                p.version + " (" + p.classification + ")",
                policy,
              );
              opt.value = p.version;
            }
            const edits = [];
            for (const r of base.instruments) {
              const block = node("fieldset", undefined, editor);
              node("legend", r.data.reference, block);
              const remove = field(
                block,
                "Exclude from hypothetical scenario",
                undefined,
                "checkbox",
              );
              remove.checked = false;
              edits.push({
                id: r.id,
                remove,
                amount: field(
                  block,
                  "Deposit amount (paise)",
                  r.data.amountPaise,
                  "number",
                ),
                issued: field(block, "Issue date", r.data.issued, "date"),
                matures: field(block, "Maturity date", r.data.matures, "date"),
              });
            }
            const additions = node("details", undefined, editor);
            node("summary", "Add hypothetical deposit", additions);
            const extra = {},
              enable = field(
                additions,
                "Include new hypothetical deposit",
                undefined,
                "checkbox",
              );
            enable.checked = false;
            for (const [key, label, type] of [
              ["reference", "Deposit reference", "text"],
              ["bank", "Bank name", "text"],
              ["ifsc", "IFSC", "text"],
              ["amountPaise", "New deposit amount (paise)", "number"],
              ["issued", "New issue date", "date"],
              ["matures", "New maturity date", "date"],
              ["depositor", "Depositor", "text"],
              ["institutionName", "Institution name", "text"],
              ["branch", "Branch", "text"],
            ])
              extra[key] = field(additions, label, "", type);
            const clearances = [];
            for (const requirement of base.clearance.procedure?.requirements ||
              []) {
              const label = node(
                  "label",
                  "Assume clearance: " + requirement.label,
                  editor,
                ),
                select = node("select", undefined, label);
              for (const value of [
                "",
                "accepted",
                "pending",
                "rejected",
                "withdrawn",
              ]) {
                const o = node(
                  "option",
                  value || "Keep recorded status",
                  select,
                );
                o.value = value;
              }
              clearances.push({ id: requirement.id, select });
            }
            node("button", "Run hypothetical scenario", editor);
            editor.onsubmit = (e) => {
              e.preventDefault();
              run(async () => {
                const changes = {
                  asOf: asOf.value,
                  starts: starts.value,
                  ends: ends.value,
                  amountPaise: Number(amount.value),
                  remove: edits
                    .filter((e) => e.remove.checked)
                    .map((e) => e.id),
                  updates: edits
                    .filter((e) => !e.remove.checked)
                    .map((e) => ({
                      id: e.id,
                      amountPaise: Number(e.amount.value),
                      issued: e.issued.value,
                      matures: e.matures.value,
                    })),
                  clearances: clearances
                    .filter((e) => e.select.value)
                    .map((e) => ({
                      requirementId: e.id,
                      status: e.select.value,
                    })),
                };
                if (policy.value) changes.policyVersion = policy.value;
                if (enable.checked) {
                  const d = { currency: "INR", type: "FDR" };
                  for (const [k, input] of Object.entries(extra))
                    if (input.value)
                      d[k] =
                        k === "amountPaise" ? Number(input.value) : input.value;
                  changes.add = [d];
                }
                display(
                  await api(root + "/analysis/scenarios", "POST", {
                    snapshotId: snapshot.id,
                    changes,
                  }),
                );
              });
            };
          });
      }
      loaded = true;
    });
  };
};
