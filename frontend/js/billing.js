/* ==========================================================================
   GENFO AI — BILLING (shared)
   Razorpay checkout + verification flow, used by both the landing page
   pricing section and the Settings page. Shared here so the logic isn't
   duplicated across pages.
   ========================================================================== */

   const Billing = (() => {
    function loadRazorpayScript() {
      return new Promise((resolve, reject) => {
        if (window.Razorpay) return resolve();
        if (document.getElementById("razorpay-checkout-script")) {
          document.getElementById("razorpay-checkout-script").addEventListener("load", resolve);
          return;
        }
        const script = document.createElement("script");
        script.id = "razorpay-checkout-script";
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load Razorpay checkout."));
        document.head.appendChild(script);
      });
    }
  
    /**
     * Starts the full upgrade flow: load script -> create order -> open
     * checkout -> verify signature -> onSuccess(user).
     *
     * @param {HTMLElement} triggerBtn - button to show loading state on
     * @param {number} amount - amount in rupees (e.g. 499)
     * @param {(user: object) => void} onSuccess - called with the updated user after verification
     */
    async function startUpgrade(triggerBtn, amount, onSuccess) {
      if (!Api.isAuthenticated()) {
        // Not logged in — send to signup, flagged so signup can resume
        // checkout automatically right after account creation.
        sessionStorage.setItem("genfoPendingUpgrade", String(amount));
        window.location.href = "signup.html?upgrade=1";
        return;
      }
  
      UI.setButtonLoading(triggerBtn, true);
  
      try {
        await loadRazorpayScript();
  
        const orderRes = await Api.Payment.createOrder(amount, "INR");
        const order = orderRes.data;
  
        const options = {
          key: order.key_id,
          order_id: order.orderId,
          amount: order.amount,
          currency: order.currency,
          name: "Genfo AI",
          description: "Genfo AI Pro Subscription",
          theme: { color: "#8c6bff" },
          handler: function (response) {
            verifyAndUpgrade(
              {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              },
              triggerBtn,
              onSuccess
            );
          },
          modal: {
            ondismiss: function () {
              UI.setButtonLoading(triggerBtn, false);
              UI.toast("Upgrade cancelled.", "info");
            },
          },
        };
  
        const rzp = new window.Razorpay(options);
        rzp.on("payment.failed", function (response) {
          UI.setButtonLoading(triggerBtn, false);
          const desc = response && response.error ? response.error.description : "Unknown error";
          UI.toast("Payment failed: " + desc, "error");
        });
        rzp.open();
      } catch (err) {
        UI.setButtonLoading(triggerBtn, false);
        UI.toast(err.message || "Couldn't start checkout.", "error");
      }
    }
  
    async function verifyAndUpgrade(payload, triggerBtn, onSuccess) {
      try {
        const result = await Api.Payment.verify(payload);
        Api.setUser(result.data.user);
        UI.toast("Payment verified — you're now on Pro!", "success");
        if (typeof onSuccess === "function") onSuccess(result.data.user);
      } catch (err) {
        UI.toast("Payment verification failed: " + err.message, "error");
      } finally {
        UI.setButtonLoading(triggerBtn, false);
      }
    }
  
    /**
     * Wires up every [data-action="upgrade"] button on the current page.
     * @param {(user: object) => void} onSuccess
     */
    function initUpgradeButtons(onSuccess) {
      document.querySelectorAll("[data-action='upgrade']").forEach((btn) => {
        btn.addEventListener("click", () => {
          const amount = Number(btn.dataset.amount || 99);
          startUpgrade(btn, amount, onSuccess);
        });
      });
    }
  
    /**
     * If the person just signed up after being redirected here mid-upgrade
     * (see startUpgrade's signup.html?upgrade=1 redirect), resume checkout
     * automatically. Call this once on signup success, after the token is stored.
     */
    function resumePendingUpgradeIfAny(onSuccess) {
      const pending = sessionStorage.getItem("genfoPendingUpgrade");
      if (!pending) return false;
      sessionStorage.removeItem("genfoPendingUpgrade");
      // No specific button to show a loading state on at this point — pass a
      // harmless no-op-safe stand-in by creating a detached button element.
      const ghostBtn = document.createElement("button");
      startUpgrade(ghostBtn, Number(pending), onSuccess);
      return true;
    }
  
    return { startUpgrade, initUpgradeButtons, resumePendingUpgradeIfAny };
  })();