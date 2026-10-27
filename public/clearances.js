(() => {
  const element = (tag, text, parent) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.append(n);
    return n;
  };
  const select = (parent, label, values, multiple = false) => {
    const wrap = element("label", label, parent),
      input = element("select", undefined, wrap);
    input.multiple = multiple;
    input.setAttribute("aria-label", label);
    for (const [value, text] of values) {
      const option = element("option", text, input);
      option.value = value;
    }
    return input;
  };
  const note = (parent, label = "Reason") => {
    const wrap = element("label", label, parent),
      input = element("textarea", undefined, wrap);
    input.required = true;
    input.setAttribute("aria-label", label);
    input.maxLength = 2000;
    return input;
  };
  const form = (parent, label, run, action) => {
    const f = element("form", undefined, parent);
    f.setAttribute("aria-label", label);
    f.onsubmit = (event) => {
      event.preventDefault();
      run(() => action(f));
    };
    return f;
  };
  const button = (parent, text) => element("button", text, parent);
  const disclosure = (parent, label) => {
    const n = element("details", undefined, parent);
    element("summary", label, n);
    return n;
  };
  const choices = (rows) => rows.map((r) => [r.entity, r.entity]);
  window.mountClearanceCase = ({ c, user, api, run, detail }) => {
    const host = document.querySelector("#detail .columns > div:last-child");
    const panel = disclosure(
      host,
      "Department clearances and internal decision",
    );
    panel.setAttribute(
      "aria-label",
      "Department clearances and internal decision",
    );
    let loaded = false;
    panel.ontoggle = () => {
      if (!panel.open || loaded) return;
      run(async () => {
        const root = "/clearance/cases/" + c.id,
          r = await api(root);
        const content = element("div", undefined, panel);
        content.setAttribute("aria-live", "polite");
        element(
          "p",
          "Bank release: NOT CONFIRMED. These controls record internal administrative review only.",
          content,
        );
        element(
          "p",
          "Procedure: " +
            (r.procedureVersion || "not bound") +
            " · " +
            (r.classification || "unconfirmed"),
          content,
        );
        element(
          "p",
          r.readyForInternalReview
            ? "Prerequisites satisfied for internal review; independent checker required."
            : "Internal approval has unresolved prerequisites.",
          content,
        );
        const blockers = element("ul", undefined, content);
        for (const b of r.blockers)
          element(
            "li",
            [b.code, b.requirementId, b.findingCode, ...(b.reasons || [])]
              .filter(Boolean)
              .join(" · "),
            blockers,
          );
        const list = element("ul", undefined, content);
        for (const step of r.items || [])
          element(
            "li",
            step.label +
              " · " +
              step.department +
              " · " +
              step.status +
              (step.mandatory ? " · mandatory" : " · optional"),
            list,
          );
        const reviewer = ["officer", "supervisor"].includes(user.role);
        for (const decision of r.decisions || [])
          element(
            "p",
            "Recorded internal " +
              decision.outcome +
              " · " +
              decision.classification +
              " · " +
              (decision.current
                ? "current evidence snapshot"
                : "historical; current facts or permissions changed") +
              " · bank release NOT CONFIRMED",
            content,
          );
        if (
          user.role === "supervisor" &&
          ["closed", "decision_recorded"].includes(r.workflow?.stage)
        ) {
          const closed = r.workflow.stage === "closed";
          const administration = form(
            content,
            closed
              ? "Reopen administrative review"
              : "Close administrative case",
            run,
            async () => {
              await api(root + (closed ? "/reopen" : "/close"), "POST", {
                revision: r.workflow.revision,
                reason: administrationReason.value,
              });
              await detail(c.id);
            },
          );
          const administrationReason = note(
            administration,
            closed ? "Reopening reason" : "Case closure reason",
          );
          button(
            administration,
            closed
              ? "Reopen for evidence review"
              : "Close internal administrative case",
          ).disabled = !closed && !(r.decisions || []).some((d) => d.current);
        }
        if (reviewer && r.workflow?.stage !== "closed") {
          const bind = form(
            content,
            "Bind active clearance procedure",
            run,
            async () => {
              await api(root + "/bind", "POST", {
                scope: scope.value,
                revision: r.bindingRevision || 0,
                reason: bindReason.value,
              });
              await detail(c.id);
            },
          );
          const scope = select(
            bind,
            "Active procedure",
            (r.availableBindings || []).map((a) => [
              a.payload.procedure.scope,
              a.payload.procedure.version +
                " · " +
                a.payload.procedure.classification,
            ]),
          );
          const bindReason = note(bind, "Procedure binding reason");
          button(bind, "Bind active procedure").disabled =
            !scope.options.length;
          for (const step of r.items || []) {
            const section = disclosure(content, "Request " + step.label);
            const old = r.requests?.find(
              (v) => v.payload.requirementId === step.id,
            );
            const request = form(
              section,
              "Request " + step.label,
              run,
              async () => {
                await api(root + "/requests", "POST", {
                  requirementId: step.id,
                  reviewer: assigned.value,
                  documentVersionIds: Array.from(documents.selectedOptions).map(
                    (v) => v.value,
                  ),
                  revision: old?.revision || 0,
                  reason: requestReason.value,
                });
                await detail(c.id);
              },
            );
            const assigned = select(
              request,
              "Department reviewer for " + step.label,
              (r.reviewerOptions || [])
                .filter((g) => g.department === step.department)
                .map((g) => [g.userId, g.userId + " · " + g.department]),
            );
            const documents = select(
              request,
              "Share document versions for " + step.label,
              (r.snapshot?.source.documents || []).map((d) => [
                d.id,
                d.kind +
                  " · version " +
                  d.version +
                  " · " +
                  d.sha256.slice(0, 12),
              ]),
              true,
            );
            element(
              "p",
              "Required evidence: " +
                (step.evidenceKinds.join(", ") ||
                  "No additional document required") +
                ". Only selected versions are shared with this department.",
              request,
            );
            const requestReason = note(
              request,
              "Department request message for " + step.label,
            );
            button(
              request,
              old ? "Refresh or reassign " + step.label : "Send " + step.label,
            ).disabled =
              !assigned.options.length ||
              [
                "NOT_APPLICABLE",
                "REVIEW_APPLICABILITY",
                "BLOCKED_PREREQUISITE",
              ].includes(step.status);
            if (old && old.payload.status !== "withdrawn") {
              const withdraw = form(
                section,
                "Withdraw " + step.label,
                run,
                async () => {
                  await api(root + "/withdraw", "POST", {
                    entity: old.entity,
                    revision: old.revision,
                    reason: withdrawReason.value,
                  });
                  await detail(c.id);
                },
              );
              const withdrawReason = note(
                withdraw,
                "Withdrawal reason for " + step.label,
              );
              button(withdraw, "Withdraw " + step.label);
            }
          }
          const propose = form(
            content,
            "Propose internal administrative decision",
            run,
            async () => {
              await api(root + "/proposals", "POST", {
                outcome: outcome.value,
                reason: proposalReason.value,
              });
              await detail(c.id);
            },
          );
          const outcome = select(propose, "Internal decision outcome", [
            ["refer", "Refer for further review"],
            ["reject", "Record internal rejection"],
            ["approve", "Approve internal documentary decision"],
          ]);
          const proposalReason = note(propose, "Maker decision reason");
          button(propose, "Propose internal decision");
          if (user.role === "supervisor")
            for (const proposal of r.proposals || [])
              if (proposal.action === "proposed") {
                const check = form(
                  content,
                  "Check internal decision " + proposal.entity,
                  run,
                  async () => {
                    await api(root + "/confirm", "POST", {
                      entity: proposal.entity,
                      revision: proposal.revision,
                      reason: checkerReason.value,
                    });
                    await detail(c.id);
                  },
                );
                element(
                  "p",
                  "Maker " +
                    proposal.payload.maker +
                    " proposes " +
                    proposal.payload.outcome +
                    ": " +
                    proposal.payload.reason,
                  check,
                );
                const checkerReason = note(check, "Independent checker reason");
                button(check, "Confirm internal decision").disabled =
                  proposal.payload.maker === user.id || !proposal.current;
              }
        }
        if (["officer", "supervisor", "audit_reviewer"].includes(user.role)) {
          const history = disclosure(content, "Clearance and decision history");
          let cursor = null;
          const events = element("div", undefined, history),
            next = button(history, "Load clearance history");
          next.type = "button";
          next.onclick = () =>
            run(async () => {
              const page = await api(
                root +
                  "/history?limit=20" +
                  (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
              );
              for (const event of page.items)
                element(
                  "p",
                  event.created +
                    " · " +
                    event.kind +
                    " · " +
                    event.action +
                    " · revision " +
                    event.revision +
                    " · " +
                    event.actor,
                  events,
                );
              cursor = page.nextCursor;
              next.hidden = !cursor;
            });
        }
        loaded = true;
      });
    };
  };
  window.mountClearanceNavigation = ({ user, api, run, views }) => {
    if (!["officer", "supervisor", "audit_reviewer"].includes(user.role))
      return;
    let nav = document.querySelector("#clearance-nav");
    if (!nav) {
      nav = element(
        "button",
        "Department reviews",
        document.querySelector("aside"),
      );
      nav.id = "clearance-nav";
      nav.className = "nav";
    }
    const render = async () => {
      views("management");
      const host = document.querySelector("#management");
      host.replaceChildren();
      element("h1", "Department reviews", host);
      element(
        "p",
        "Department assignments grant access to selected request evidence only. External bank release remains unconfirmed.",
        host,
      );
      if (["supervisor", "audit_reviewer"].includes(user.role)) {
        const config = await api("/clearance/configuration");
        const section = disclosure(
          host,
          "Procedure activation and department permissions",
        );
        element(
          "p",
          "Only trusted server-configured procedures can be activated. Synthetic procedures are test fixtures and carry no regulatory authority.",
          section,
        );
        if (user.role === "supervisor") {
          const activate = form(
            section,
            "Activate configured procedure",
            run,
            async () => {
              const p = config.procedures.find(
                  (p) => p.scope + "|" + p.version === version.value,
                ),
                active = config.activations.find(
                  (v) => v.payload.procedure.scope === p.scope,
                );
              await api("/clearance/activations", "POST", {
                scope: p.scope,
                version: p.version,
                revision: active?.revision || 0,
                reason: activationReason.value,
              });
              await render();
            },
          );
          const version = select(
            activate,
            "Configured procedure version",
            config.procedures.map((p) => [
              p.scope + "|" + p.version,
              p.version + " · " + p.classification,
            ]),
          );
          const activationReason = note(activate, "Activation reason");
          button(activate, "Activate procedure").disabled =
            !version.options.length;
          const permissions = form(
            section,
            "Department reviewer permission",
            run,
            async () => {
              const existing = config.grants.find(
                (g) =>
                  g.payload.department === department.value &&
                  g.payload.userId === reviewer.value,
              );
              await api("/clearance/grants", "POST", {
                department: department.value,
                userId: reviewer.value,
                enabled: enabled.value === "true",
                revision: existing?.revision || 0,
                reason: permissionReason.value,
              });
              await render();
            },
          );
          const departments = [
            ...new Set(
              config.procedures.flatMap((p) =>
                p.requirements.map((r) => r.department),
              ),
            ),
          ];
          const department = select(
            permissions,
            "Department permission",
            departments.map((d) => [d, d]),
          );
          const reviewer = select(
            permissions,
            "Authorized department user",
            (config.reviewers || []).map((r) => [r.id, r.id + " · " + r.role]),
          );
          const enabled = select(permissions, "Permission action", [
            ["true", "Grant department review"],
            ["false", "Revoke department review"],
          ]);
          const permissionReason = note(permissions, "Permission reason");
          button(permissions, "Save department permission").disabled =
            !department.options.length || !reviewer.options.length;
        }
        for (const g of config.grants)
          element(
            "p",
            g.payload.department +
              " · " +
              g.payload.userId +
              " · " +
              (g.payload.enabled ? "granted" : "revoked") +
              " · revision " +
              g.revision,
            section,
          );
      }
      if (user.role === "audit_reviewer") return;
      const queue = element("div", undefined, host),
        next = button(host, "Load department queue");
      next.type = "button";
      let cursor = null;
      const load = async () => {
        const page = await api(
          "/clearance/queue?limit=20" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
        if (!cursor && !page.items.length)
          element("p", "No authorized department requests.", queue);
        for (const r of page.items) {
          const item = disclosure(
            queue,
            r.department +
              " · " +
              r.requirementId +
              " · " +
              r.status +
              (r.current ? "" : " · stale"),
          );
          const open = button(item, "Open selected request");
          open.type = "button";
          open.onclick = () =>
            run(async () => {
              open.disabled = true;
              const endpoint =
                  "/clearance/requests/" + encodeURIComponent(r.entity),
                request = await api(endpoint);
              element("p", request.message, item);
              if (request.response)
                element("p", "Recorded response: " + request.response, item);
              for (const d of request.documents) {
                const link = element(
                  "a",
                  "Download selected " + d.kind + " version " + d.version,
                  item,
                );
                link.href = "/api" + endpoint + "/documents/" + d.id;
                link.download = "";
                element("p", "SHA-256: " + d.sha256, item);
              }
              if (request.current && request.status === "pending") {
                const response = form(
                  item,
                  "Department response " + request.requirementId,
                  run,
                  async () => {
                    await api(endpoint, "POST", {
                      status: status.value,
                      revision: request.revision,
                      reason: responseReason.value,
                    });
                    await render();
                  },
                );
                const status = select(
                  response,
                  "Department response decision",
                  [
                    ["accepted", "Accept selected evidence"],
                    ["rejected", "Record objection"],
                  ],
                );
                const responseReason = note(
                  response,
                  "Department response reason",
                );
                button(response, "Record department response");
              }
            });
        }
        cursor = page.nextCursor;
        next.hidden = !cursor;
      };
      next.onclick = () => run(load);
      await load();
    };
    nav.onclick = () => run(render);
  };
})();
