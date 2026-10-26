const $ = (s) => document.querySelector(s),
  fields = ["reference", "amountPaise", "bank", "ifsc", "issued", "matures"];
let user, current;
let submissionKey = crypto.randomUUID();
const escape = (s) =>
  String(s ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) => {
  const p = BigInt(n);
  return (
    "₹" +
    new Intl.NumberFormat("en-IN").format(p / 100n) +
    "." +
    (p % 100n).toString().padStart(2, "0")
  );
};
function notice(s = "") {
  $("#notice").textContent = s;
}
async function api(path, method = "GET", body) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(path === "/cases" && method === "POST"
        ? { "Idempotency-Key": submissionKey }
        : {}),
      ...(user ? { "X-CSRF-Token": user.csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error);
  return v;
}
let busy = false;
async function run(fn) {
  if (busy) return;
  busy = true;
  notice("Working…");
  $("main").inert = true;
  $("aside").inert = true;
  $("main").setAttribute("aria-busy", "true");
  try {
    await fn();
  } catch (e) {
    notice(e.message);
  } finally {
    busy = false;
    $("main").inert = false;
    $("aside").inert = false;
    $("main").setAttribute("aria-busy", "false");
    if ($("#notice").textContent === "Working…") notice();
  }
}
function fieldInputs(inst = {}) {
  return (
    '<div class="grid">' +
    fields
      .map(
        (k) =>
          "<label>" +
          escape(k === "amountPaise" ? "Deposit amount (paise)" : k) +
          '<input name="' +
          k +
          '" value="' +
          escape(inst[k] ?? "") +
          '" type="' +
          (k === "amountPaise"
            ? "number"
            : ["issued", "matures"].includes(k)
              ? "date"
              : "text") +
          '" ' +
          (k === "amountPaise" ? 'min="1" step="1"' : 'maxlength="150"') +
          " required></label>",
      )
      .join("") +
    ["type", "currency", "branch", "institutionName", "depositor"]
      .map(
        (k) =>
          "<label>" +
          escape(
            {
              type: "Instrument type",
              currency: "Currency",
              branch: "Branch",
              institutionName: "Institution name on instrument",
              depositor: "Depositor",
            }[k],
          ) +
          '<input name="' +
          k +
          '" maxlength="150" value="' +
          escape(inst[k] || "") +
          '"></label>',
      )
      .join("") +
    "</div>"
  );
}
function instrument(form) {
  const v = Object.fromEntries(new FormData(form));
  return Object.fromEntries(
    [
      ...fields,
      ...["type", "currency", "branch", "institutionName", "depositor"].filter(
        (k) => v[k],
      ),
    ].map((k) => [k, k === "amountPaise" ? Number(v[k]) : v[k]]),
  );
}
function views(name) {
  for (const id of ["login", "workspace", "detail", "management"])
    $("#" + id).hidden = id !== name;
}
async function registry() {
  views("workspace");
  $("#new-case").hidden = !window.institutionRole(user);
  const cases = await api("/cases");
  $("#count").textContent = cases.length;
  $("#total").textContent = money(
    cases.reduce((n, c) => n + BigInt(c.instrument.amountPaise), 0n),
  );
  $("#registry").innerHTML =
    '<div class="title-row"><h2>Submissions</h2><span class="muted">Assigned & accessible to you</span></div>' +
    (cases.length
      ? '<div class="wide"><table><thead><tr><th>Institution / reference</th><th>Deposit</th><th>Maturity</th><th>Review</th><th></th></tr></thead><tbody>' +
        cases
          .map(
            (c) =>
              "<tr><td>" +
              escape(c.name) +
              '<div class="source">' +
              escape(c.instrument.reference) +
              "</div></td><td>" +
              money(c.instrument.amountPaise) +
              "</td><td>" +
              escape(c.instrument.matures) +
              '</td><td><span class="badge">Human review</span></td><td><button data-case="' +
              c.id +
              '">Open →</button></td></tr>',
          )
          .join("") +
        "</tbody></table></div>"
      : '<div class="empty">No submissions yet. Register a security obligation and its deposit to begin.</div>');
  document
    .querySelectorAll("[data-case]")
    .forEach((b) => (b.onclick = () => run(() => detail(b.dataset.case))));
}
async function detail(id) {
  current = await api("/cases/" + id);
  const c = current,
    h = c.history,
    last = (k) => h.filter((e) => e.kind === k).at(-1),
    report = last("evaluation"),
    x = last("extraction"),
    ext = last("external"),
    doc = last("document");
  views("detail");
  $("#detail").innerHTML =
    '<button id="back">← Case registry</button><div class="title-row"><div><p class="eyebrow">CASE / ' +
    escape(id.slice(0, 8)) +
    "</p><h1>" +
    escape(c.name) +
    '</h1><p class="muted">' +
    escape(c.instrument.reference) +
    " · Revision " +
    c.revision +
    '</p></div><span class="badge">Human review required</span></div><div class="columns"><div><div class="card"><div class="title-row"><h2>Evidence comparison</h2><button id="ifsc-check">Check IFSC</button></div><div class="wide"><table><thead><tr><th>Field</th><th>Declared</th><th>Document</th><th>Provider · ' +
    escape(
      ext?.payload.classification ||
        ext?.payload.environment ||
        ext?.payload.status ||
        "unavailable",
    ) +
    "</th></tr></thead><tbody>" +
    fields
      .map(
        (k) =>
          "<tr><td>" +
          escape(k) +
          "</td><td>" +
          escape(c.instrument[k]) +
          "</td><td>" +
          escape(
            x?.payload.documentId === doc?.id
              ? x?.payload.fields[k]?.value
              : undefined,
          ) +
          "</td><td>" +
          escape(ext?.payload.values?.[k]) +
          "</td></tr>",
      )
      .join("") +
    "<tr><td>Obligation</td><td>" +
    money(c.obligation.amountPaise) +
    '</td><td colspan="2">Registered fact; regulatory minimum unconfirmed</td></tr></tbody></table></div><p id="ifsc-result" class="source"></p></div><div class="card"><div class="title-row"><h2>Case intelligence</h2><button id="evaluate">Re-evaluate</button></div><p class="source">Policy: source review required · ' +
    (report
      ? "Evaluation " + report.payload.version
      : "Awaiting first evidence") +
    "</p>" +
    (report
      ? report.payload.findings
          .map(
            (f) =>
              '<div class="finding"><span class="badge ' +
              escape(f.status) +
              '">' +
              escape(f.status) +
              "</span> <b>" +
              escape(f.code) +
              "</b><p>" +
              escape(f.message) +
              '</p><p class="source">Reviewer action: ' +
              escape(f.suggestedAction || "Review referenced evidence") +
              '</p><div class="source">' +
              escape(JSON.stringify(f.sources)) +
              "</div></div>",
          )
          .join("")
      : '<p class="muted">Upload evidence or run an evaluation.</p>') +
    '</div><div class="card"><h2>Preserved history</h2>' +
    h
      .map(
        (e) =>
          "<details><summary>" +
          escape(e.kind) +
          " · " +
          escape(e.created) +
          '</summary><div class="source">' +
          escape(e.id) +
          " · " +
          escape(e.actor) +
          "</div><pre>" +
          escape(JSON.stringify(e.payload, null, 2)) +
          "</pre></details>",
      )
      .join("") +
    '</div></div><div><div class="card"><h2>Source documents</h2>' +
    (doc
      ? '<button id="preview-document">Preview latest source</button><div id="document-preview"></div>'
      : "") +
    h
      .filter((e) => e.kind === "document")
      .map(
        (e, i) =>
          '<p><a href="/api/cases/' +
          id +
          "/documents/" +
          e.id +
          '">Download version ' +
          (i + 1) +
          '</a></p><p class="source">SHA-256 ' +
          escape(e.payload.sha256) +
          "</p>",
      )
      .join("") +
    (window.institutionRole(user)
      ? '<form id="upload"><label>Add a version · PDF, PNG, JPEG, TXT<input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.txt" required></label><button>Upload privately</button></form><div class="toolbar"><button id="process">Process latest document</button></div><p class="source">PDFs use embedded text or raster OCR within a five-page budget. Images require Tesseract. Processing failures are recorded.</p>'
      : "") +
    "</div>" +
    (window.institutionRole(user)
      ? '<div class="card"><h2>Correct declaration</h2><form id="correction">' +
        fieldInputs(c.instrument) +
        '<label>Reason<textarea name="reason" required maxlength="2000"></textarea></label><button>Save new revision</button></form></div>'
      : '<div class="card"><h2>Development evidence</h2><p class="muted">Fictional provider. This cannot authenticate a bank deposit.</p><label for="scenario">Development evidence scenario</label><select id="scenario"><option value="unavailable">External source unavailable</option><option value="mock_confirmed">Mock values match</option><option value="mock_conflict">Mock amount conflict</option></select><button id="external">Retrieve mock evidence</button></div>') +
    '<div class="card"><h2>Review conversation</h2>' +
    h
      .filter((e) =>
        ["clarifications", "responses", "observations"].includes(e.kind),
      )
      .map(
        (e) =>
          "<p><b>" +
          escape(e.kind) +
          "</b><br>" +
          escape(e.payload.text) +
          "</p>",
      )
      .join("") +
    '<form id="review">' +
    (window.institutionRole(user)
      ? '<label>Reply to clarification<select name="requestId">' +
        h
          .filter((e) => e.kind === "clarifications")
          .map(
            (e) =>
              '<option value="' +
              e.id +
              '">' +
              escape(e.payload.text) +
              "</option>",
          )
          .join("") +
        "</select></label>"
      : '<label>Record type<select name="action"><option value="clarifications">Clarification request</option><option value="observations">Review observation</option></select></label>') +
    '<label>Message<textarea name="text" required maxlength="4000"></textarea></label><button>Record message</button></form></div><div class="card"><h3>Audit trail · ' +
    c.audit.length +
    " events</h3>" +
    c.audit
      .map(
        (e) =>
          '<p class="source">' +
          escape(e.created) +
          "<br>" +
          escape(e.actor) +
          " · " +
          escape(e.action) +
          "</p>",
      )
      .join("") +
    "</div></div></div>";
  if ($("#preview-document"))
    $("#preview-document").onclick = () =>
      run(async () => {
        const target = $("#document-preview");
        if (doc.payload.mime === "application/pdf") {
          target.textContent =
            "PDFs are downloaded privately for local viewing. Embedded active content is not rendered in this workspace.";
        } else if (doc.payload.mime.startsWith("image/"))
          target.innerHTML =
            '<img class="document-image" alt="Uploaded source document" src="/api/cases/' +
            id +
            "/documents/" +
            doc.id +
            '?preview=1">';
        else {
          const r = await fetch(
            "/api/cases/" + id + "/documents/" + doc.id + "?preview=1",
          );
          if (!r.ok) throw Error("Document unavailable");
          target.innerHTML = "<pre></pre>";
          target.querySelector("pre").textContent = await r.text();
        }
      });
  $("#back").onclick = () => run(registry);
  $("#evaluate").onclick = () =>
    run(async () => {
      await api("/cases/" + id + "/evaluate", "POST", {});
      await detail(id);
    });
  $("#ifsc-check").onclick = () =>
    run(async () => {
      $("#ifsc-result").textContent = JSON.stringify(
        await api("/cases/" + id + "/ifsc", "POST", {}),
      );
    });
  if ($("#upload")) {
    $("#upload").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const f = e.target.file.files[0];
        if (f.size > 4194304) throw Error("Maximum 4 MiB");
        const data = await new Promise((ok, no) => {
          const r = new FileReader();
          r.onload = () => ok(r.result.split(",")[1]);
          r.onerror = no;
          r.readAsDataURL(f);
        });
        await api("/cases/" + id + "/documents", "POST", {
          base64: data,
          mime: f.type,
        });
        await detail(id);
      });
    };
    $("#process").onclick = () =>
      run(async () => {
        const p = await api("/cases/" + id + "/process", "POST", {});
        await detail(id);
        if (p.status === "failed") notice(p.error);
      });
    $("#correction").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await api("/cases/" + id + "/corrections", "POST", {
          instrument: instrument(e.target),
          revision: c.revision,
          reason: e.target.reason.value,
        });
        await detail(id);
      });
    };
  }
  if (window.institutionRole(user) && x && x.payload.documentId === doc?.id) {
    const panel = document.createElement("div");
    panel.className = "card";
    panel.innerHTML =
      '<h2>Correct extracted fields</h2><p class="source">Original OCR is preserved. Correct values by referring to the source document.</p><form id="extracted-correction">' +
      fieldInputs(
        Object.fromEntries(
          Object.entries(x.payload.fields).map(([k, f]) => [k, f.value]),
        ),
      ) +
      '<label>Reason<textarea name="reason" required maxlength="2000"></textarea></label><button>Save extraction correction</button></form>';
    $("#detail .columns > div:last-child").append(panel);
    $("#extracted-correction").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await api("/cases/" + id + "/extraction-corrections", "POST", {
          extractionId: x.id,
          values: instrument(e.target),
          reason: e.target.reason.value,
        });
        await detail(id);
      });
    };
  }
  if ($("#external"))
    $("#external").onclick = () =>
      run(async () => {
        await api("/cases/" + id + "/external", "POST", {
          scenario: $("#scenario").value,
        });
        await detail(id);
      });
  $("#review").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const b = Object.fromEntries(new FormData(e.target));
      await api(
        "/cases/" +
          id +
          "/" +
          (window.institutionRole(user) ? "responses" : b.action),
        "POST",
        b,
      );
      await detail(id);
    });
  };
  window.mountReviewWorkspace({ c, user, api, run, detail, escape });
  window.mountDomainCase({
    c,
    user,
    api,
    run,
    detail,
    escape,
    fieldInputs,
    readInstrument: instrument,
  });
}
async function enter() {
  $("#identity").textContent = user.email + " · " + user.role;
  $("#logout").hidden = false;
  await registry();
  window.mountDomainNavigation({ user, api, run, views, registry, escape });
}
$("#login-form").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    user = await api(
      "/login",
      "POST",
      Object.fromEntries(new FormData(e.target)),
    );
    e.target.reset();
    await enter();
  });
};
$("#logout").onclick = () =>
  run(async () => {
    await api("/logout", "POST", {});
    user = null;
    $("#logout").hidden = true;
    $("#identity").textContent = "Secure access";
    views("login");
  });
$("#cases-nav").onclick = () => {
  if (user) run(registry);
};
$("#instrument-fields").innerHTML = fieldInputs();
$("#new-case").onclick = () =>
  run(async () => {
    const rows = await api("/obligations");
    $("#existing-obligation").innerHTML =
      '<option value="">Register a new obligation with this submission</option>' +
      rows
        .map(
          (o) =>
            '<option value="' +
            escape(o.id) +
            '">' +
            escape(o.programme || o.id) +
            " · " +
            o.amount_paise +
            " paise</option>",
        )
        .join("");
    $("#existing-obligation").onchange = (e) => {
      const o = rows.find((o) => o.id === e.target.value);
      if (o) $("#register-form").elements.obligation.value = o.amount_paise;
    };
    $("#register").showModal();
  });
$("#close-register").onclick = () => $("#register").close();
$("#register-form").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    const f = e.target,
      v = Object.fromEntries(new FormData(f));
    const c = await api("/cases", "POST", {
      name: v.name,
      obligation: { amountPaise: Number(v.obligation) },
      ...(v.obligationId ? { obligationId: v.obligationId } : {}),
      instrument: instrument(f),
    });
    submissionKey = crypto.randomUUID();
    $("#register").close();
    f.reset();
    await detail(c.id);
  });
};
api("/me")
  .then(async (u) => {
    user = u;
    await enter();
  })
  .catch(() => views("login"));

document
  .querySelector("#register-form")
  .addEventListener("input", () => (submissionKey = crypto.randomUUID()));
