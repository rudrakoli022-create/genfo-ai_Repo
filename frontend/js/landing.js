/* ==========================================================================
   GENFO AI — LANDING PAGE LOGIC
   ========================================================================== */

   (function () {
    "use strict";
  
    document.addEventListener("DOMContentLoaded", () => {
      redirectIfAuthenticated();
      initTypedHero();
      initNavScrollState();
      initPricingUpgrade();
    });
  
    /* If a valid session already exists, send the person straight to the app. */
    function redirectIfAuthenticated() {
      if (Api.isAuthenticated()) {
        // Don't force-redirect away from the marketing site automatically on
        // every load — only do it from the explicit CTA. Landing pages should
        // stay visitable even when logged in (e.g. opened in a new tab).
      }
    }
  
    /* Typed-word rotation in the hero headline. */
    function initTypedHero() {
      const el = document.querySelector(".hero-typed");
      if (!el) return;
  
      const words = ["ship faster.", "think clearer.", "build smarter.", "automate everything."];
      let wordIndex = 0;
      let charIndex = 0;
      let isDeleting = false;
  
      function tick() {
        const current = words[wordIndex];
  
        if (!isDeleting) {
          charIndex++;
          el.textContent = current.slice(0, charIndex);
          if (charIndex === current.length) {
            isDeleting = true;
            setTimeout(tick, 1800);
            return;
          }
        } else {
          charIndex--;
          el.textContent = current.slice(0, charIndex);
          if (charIndex === 0) {
            isDeleting = false;
            wordIndex = (wordIndex + 1) % words.length;
          }
        }
  
        const speed = isDeleting ? 35 : 65;
        setTimeout(tick, speed);
      }
  
      tick();
    }
  
    /* Slight header background increase on scroll for depth. */
    function initNavScrollState() {
      const header = document.querySelector(".site-header");
      if (!header) return;
      window.addEventListener(
        "scroll",
        () => {
          header.style.background = window.scrollY > 8 ? "rgba(8, 10, 16, 0.82)" : "rgba(8, 10, 16, 0.6)";
        },
        { passive: true }
      );
    }
  
    /* Pricing section's "Upgrade to Pro" button — goes straight to Razorpay
       checkout if already logged in, otherwise sends to signup first (see
       Billing.startUpgrade's redirect-with-flag behavior in js/billing.js). */
    function initPricingUpgrade() {
      if (typeof Billing === "undefined") return;
      Billing.initUpgradeButtons(() => {
        UI.toast("You're now on Pro! Redirecting to your dashboard…", "success", 1800);
        setTimeout(() => {
          window.location.href = "dashboard.html";
        }, 600);
      });
    }
  })();