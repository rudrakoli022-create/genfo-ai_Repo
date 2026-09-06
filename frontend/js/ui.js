/* ==========================================================================
   GENFO AI — SHARED UI HELPERS
   Toasts, validation, scroll reveals, mobile nav. Used by every page.
   ========================================================================== */

const UI = (() => {
  /* ---- Toasts --------------------------------------------------------- */
  function ensureToastStack() {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      stack.setAttribute("aria-live", "polite");
      stack.setAttribute("role", "status");
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type = "info", duration = 4200) {
    const stack = ensureToastStack();
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);

    const remove = () => {
      el.classList.add("is-leaving");
      setTimeout(() => el.remove(), 220);
    };
    setTimeout(remove, duration);
    el.addEventListener("click", remove);
    return el;
  }

  /* ---- Upgrade modal ---------------------------------------------------- */
  function openUpgradeModal({
    title = "Upgrade to Pro",
    message = "You've hit today's free-plan limit. Upgrade to Pro for unlimited access.",
    amount = 99,
  } = {}) {
    let overlay = document.querySelector(".upgrade-modal-overlay");
    if (overlay) overlay.remove();

    overlay = document.createElement("div");
    overlay.className = "upgrade-modal-overlay";
    overlay.innerHTML = `
      <div class="upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title">
        <button type="button" class="upgrade-modal-close" aria-label="Close">&times;</button>
        <div class="upgrade-modal-badge">PRO</div>
        <h3 id="upgrade-modal-title">${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <button type="button" class="btn btn-primary btn-block" data-action="upgrade" data-amount="${amount}">
          <span class="btn-label">Upgrade to Pro — \u20b9${amount}/mo</span>
        </button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    const close = () => {
      overlay.remove();
      document.body.style.overflow = "";
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".upgrade-modal-close").addEventListener("click", close);

    return overlay; // caller can re-wire the [data-action="upgrade"] button via Billing.initUpgradeButtons
  }

  /* ---- Escaping -------------------------------------------------------- */
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---- Button loading state --------------------------------------------- */
  function setButtonLoading(btn, isLoading) {
    if (!btn) return;
    if (isLoading) {
      btn.classList.add("is-loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("is-loading");
      btn.disabled = false;
    }
  }

  /* ---- Field error helpers ------------------------------------------------ */
  function setFieldError(fieldEl, message) {
    if (!fieldEl) return;
    const input = fieldEl.querySelector(".field-input");
    const errorEl = fieldEl.querySelector(".field-error");
    if (input) input.classList.add("has-error");
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.add("is-visible");
    }
  }

  function clearFieldError(fieldEl) {
    if (!fieldEl) return;
    const input = fieldEl.querySelector(".field-input");
    const errorEl = fieldEl.querySelector(".field-error");
    if (input) input.classList.remove("has-error");
    if (errorEl) {
      errorEl.classList.remove("is-visible");
    }
  }

  function clearAllFieldErrors(form) {
    form.querySelectorAll(".field").forEach(clearFieldError);
  }

  /* ---- Alert banner (top-of-form) ----------------------------------------- */
  function showAlert(alertEl, message, type = "error") {
    if (!alertEl) return;
    alertEl.className = `alert alert-${type} is-visible`;
    alertEl.querySelector("span").textContent = message;
  }

  function hideAlert(alertEl) {
    if (!alertEl) return;
    alertEl.classList.remove("is-visible");
  }

  /* ---- Validators ------------------------------------------------------------ */
  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function passwordStrength(value) {
    let score = 0;
    if (value.length >= 6) score++;
    if (value.length >= 10) score++;
    if (/[A-Z]/.test(value) && /[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;
    return Math.min(score, 4);
  }

  /* ---- Password visibility toggle ------------------------------------------------ */
  function bindPasswordToggle(toggleBtn, input) {
    if (!toggleBtn || !input) return;
    toggleBtn.addEventListener("click", () => {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      toggleBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
      toggleBtn.querySelector(".icon-eye").style.display = isPassword ? "none" : "block";
      toggleBtn.querySelector(".icon-eye-off").style.display = isPassword ? "block" : "none";
    });
  }

  /* ---- Scroll reveal --------------------------------------------------------------- */
  function initScrollReveal() {
    const targets = document.querySelectorAll(".reveal");
    if (!targets.length) return;

    if (!("IntersectionObserver" in window)) {
      targets.forEach((t) => t.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    targets.forEach((t) => observer.observe(t));
  }

  /* ---- Mobile nav drawer (landing/auth pages) -------------------------------------- */
  function initMobileNav() {
    const toggle = document.querySelector(".nav-toggle");
    const drawer = document.querySelector(".mobile-drawer");
    if (!toggle || !drawer) return;

    const closeBtn = drawer.querySelector(".drawer-close");
    const links = drawer.querySelectorAll("a");

    const open = () => {
      drawer.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
    };
    const close = () => {
      drawer.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    };

    toggle.addEventListener("click", () => {
      drawer.classList.contains("is-open") ? close() : open();
    });
    if (closeBtn) closeBtn.addEventListener("click", close);
    links.forEach((link) => link.addEventListener("click", close));
  }

  /* ---- Aurora field injector --------------------------------------------------------- */
  function injectAuroraField() {
    if (document.querySelector(".aurora-field")) return;
    const div = document.createElement("div");
    div.className = "aurora-field";
    div.setAttribute("aria-hidden", "true");
    div.innerHTML = '<span class="noise-veil"></span>';
    document.body.insertBefore(div, document.body.firstChild);
  }

  return {
    toast,
    openUpgradeModal,
    escapeHtml,
    setButtonLoading,
    setFieldError,
    clearFieldError,
    clearAllFieldErrors,
    showAlert,
    hideAlert,
    isValidEmail,
    passwordStrength,
    bindPasswordToggle,
    initScrollReveal,
    initMobileNav,
    injectAuroraField,
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  UI.injectAuroraField();
  UI.initScrollReveal();
  UI.initMobileNav();
});
