window.mountAccountSecurity = function ({ user, api, run, views, enter }) {
  let button = document.querySelector("#account-security-nav");
  if (!button) {
    button = document.createElement("button");
    button.id = "account-security-nav";
    button.className = "nav";
    document.querySelector("aside").append(button);
  }
  button.hidden = false;
  button.textContent = "Account security";
  const open = async (recoveryCodes) => {
    views("management");
    const host = document.querySelector("#management");
    host.replaceChildren();
    const node = (tag, text, parent = host) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      parent.append(n);
      return n;
    };
    const field = (label, type = "password", parent = host) => {
      const l = node("label", label, parent),
        input = node("input", undefined, l);
      input.type = type;
      input.autocomplete = type === "password" ? "off" : "one-time-code";
      return input;
    };
    const state = await api("/security/mfa");
    const heading = node("h2", "Account security");
    heading.tabIndex = -1;
    heading.focus();
    node(
      "p",
      state.enabled
        ? "Authenticator protection is enabled. Sensitive administrative actions require verification within five minutes."
        : "Add an authenticator app to protect sign-in. " +
            (state.enrollmentRequired
              ? "Your role requires enrollment before using the workspace."
              : "Enrollment is available for your account."),
    );
    node(
      "p",
      "Recovery codes work once with your password. Store them privately. No administrator recovery bypass is provided.",
    );
    node(
      "p",
      "Unused recovery codes: " +
        state.recoveryRemaining +
        ". Use a new authenticator code for each successful verification.",
    );
    const form = node("form"),
      password = field("Current account password", "password", form),
      code = field("Fresh authenticator code", "password", form),
      recovery = field(
        "Single-use recovery code (instead of authenticator)",
        "password",
        form,
      );
    password.autocomplete = "current-password";
    code.autocomplete = "one-time-code";
    code.inputMode = "numeric";
    const credentials = () => ({
      password: password.value,
      ...(code.value ? { mfaCode: code.value } : {}),
      ...(recovery.value ? { recoveryCode: recovery.value } : {}),
    });
    const clear = () => {
      password.value = "";
      code.value = "";
      recovery.value = "";
    };
    const act = (label, callback) => {
      const b = node("button", label, form);
      b.type = "button";
      b.onclick = () => run(callback);
      return b;
    };
    const displayCodes = (codes) => {
      const box = node("section");
      box.className = "card";
      node("h3", "Save these recovery codes privately", box);
      node(
        "p",
        "These values are shown once. Leaving this screen discards them; later rotation replaces all old codes.",
        box,
      );
      for (const [i, value] of codes.entries()) {
        const input = field("Recovery code " + (i + 1), "password", box);
        input.value = value;
        input.readOnly = true;
        input.dataset.sensitive = "true";
        const copy = node("button", "Copy recovery code " + (i + 1), box);
        copy.type = "button";
        copy.onclick = () =>
          run(async () => {
            await navigator.clipboard.writeText(value);
            copy.textContent = "Copied recovery code " + (i + 1);
          });
      }
    };
    act(
      state.enabled ? "Replace authenticator" : "Begin authenticator setup",
      async () => {
        const result = await api("/security/mfa/enroll", "POST", {
          ...credentials(),
          revision: state.revision,
        });
        clear();
        state.revision = result.revision;
        const setup = node("section");
        setup.className = "card";
        node("h3", "Configure your authenticator", setup);
        node(
          "p",
          "Add a time-based account in your authenticator app using this setup key. Enter its new code above and confirm within ten minutes. This pending setup is bound to this session.",
          setup,
        );
        const key = field("Authenticator setup key", "password", setup);
        key.value = result.secret;
        key.readOnly = true;
        key.dataset.sensitive = "true";
        const reveal = node("button", "Show setup key", setup);
        reveal.type = "button";
        reveal.onclick = () => {
          key.type = key.type === "password" ? "text" : "password";
          reveal.textContent =
            key.type === "password" ? "Show setup key" : "Hide setup key";
        };
        const confirm = node(
          "button",
          "Confirm authenticator enrollment",
          setup,
        );
        confirm.type = "button";
        confirm.onclick = () =>
          run(async () => {
            const enabled = await api("/security/mfa/confirm", "POST", {
              password: password.value,
              mfaCode: code.value,
              revision: result.revision,
            });
            clear();
            setup.remove();
            user.mfaEnrollmentRequired = false;
            await enter();
            await open(enabled.recoveryCodes);
          });
      },
    );
    if (state.enabled) {
      act("Verify recent MFA step-up", async () => {
        await api("/security/step-up", "POST", credentials());
        clear();
        node("p", "Verified for five minutes. Return to the intended action.");
      });
      act("Replace recovery codes", async () => {
        const result = await api(
          "/security/mfa/recovery",
          "POST",
          credentials(),
        );
        clear();
        await open(result.recoveryCodes);
      });
      if (!state.requiredForRole)
        act("Disable MFA and sign out", async () => {
          await api("/security/mfa/disable", "POST", credentials());
          clear();
          location.reload();
        });
    }
    const change = node("details", undefined, form);
    node("summary", "Change password and revoke all sessions", change);
    const next = field(
      "New account password (12 to 200 characters)",
      "password",
      change,
    );
    next.autocomplete = "new-password";
    const save = node("button", "Change password and sign out", change);
    save.type = "button";
    save.onclick = () =>
      run(async () => {
        await api("/security/password", "POST", {
          ...credentials(),
          newPassword: next.value,
        });
        clear();
        next.value = "";
        location.reload();
      });
    form.onsubmit = (e) => {
      e.preventDefault();
    };
    if (recoveryCodes) displayCodes(recoveryCodes);
    if (
      !state.enrollmentRequired &&
      ["supervisor", "audit_reviewer"].includes(user.role)
    ) {
      const verify = node("button", "Verify audit integrity");
      verify.type = "button";
      verify.onclick = () =>
        run(async () => {
          const result = await api("/security/audit-integrity");
          node(
            "p",
            result.valid
              ? "Audit signatures verified. Keys and checkpoints require independent protection; pre-enrollment history was unsigned."
              : "Audit verification failed.",
          );
        });
    }
  };
  button.onclick = () => run(() => open());
  return { open };
};
