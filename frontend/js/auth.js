/* ==========================================================================
   GENFO AI — AUTH PAGE LOGIC (login.html + signup.html)
   ========================================================================== */

   (function () {
    "use strict";
  
    document.addEventListener("DOMContentLoaded", () => {
      // If already logged in, skip straight to the dashboard — unless there's
      // a pending upgrade flag (e.g. browser back button after clicking
      // Upgrade earlier), in which case resume checkout instead of dropping it.
      if (Api.isAuthenticated()) {
        const resumed =
          typeof Billing !== "undefined" &&
          Billing.resumePendingUpgradeIfAny(() => {
            UI.toast("You're now on Pro! Redirecting…", "success", 1800);
            setTimeout(() => {
              window.location.href = "dashboard.html";
            }, 600);
          });
        if (!resumed) {
          window.location.href = "dashboard.html";
        }
        return;
      }
  
      initLoginForm();
      initSignupForm();
      initPasswordToggles();
      initSocialButtons();
    });
  
    /* ---- Login ------------------------------------------------------------- */
    function initLoginForm() {
      const form = document.getElementById("login-form");
      if (!form) return;
  
      const alertEl = form.querySelector(".alert");
      const submitBtn = form.querySelector('button[type="submit"]');
  
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        UI.hideAlert(alertEl);
        UI.clearAllFieldErrors(form);
  
        const email = form.email.value.trim();
        const password = form.password.value;
  
        let hasError = false;
        if (!UI.isValidEmail(email)) {
          UI.setFieldError(form.email.closest(".field"), "Enter a valid email address.");
          hasError = true;
        }
        if (!password) {
          UI.setFieldError(form.password.closest(".field"), "Enter your password.");
          hasError = true;
        }
        if (hasError) return;
  
        UI.setButtonLoading(submitBtn, true);
  
        try {
          const res = await Api.Auth.login(email, password);
          Api.setToken(res.data.token);
          Api.setUser(res.data.user);
  
          const resumedUpgrade =
            typeof Billing !== "undefined" &&
            Billing.resumePendingUpgradeIfAny(() => {
              UI.toast("You're now on Pro! Redirecting…", "success", 1800);
              setTimeout(() => {
                window.location.href = "dashboard.html";
              }, 600);
            });
  
          if (resumedUpgrade) {
            UI.toast("Welcome back! Continuing to checkout…", "success", 1800);
            UI.setButtonLoading(submitBtn, false);
            return;
          }
  
          UI.toast("Welcome back. Redirecting…", "success", 1800);
          setTimeout(() => {
            window.location.href = "dashboard.html";
          }, 500);
        } catch (err) {
          UI.showAlert(alertEl, err.message || "Login failed. Please try again.", "error");
          UI.setButtonLoading(submitBtn, false);
        }
      });
    }
  
    /* ---- Signup -------------------------------------------------------------- */
    function initSignupForm() {
      const form = document.getElementById("signup-form");
      if (!form) return;
  
      const alertEl = form.querySelector(".alert");
      const submitBtn = form.querySelector('button[type="submit"]');
      const strengthBar = form.querySelector(".password-strength");
  
      if (strengthBar) {
        form.password.addEventListener("input", () => {
          const score = UI.passwordStrength(form.password.value);
          strengthBar.className = "password-strength" + (score > 0 ? ` level-${score}` : "");
        });
      }
  
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        UI.hideAlert(alertEl);
        UI.clearAllFieldErrors(form);
  
        const name = form.name.value.trim();
        const email = form.email.value.trim();
        const password = form.password.value;
  
        let hasError = false;
        if (name.length < 2) {
          UI.setFieldError(form.name.closest(".field"), "Enter your full name.");
          hasError = true;
        }
        if (!UI.isValidEmail(email)) {
          UI.setFieldError(form.email.closest(".field"), "Enter a valid email address.");
          hasError = true;
        }
        if (password.length < 6) {
          UI.setFieldError(form.password.closest(".field"), "Password must be at least 6 characters.");
          hasError = true;
        }
        if (form.terms && !form.terms.checked) {
          UI.showAlert(alertEl, "Please accept the Terms of Service to continue.", "error");
          hasError = true;
        }
        if (hasError) return;
  
        UI.setButtonLoading(submitBtn, true);
  
        try {
          const res = await Api.Auth.signup(name, email, password);
          Api.setToken(res.data.token);
          Api.setUser(res.data.user);
  
          // If they got here from clicking "Upgrade to Pro" while logged out,
          // resume checkout automatically instead of dropping them on the
          // dashboard first (see Billing.startUpgrade in js/billing.js).
          const resumedUpgrade =
            typeof Billing !== "undefined" &&
            Billing.resumePendingUpgradeIfAny(() => {
              UI.toast("You're now on Pro! Redirecting…", "success", 1800);
              setTimeout(() => {
                window.location.href = "dashboard.html";
              }, 600);
            });
  
          if (resumedUpgrade) {
            UI.toast("Account created! Continuing to checkout…", "success", 1800);
            UI.setButtonLoading(submitBtn, false);
            return;
          }
  
          UI.toast("Account created. Taking you to your dashboard…", "success", 1800);
          setTimeout(() => {
            window.location.href = "dashboard.html";
          }, 500);
        } catch (err) {
          UI.showAlert(alertEl, err.message || "Signup failed. Please try again.", "error");
          UI.setButtonLoading(submitBtn, false);
        }
      });
    }
  
    /* ---- Password show/hide toggles -------------------------------------------- */
    function initPasswordToggles() {
      document.querySelectorAll(".field-toggle-visibility").forEach((btn) => {
        const input = btn.closest(".field-input-wrap").querySelector("input");
        UI.bindPasswordToggle(btn, input);
      });
    }
  
    /* ---- Google Sign-In (Google Identity Services) ------------------------------
       The backend's POST /api/auth/google expects a Google ID token in the body
       (verified server-side with google-auth-library) — not a redirect. So we
       load GIS, request a credential, and POST it. There is no GitHub OAuth
       route on the backend, so no GitHub button is wired up.
    --------------------------------------------------------------------------- */
    const GOOGLE_CLIENT_ID = "753556107629-6n9ehitj2tm8ompa03pvacqe83fs3ofv.apps.googleusercontent.com";
    let googleInitialized = false;
  
    function initSocialButtons() {
      const googleBtn = document.querySelector("[data-social='google']");
      if (!googleBtn) return;
  
      loadGoogleScript(() => initGoogleClient(googleBtn));
    }
  
    function loadGoogleScript(onReady) {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        onReady();
        return;
      }
      if (document.getElementById("google-identity-script")) {
        document.getElementById("google-identity-script").addEventListener("load", onReady);
        return;
      }
      const script = document.createElement("script");
      script.id = "google-identity-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = onReady;
      script.onerror = () => {
        UI.toast("Couldn't load Google Sign-In. Check your connection and try again.", "error");
      };
      document.head.appendChild(script);
    }
  
    function initGoogleClient(googleBtn) {
      if (googleInitialized) return;
      if (!window.google || !window.google.accounts || !window.google.accounts.id) return;
  
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
      });
      googleInitialized = true;
  
      // Hide the styled placeholder button and render Google's real button
      // in its place. This avoids prompt()/One Tap entirely, which is being
      // deprecated in favor of FedCM and was causing the gsi/status 403.
      const host = document.createElement("div");
      host.id = "google-btn-real";
      googleBtn.insertAdjacentElement("afterend", host);
      googleBtn.style.display = "none";
  
      window.google.accounts.id.renderButton(host, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        width: 320,
      });
    }
  
    function handleGoogleCredential(response) {
      if (!response || !response.credential) {
        UI.toast("Google sign-in failed: no credential received.", "error");
        return;
      }
  
      Api.Auth.google(response.credential)
        .then((res) => {
          Api.setToken(res.data.token);
          Api.setUser(res.data.user);
          UI.toast("Signed in with Google. Redirecting…", "success", 1500);
          setTimeout(() => {
            window.location.href = "dashboard.html";
          }, 400);
        })
        .catch((err) => {
          UI.toast(err.message || "Google sign-in failed.", "error");
        });
    }
  })();