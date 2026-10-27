window.institutionRole = (user) =>
  ["institution", "institution_admin"].includes(user?.role);
window.mountDomainNavigation = function ({
  user,
  api,
  run,
  views,
  registry,
  escape,
}) {
  let button = document.querySelector("#manage-nav");
  if (!button) {
    button = document.createElement("button");
    button.id = "manage-nav";
    button.className = "nav";
    document.querySelector("aside").append(button);
  }
  button.hidden = !window.institutionRole(user) && user.role !== "supervisor";
  button.textContent = window.institutionRole(user)
    ? "Institution records"
    : "Authority accounts";
  button.onclick = () =>
    run(async () => {
      views("management");
      const panel = document.querySelector("#management");
      panel.innerHTML =
        '<h1>Record administration</h1><button id="manage-back">Case registry</button>';
      panel.querySelector("#manage-back").onclick = () => run(registry);
      const paged = (path, initial, host, render) => {
        let cursor = initial.page?.nextCursor;
        const next = document.createElement("button");
        next.textContent = "Next records";
        next.hidden = !cursor;
        host.after(next);
        render(initial);
        next.onclick = () =>
          run(async () => {
            const rows = await api(
              path + "?cursor=" + encodeURIComponent(cursor),
            );
            render(rows);
            cursor = rows.page?.nextCursor;
            next.hidden = !cursor;
          });
      };
      if (window.institutionRole(user)) {
        const profile = await api("/institution"),
          obligations = await api("/obligations");
        panel.insertAdjacentHTML(
          "beforeend",
          '<div class="card"><h2>Institution profile</h2><form id="profile-form"><label>Institution name<input name="name" required value="' +
            escape(profile.name || "") +
            '"></label><label>Classification<input name="classification" required value="' +
            escape(profile.classification || "private") +
            '"></label><label>Programmes (JSON)<textarea name="programmes">' +
            escape(JSON.stringify(profile.programmes || [])) +
            '</textarea></label><label>Approval history (JSON)<textarea name="approvals">' +
            escape(JSON.stringify(profile.approvals || [])) +
            '</textarea></label><button>Save institution profile</button></form></div><div class="card"><h2>Security obligations</h2><div id="obligation-list"></div><form id="obligation-form"><input type="hidden" name="id"><input type="hidden" name="revision"><label>Programme<input name="programme" required></label><label>Qualification level<input name="level" required></label><label>Required amount (paise)<input name="amountPaise" type="number" min="1" step="1" required></label><label>Policy reference<input name="policyVersion" required value="UNVERIFIED_POLICY"></label><label>Period start<input type="date" name="starts" required></label><label>Period end<input type="date" name="ends" required></label><label>Exemption claim<textarea name="exemption"></textarea></label><label>Obligation status<select name="status"><option>registered</option><option>requires_review</option><option>exemption_claimed</option></select></label><button>Save obligation</button></form></div>',
        );
        const profileForm = panel.querySelector("#profile-form");
        function editor(name, labels, values) {
          const fieldset = document.createElement("fieldset"),
            legend = document.createElement("legend");
          legend.textContent =
            name === "programmes" ? "Programmes" : "Approval history";
          fieldset.append(legend);
          const rows = document.createElement("div");
          fieldset.append(rows);
          const addRow = (value = {}) => {
            const row = document.createElement("div");
            row.dataset.entry = "true";
            for (const [key, label] of Object.entries(labels)) {
              const item = document.createElement("label");
              item.textContent = label;
              const input = document.createElement("input");
              input.dataset.key = key;
              input.required = true;
              input.value = value[key] || "";
              if (key === "date") input.type = "date";
              item.append(input);
              row.append(item);
            }
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "Remove entry";
            remove.onclick = () => row.remove();
            row.append(remove);
            rows.append(row);
          };
          values.forEach(addRow);
          const add = document.createElement("button");
          add.type = "button";
          add.textContent =
            name === "programmes" ? "Add programme" : "Add approval";
          add.onclick = () => addRow();
          fieldset.append(add);
          profileForm
            .querySelector("[name=" + name + "]")
            .closest("label")
            .replaceWith(fieldset);
          return () =>
            [...rows.children].map((row) =>
              Object.fromEntries(
                [...row.querySelectorAll("input")].map((input) => [
                  input.dataset.key,
                  input.value,
                ]),
              ),
            );
        }
        const programmes = editor(
            "programmes",
            { programme: "Programme", level: "Programme level" },
            profile.programmes || [],
          ),
          approvals = editor(
            "approvals",
            {
              reference: "Approval reference",
              date: "Approval date",
              status: "Approval status",
            },
            profile.approvals || [],
          );
        profileForm.onsubmit = (e) => {
          e.preventDefault();
          run(async () => {
            const b = Object.fromEntries(new FormData(e.target));
            await api("/institution", "POST", {
              ...b,
              revision: profile.revision,
              programmes: programmes(),
              approvals: approvals(),
            });
            await registry();
          });
        };
        const list = panel.querySelector("#obligation-list"),
          form = panel.querySelector("#obligation-form");
        paged("/obligations", obligations, list, (items) => {
          list.replaceChildren();
          for (const o of items) {
            const entry = document.createElement("p");
            entry.innerHTML =
              escape(
                o.id + " · " + o.programme + " · " + o.amount_paise + " paise",
              ) + ' <button type="button">Edit obligation</button>';
            entry.querySelector("button").onclick = () => {
              for (const [k, v] of Object.entries({
                ...o,
                amountPaise: o.amount_paise,
                policyVersion: o.policy_version,
              })) {
                if (form.elements[k]) form.elements[k].value = v ?? "";
              }
            };
            list.append(entry);
          }
        });
        form.onsubmit = (e) => {
          e.preventDefault();
          run(async () => {
            const b = Object.fromEntries(new FormData(form));
            await api("/obligations" + (b.id ? "/" + b.id : ""), "POST", {
              ...b,
              amountPaise: Number(b.amountPaise),
              revision: Number(b.revision),
            });
            await registry();
          });
        };
      }
      if (["institution_admin", "supervisor"].includes(user.role)) {
        const accounts = await api("/accounts"),
          card = document.createElement("div");
        card.className = "card";
        card.innerHTML =
          '<h2>Account administration</h2><div id="account-list"></div><form id="account-form"><label>New account email<input name="email" type="email" required></label><label>Initial password<input name="password" type="password" minlength="12" required autocomplete="new-password"></label><label>Account role<select name="role">' +
          (user.role === "institution_admin"
            ? ["institution", "institution_admin"]
            : ["officer", "supervisor", "audit_reviewer"]
          )
            .map((r) => "<option>" + r + "</option>")
            .join("") +
          "</select></label><button>Create account</button></form>";
        panel.append(card);
        paged(
          "/accounts",
          accounts,
          card.querySelector("#account-list"),
          (items) => {
            card.querySelector("#account-list").replaceChildren();
            for (const a of items) {
              const row = document.createElement("p");
              row.textContent = a.email + " · " + a.role + " · " + a.status;
              if (a.id !== user.id) {
                const toggle = document.createElement("button");
                toggle.textContent =
                  a.status === "active" ? "Disable account" : "Enable account";
                toggle.onclick = () =>
                  run(async () => {
                    await api("/accounts", "POST", {
                      id: a.id,
                      status: a.status === "active" ? "disabled" : "active",
                      reason: "Account administrator changed availability",
                    });
                    await registry();
                  });
                row.append(toggle);
              }
              card.querySelector("#account-list").append(row);
            }
          },
        );
        card.querySelector("form").onsubmit = (e) => {
          e.preventDefault();
          const b = Object.fromEntries(new FormData(e.target));
          e.target.reset();
          run(async () => {
            await api("/accounts", "POST", b);
            await registry();
          });
        };
      }
    });
};
window.mountDomainCase = function ({
  c,
  user,
  api,
  run,
  detail,
  escape,
  fieldInputs,
  readInstrument,
}) {
  const host = document.querySelector("#detail .columns > div:last-child"),
    card = document.createElement("div");
  card.className = "card";
  for (const kind of ["history", "audit"]) {
    let cursor = c[kind + "Page"]?.nextCursor;
    if (!cursor) continue;
    const panel = document.createElement("div");
    panel.className = "card";
    const heading = document.createElement("h3");
    heading.textContent =
      kind === "history" ? "Earlier evidence history" : "Earlier audit events";
    panel.append(heading);
    const button = document.createElement("button");
    button.textContent = "Load older " + kind;
    panel.append(button);
    button.onclick = () =>
      run(async () => {
        const page = await api(
          "/cases/" +
            c.id +
            "/" +
            kind +
            "?cursor=" +
            encodeURIComponent(cursor),
        );
        for (const event of page.items) {
          const detail = document.createElement("details"),
            summary = document.createElement("summary"),
            pre = document.createElement("pre");
          summary.textContent =
            (event.kind || event.action) + " · " + event.created;
          pre.textContent = JSON.stringify(event.payload || event, null, 2);
          detail.append(summary, pre);
          panel.append(detail);
        }
        cursor = page.nextCursor;
        button.hidden = !cursor;
      });
    host.append(panel);
  }
  card.innerHTML =
    "<h2>Lifecycle and linked records</h2><p>Administrative state: <b>" +
    escape(c.domain.status) +
    '</b></p><p class="source">Obligation ' +
    escape(c.domain.obligation_id) +
    " · primary instrument " +
    escape(c.domain.instrument_id) +
    "</p><p>Bank confirmation remains UNCONFIRMED. No release decision is made here.</p>";
  if (user.role === "audit_reviewer") {
    document.querySelectorAll("#detail form").forEach((f) => (f.hidden = true));
    for (const id of ["evaluate", "external", "ifsc-check"]) {
      const e = document.getElementById(id);
      if (e) e.hidden = true;
    }
    host.append(card);
    return;
  }
  const operational = c.history.filter((e) => e.kind === "evaluation").at(-1)
    ?.payload.operationalPolicy;
  if (operational) {
    const p = document.createElement("p");
    p.textContent =
      "Selected policy: " +
      (operational.classification || "UNVERIFIED") +
      " · " +
      (operational.version || "none") +
      " · " +
      operational.outcome +
      ". Administrative approval: not granted.";
    card.append(p);
  }
  if (["officer", "supervisor"].includes(user.role)) {
    const replay = document.createElement("form");
    replay.innerHTML =
      '<label>Historical evaluation date<input name="asOf" type="date" required></label><label>Replay facts<select name="evaluationId"><option value="">Current facts at selected policy date</option>' +
      c.history
        .filter((e) => e.kind === "evaluation")
        .map(
          (e) =>
            '<option value="' +
            escape(e.id) +
            '">Frozen evaluation ' +
            escape(e.payload.version) +
            "</option>",
        )
        .join("") +
      '</select></label><label>Policy configuration for frozen facts<select name="policyBasis"><option value="recorded">Configuration recorded with that evaluation</option><option value="current">Current trusted configuration — reassessment</option></select></label><p>Current facts use current configuration. Frozen facts can retain their recorded configuration; financial evidence is not reassessed at a fabricated historical date.</p><button>Replay policy evaluation</button>';
    replay.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await api("/cases/" + c.id + "/policy-evaluate", "POST", {
          asOf: replay.elements.asOf.value,
          policyBasis: replay.elements.evaluationId.value
            ? replay.elements.policyBasis.value
            : "current",
          ...(replay.elements.evaluationId.value
            ? { evaluationId: replay.elements.evaluationId.value }
            : {}),
        });
        await detail(c.id);
      });
    };
    card.append(replay);
  }
  const actions = window.institutionRole(user)
    ? ["submit", "resubmit"]
    : ["start_review", "request_information", "resume_review", "record_review"];
  card.insertAdjacentHTML(
    "beforeend",
    '<form id="lifecycle-form"><label>Lifecycle action<select name="action">' +
      actions.map((a) => "<option>" + a + "</option>").join("") +
      '</select></label><label>Transition reason<input name="reason" required></label><button>Record lifecycle transition</button></form>',
  );
  card.querySelector("#lifecycle-form").onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    run(async () => {
      await api("/cases/" + c.id + "/lifecycle", "POST", {
        ...body,
        revision: c.domain.revision,
      });
      await detail(c.id);
    });
  };
  if (window.institutionRole(user)) {
    const list = document.createElement("div");
    list.innerHTML = "<h3>Linked instruments</h3>";
    const renderInstruments = (items) => {
      list.innerHTML = "<h3>Linked instruments</h3>";
      for (const i of items) {
        const row = document.createElement("p");
        row.textContent = i.data.reference + " · " + i.id + " · " + i.status;
        if (i.id !== c.domain.instrument_id) {
          const b = document.createElement("button");
          b.textContent = "Use instrument for this case";
          b.onclick = () =>
            run(async () => {
              await api("/cases/" + c.id + "/instrument-primary", "POST", {
                instrumentId: i.id,
                revision: c.revision,
                reason: "Institution selected linked instrument",
              });
              await detail(c.id);
            });
          row.append(b);
        }
        list.append(row);
      }
    };
    renderInstruments(c.domain.instruments);
    card.append(list);
    if (c.domain.counts?.instruments > 100) {
      let cursor = null;
      const more = document.createElement("button");
      more.textContent = "Browse instrument pages";
      more.onclick = () =>
        run(async () => {
          const page = await api(
            "/cases/" +
              c.id +
              "/domain-records?kind=instruments&limit=100" +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          );
          renderInstruments(page.items);
          cursor = page.nextCursor;
          more.textContent = cursor
            ? "Next instruments"
            : "First instrument page";
        });
      card.append(more);
    }
    const add = document.createElement("form");
    add.innerHTML =
      "<h3>Register another instrument</h3>" +
      fieldInputs({
        ...c.instrument,
        reference: "",
        type: "FDR",
        currency: "INR",
      }) +
      "<button>Add linked instrument</button>";
    add.onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await api("/cases/" + c.id + "/instruments", "POST", {
          instrument: readInstrument(add),
        });
        await detail(c.id);
      });
    };
    card.append(add);
    if (c.domain.instruments.length > 1) {
      const form = document.createElement("form");
      form.innerHTML =
        '<label>Predecessor<select name="predecessor">' +
        c.domain.instruments
          .map(
            (i) =>
              '<option value="' +
              escape(i.id) +
              '">' +
              escape(i.data.reference) +
              "</option>",
          )
          .join("") +
        '</select></label><label>Successor<select name="successor">' +
        c.domain.instruments
          .map(
            (i) =>
              '<option value="' +
              escape(i.id) +
              '">' +
              escape(i.data.reference) +
              "</option>",
          )
          .join("") +
        '</select></label><label>Relationship reason<input name="reason" required></label><button>Record instrument relationship</button>';
      form.onsubmit = (e) => {
        e.preventDefault();
        const b = Object.fromEntries(new FormData(form));
        run(async () => {
          await api("/cases/" + c.id + "/instrument-links", "POST", {
            ...b,
            revision: c.domain.instruments.find((i) => i.id === b.predecessor)
              .revision,
          });
          await detail(c.id);
        });
      };
      card.append(form);
    }
  }
  if (user.role === "supervisor") {
    const form = document.createElement("form");
    form.innerHTML =
      '<label>Assigned officer ID<input name="officerId" required></label><label>Assignment reason<input name="reason" required></label><button>Assign officer</button>';
    form.onsubmit = (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(form));
      run(async () => {
        await api("/cases/" + c.id + "/assignment", "POST", {
          ...b,
          revision: c.revision,
        });
        await detail(c.id);
      });
    };
    card.append(form);
  }
  host.append(card);
};
