// x402 Receipt Card — interactive prototype controller
// Wires up the state toggle, copy buttons, and toast.

(function () {
  "use strict";

  const card = document.querySelector(".receipt-card");
  const buttons = document.querySelectorAll(".state-btn");
  const toastRegion = document.getElementById("toast");

  if (!card || !buttons.length || !toastRegion) return;

  const stateConfig = {
    settled: {
      subtitle: "Settled · 3s ago",
      pillLabel: "Settled",
      amountValue: "12.500000",
      amountCurrency: "USDC",
      amountSecondary: "≈ $12.50 USD",
      txHash: "0xab12…cd34",
      ipfsLabel: "IPFS CID",
      ipfsValue: "bafy…xyz12",
      ipfsHref: "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
    },
    pending: {
      subtitle: "Pending · awaiting confirmation",
      pillLabel: "Pending…",
      amountValue: "12.500000",
      amountCurrency: "USDC",
      amountSecondary: "≈ $12.50 USD",
      txHash: "awaiting…",
      ipfsLabel: "IPFS CID",
      ipfsValue: "queueing…",
      ipfsHref: "#"
    },
    failed: {
      subtitle: "Failed · timeout after 30s",
      pillLabel: "Failed",
      amountValue: "12.500000",
      amountCurrency: "USDC",
      amountSecondary: "Not settled — funds returned to source",
      txHash: "n/a (timed out)",
      ipfsLabel: "Error Code",
      ipfsValue: "x402_timeout_exceeded",
      ipfsHref: "#"
    }
  };

  function setState(state) {
    if (!stateConfig[state]) return;
    const cfg = stateConfig[state];

    // Update card root
    card.setAttribute("data-state", state);

    // Update bindings
    const bindings = {
      "subtitle": cfg.subtitle,
      "pill-label": cfg.pillLabel,
      "amount-value": cfg.amountValue,
      "amount-currency": cfg.amountCurrency,
      "amount-secondary": cfg.amountSecondary,
      "tx-hash": cfg.txHash,
      "ipfs-label": cfg.ipfsLabel,
      "ipfs-value": cfg.ipfsValue
    };
    Object.keys(bindings).forEach(function (key) {
      const el = card.querySelector('[data-bind="' + key + '"]');
      if (el) el.textContent = bindings[key];
    });

    // IPFS link
    const ipfsLink = card.querySelector('[data-bind="ipfs-link"]');
    if (ipfsLink) ipfsLink.setAttribute("href", cfg.ipfsHref);

    // Update tab buttons
    buttons.forEach(function (btn) {
      const isActive = btn.getAttribute("data-state") === state;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });
  }

  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const state = btn.getAttribute("data-state");
      setState(state);
    });

    btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const states = ["settled", "pending", "failed"];
        const currentIndex = states.indexOf(btn.getAttribute("data-state"));
        const nextIndex = e.key === "ArrowRight"
          ? (currentIndex + 1) % states.length
          : (currentIndex - 1 + states.length) % states.length;
        const nextBtn = document.querySelector('.state-btn[data-state="' + states[nextIndex] + '"]');
        if (nextBtn) {
          nextBtn.click();
          nextBtn.focus();
        }
      }
    });
  });

  // Copy buttons
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    toastRegion.appendChild(toast);
    setTimeout(function () {
      toast.style.transition = "opacity 200ms ease";
      toast.style.opacity = "0";
      setTimeout(function () { toast.remove(); }, 200);
    }, 1500);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
    return Promise.resolve();
  }

  document.addEventListener("click", function (e) {
    const target = e.target.closest("[data-copy]");
    if (target) {
      e.preventDefault();
      const text = target.getAttribute("data-copy");
      copyToClipboard(text).then(function () {
        showToast("Copied to clipboard");
      });
    }
  });

  // Keyboard: card hover state via focus
  card.addEventListener("focusin", function () {
    card.style.borderColor = "var(--surface-hairline-strong)";
  });
  card.addEventListener("focusout", function () {
    card.style.borderColor = "";
  });
})();
