window.mountOperationsCase = async function ({
  c,
  user,
  api,
  run,
  detail,
  escape,
}) {
  const [op, events, preferences] = await Promise.all([
      api("/cases/" + c.id + "/operations"),
      api("/cases/" + c.id + "/continuity/events"),
      api("/cases/" + c.id + "/reminders"),
    ]),
    host = document.querySelector("#detail .columns > div:last-child"),
    card = document.createElement("section");
  card.className = "card";
  card.setAttribute("aria-label", "Case review workflow");
  card.innerHTML =
    "<h2>Case review workflow</h2><p><strong>" +
    escape(op.stage.replaceAll("_", " ")) +
    "</strong></p><p>" +
    escape(op.nextAction) +
    "</p><details><summary>Evidence and workflow status</summary><dl>" +
    Object.entries(op.dimensions)
      .map(
        ([key, value]) =>
          "<dt>" + escape(key) + "</dt><dd>" + escape(value) + "</dd>",
      )
      .join("") +
    "</dl><p>Evidence changes needing review: " +
    (op.needsReview ? "Yes" : "No") +
    "</p></details><details><summary>Submission readiness: " +
    escape(op.readiness.outcome.replaceAll("_", " ")) +
    "</summary><ul>" +
    [...op.readiness.blockers, ...op.readiness.warnings]
      .map((f) => "<li>" + escape(f.message || f.code) + "</li>")
      .join("") +
    "</ul></details>";
  host.prepend(card);
  const institution = window.institutionRole(user),
    reviewer = ["officer", "supervisor"].includes(user.role);
  const continuity = document.createElement("details");
  continuity.innerHTML =
    '<summary>Instrument continuity and replacement</summary><p>Scenario analysis of declared dates and individual amounts. No pooling, bank confirmation, legal coverage or release is implied.</p><form><label>Scenario starts<input name="starts" type="date" required></label><label>Scenario ends<input name="ends" type="date" required></label><button>Analyze declared continuity</button></form><div class="continuity-result" aria-live="polite"></div>';
  card.append(continuity);
  const coverageForm = continuity.querySelector("form");
  coverageForm.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const result = await api(
        "/cases/" +
          c.id +
          "/continuity?" +
          new URLSearchParams(new FormData(coverageForm)),
      );
      continuity.querySelector(".continuity-result").innerHTML =
        "<p>Bank: " +
        escape(result.bankConfirmation) +
        "; legal coverage: " +
        escape(result.legalCoverage) +
        "</p><ul>" +
        result.segments
          .map(
            (s) =>
              "<li>" +
              escape(
                s.starts +
                  " to " +
                  s.ends +
                  ": " +
                  s.status +
                  " (maximum single amount in paise: " +
                  s.maximumSingleAmountPaise +
                  ")",
              ) +
              "</li>",
          )
          .join("") +
        result.issues
          .map(
            (i) =>
              "<li>" + escape(i.code + ": " + (i.id || i.identity)) + "</li>",
          )
          .join("") +
        "</ul>";
    });
  };
  if (institution && c.domain?.instruments?.length > 1) {
    const proposal = document.createElement("form");
    const choices = c.domain.instruments
      .map(
        (i) =>
          '<option value="' +
          escape(i.id) +
          '">' +
          escape(i.data.reference + " (" + i.id + ")") +
          "</option>",
      )
      .join("");
    proposal.innerHTML =
      '<label>Predecessor instrument<select name="predecessor">' +
      choices +
      '</select></label><label>Successor instrument<select name="successor">' +
      choices +
      '</select></label><label>Replacement explanation<input name="reason" required maxlength="2000"></label><button>Propose replacement</button>';
    proposal.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await api("/cases/" + c.id + "/continuity/proposals", "POST", {
          ...Object.fromEntries(new FormData(proposal)),
          inputRevision: op.input_revision,
        });
        await detail(c.id);
      });
    };
    continuity.append(proposal);
  }
  const history = document.createElement("div");
  history.innerHTML =
    "<p>Replacement event history (first 50):</p><ul>" +
    events.items
      .map(
        (v) =>
          "<li>" +
          escape(v.created + ": " + v.kind + " — " + v.reason) +
          "</li>",
      )
      .join("") +
    "</ul>";
  continuity.append(history);
  if (events.next) {
    const more = document.createElement("button");
    more.textContent = "Load more replacement history";
    let next = events.next;
    more.onclick = () =>
      run(async () => {
        const page = await api(
          "/cases/" + c.id + "/continuity/events?after=" + next,
        );
        history
          .querySelector("ul")
          .insertAdjacentHTML(
            "beforeend",
            page.items
              .map(
                (v) =>
                  "<li>" +
                  escape(v.created + ": " + v.kind + " — " + v.reason) +
                  "</li>",
              )
              .join(""),
          );
        next = page.next;
        more.hidden = !next;
      });
    continuity.append(more);
  }
  const pending = events.pending;
  const reminderForm = document.createElement("form");
  reminderForm.innerHTML =
    '<label>Reminder day windows<input name="windows" value="' +
    escape(preferences.windows.join(",")) +
    '" required></label><label><input name="enabled" type="checkbox" ' +
    (preferences.enabled ? "checked" : "") +
    ">Enable my in-app maturity and clarification reminders</label><button>Save my reminders</button><p>Uses Asia/Kolkata civil dates; no email or bank action is sent.</p>";
  reminderForm.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/cases/" + c.id + "/reminders", "POST", {
        revision: preferences.revision,
        enabled: reminderForm.elements.enabled.checked,
        windows: reminderForm.elements.windows.value
          .split(",")
          .map((v) => (v.trim() ? Number(v) : NaN)),
      });
      await detail(c.id);
    });
  };
  continuity.append(reminderForm);
  for (const p of pending) {
    if (!institution && !reviewer) continue;
    const decision = document.createElement("form");
    decision.innerHTML =
      "<p>Proposal " +
      escape(p.id) +
      '</p><label>Relationship decision<select name="decision" aria-label="Relationship decision">' +
      (reviewer
        ? '<option value="registered">Record internal relationship</option><option value="rejected">Reject proposal</option>'
        : '<option value="withdrawn">Withdraw proposal</option>') +
      '</select></label><label>Relationship decision explanation<input name="reason" required maxlength="2000"></label><button>Record relationship decision</button><p>Recording a relationship does not release either deposit or approve legal sufficiency.</p>';
    decision.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await api("/cases/" + c.id + "/continuity/proposals/" + p.id, "POST", {
          ...Object.fromEntries(new FormData(decision)),
          inputRevision: op.input_revision,
        });
        await detail(c.id);
      });
    };
    continuity.append(decision);
  }
  const options = institution
    ? op.stage === "draft"
      ? ["submit"]
      : op.stage === "awaiting_response"
        ? ["response"]
        : []
    : {
        submitted: ["intake"],
        intake_validation: ["ready"],
        ready_for_review: ["review"],
        under_review: ["clarify", "reevaluate"],
        response_received: ["reevaluate", "ready"],
        reevaluation_required: ["ready"],
      }[op.stage] || [];
  if ((institution || reviewer) && options.length) {
    const form = document.createElement("form");
    form.innerHTML =
      '<label>Next case step<select name="action">' +
      options.map((a) => "<option>" + a + "</option>").join("") +
      '</select></label><label>Case step explanation<input name="reason" required maxlength="2000"></label><button>Record case step</button>';
    form.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const result = await api("/cases/" + c.id + "/operations", "POST", {
          ...Object.fromEntries(new FormData(form)),
          revision: op.revision,
          inputRevision: op.input_revision,
        });
        await detail(c.id);
        if (result.acknowledgement)
          document.querySelector("#notice").textContent =
            "Submission acknowledged: " + result.acknowledgement.caseId;
      });
    };
    card.append(form);
  }
  if (op.resolution) {
    const summary = document.createElement("details");
    summary.innerHTML =
      "<summary>What changed in the latest evaluation</summary><p>" +
      escape(op.resolution.recommendedAction) +
      "</p>" +
      ["resolved", "introduced", "outstanding"]
        .map(
          (k) =>
            "<p><strong>" +
            k +
            ":</strong> " +
            escape(op.resolution.changes[k].join(", ") || "None") +
            "</p>",
        )
        .join("") +
      "<ul>" +
      op.resolution.changedFacts
        .map(
          (f) =>
            "<li>" +
            escape(f.source + "." + f.field) +
            ": " +
            escape(JSON.stringify(f.before)) +
            " → " +
            escape(JSON.stringify(f.after)) +
            "</li>",
        )
        .join("") +
      "</ul><p>Independent confirmation still required: " +
      escape(
        op.resolution.independentVerificationRequired.join(", ") ||
          "See evidence classification",
      ) +
      "</p>";
    card.append(summary);
  }
  if (reviewer) {
    const templates = await api("/cases/" + c.id + "/clarification-templates"),
      panel = document.createElement("details");
    panel.innerHTML =
      '<summary>Request a targeted clarification</summary><form><label>Disputed finding<select name="findingCode">' +
      templates
        .map(
          (t) =>
            '<option value="' +
            escape(t.findingCode) +
            '">' +
            escape(t.findingCode.replaceAll("_", " ")) +
            "</option>",
        )
        .join("") +
      '</select></label><label>Editable request<textarea name="text" required maxlength="4000"></textarea></label><label>Explicit response deadline (optional)<input name="deadline" type="date"></label><button>Send targeted request</button></form>';
    const form = panel.querySelector("form"),
      select = form.elements.findingCode;
    const choose = () =>
      (form.elements.text.value =
        templates.find((t) => t.findingCode === select.value)?.text || "");
    choose();
    select.onchange = choose;
    form.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const t = templates.find((t) => t.findingCode === select.value);
        if (!t) throw Error("Choose an active finding");
        await api("/cases/" + c.id + "/clarifications", "POST", {
          ...Object.fromEntries(new FormData(form)),
          fields: t.fields,
          documents: t.documents,
        });
        await detail(c.id);
      });
    };
    card.append(panel);
  }
  for (const q of op.clarifications) {
    const panel = document.createElement("details");
    panel.innerHTML =
      "<summary>" +
      escape((q.finding_code || "Clarification") + " · " + q.status) +
      "</summary><p>Requested fields: " +
      escape(q.fields.join(", ") || "Supporting explanation") +
      "</p><p>Deadline: " +
      escape(q.deadline || "Not set") +
      "</p>";
    card.append(panel);
    if (institution && ["open", "reopened"].includes(q.status)) {
      if (q.fields.length) {
        const form = document.createElement("form");
        form.innerHTML =
          q.fields
            .map(
              (k) =>
                "<label>" +
                escape("Correct " + k) +
                '<input name="' +
                escape(k) +
                '" value="' +
                escape(c.instrument[k] ?? "") +
                '" ' +
                (k === "amountPaise" ? 'type="number" min="1" step="1"' : "") +
                "></label>",
            )
            .join("") +
          '<label>Correction explanation<input name="reason" required></label><button>Save disputed fields only</button>';
        form.onsubmit = (e) => {
          e.preventDefault();
          run(async () => {
            const data = Object.fromEntries(new FormData(form)),
              reason = data.reason;
            delete data.reason;
            if (data.amountPaise !== undefined)
              data.amountPaise = Number(data.amountPaise);
            await api("/cases/" + c.id + "/disputed-fields", "POST", {
              requestId: q.id,
              values: data,
              reason,
              revision: c.revision,
            });
            await detail(c.id);
          });
        };
        panel.append(form);
      }
      const response = document.createElement("form");
      response.innerHTML =
        '<label>Targeted response<textarea name="text" required maxlength="4000"></textarea></label><button>Submit clarification response</button>';
      response.onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          await api("/cases/" + c.id + "/responses", "POST", {
            requestId: q.id,
            revision: q.revision,
            text: response.elements.text.value,
          });
          await detail(c.id);
        });
      };
      panel.append(response);
    }
    if (reviewer && ["responded", "closed"].includes(q.status)) {
      const form = document.createElement("form");
      form.innerHTML =
        '<label>Clarification review<select name="decision" aria-label="Relationship decision">' +
        (q.status === "responded"
          ? '<option value="close">Close after review</option>'
          : "") +
        '<option value="reopen">Reopen for response</option></select></label><label>Review explanation<input name="reason" required></label><button>Record clarification review</button>';
      form.onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          await api(
            "/cases/" + c.id + "/clarifications/" + q.id + "/review",
            "POST",
            { ...Object.fromEntries(new FormData(form)), revision: q.revision },
          );
          await detail(c.id);
        });
      };
      panel.append(form);
    }
  }
};
window.mountOperationsNavigation = function ({
  user,
  api,
  run,
  views,
  detail,
  escape,
}) {
  let button = document.querySelector("#operations-nav");
  if (!button) {
    button = document.createElement("button");
    button.id = "operations-nav";
    button.className = "nav";
    document.querySelector("aside").append(button);
  }
  button.textContent = "Actions and work queue";
  button.onclick = () =>
    run(async () => {
      views("management");
      const host = document.querySelector("#management");
      host.innerHTML =
        '<h1>Actions and work queue</h1><label>Queue filter<select id="operation-queue">' +
        [
          ["assigned", "My accessible cases"],
          ["submitted", "Newly submitted"],
          ["review", "Awaiting review"],
          ["responses", "Institution responses"],
          ["overdue", "Explicit deadline overdue"],
          ["maturity", "Declared maturity within 90 days"],
          ["high", "Unresolved high severity"],
        ]
          .map(([v, l]) => '<option value="' + v + '">' + l + "</option>")
          .join("") +
        '</select></label><div id="operation-rows"></div><button id="operation-next">Next queue page</button><h2>Notifications</h2><div id="operation-notifications"></div>';
      let cursor = null;
      const load = async () => {
        const page = await api(
            "/work-queue?queue=" +
              host.querySelector("select").value +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          ),
          rows = host.querySelector("#operation-rows");
        rows.replaceChildren();
        for (const c of page.items) {
          const p = document.createElement("p");
          p.textContent = c.name + " · " + c.reference + " · " + c.stage;
          const open = document.createElement("button");
          open.textContent = "Review case";
          open.onclick = () => run(() => detail(c.id));
          p.append(open);
          rows.append(p);
        }
        cursor = page.nextCursor;
        host.querySelector("#operation-next").hidden = !cursor;
      };
      host.querySelector("select").onchange = () =>
        run(async () => {
          cursor = null;
          await load();
        });
      host.querySelector("#operation-next").onclick = () => run(load);
      await load();
      const notes = await api("/notifications");
      for (const n of notes.items) {
        const p = document.createElement("p");
        p.textContent = n.message + " · " + n.created;
        const open = document.createElement("button");
        open.textContent = "Open related case";
        open.onclick = () => run(() => detail(n.case_id));
        p.append(open);
        if (!n.read_at && user.role !== "audit_reviewer") {
          const read = document.createElement("button");
          read.textContent = "Mark read";
          read.onclick = () =>
            run(async () => {
              await api("/notifications/" + n.id + "/read", "POST", {});
              read.disabled = true;
              read.textContent = "Read";
            });
          p.append(read);
        }
        host.querySelector("#operation-notifications").append(p);
      }
    });
};
