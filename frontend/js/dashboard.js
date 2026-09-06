/* ==========================================================================
   GENFO AI — DASHBOARD / APP LOGIC
   Covers dashboard.html (chat) and settings.html.

   Chat streams real responses from POST /api/chat, which the backend
   forwards to Groq (server-side, so the API key never reaches the browser).
   See services/groqService.js and controllers/chatController.js on the
   backend for the streaming implementation.

   The chat input is unified, ChatGPT-style: a message is auto-classified
   as either a normal chat turn (POST /api/chat, streamed) or an image
   request (POST /api/image/generate, returned as an image bubble).
   See isImageRequest() below for the detection rules.
   ========================================================================== */

   (function () {
    "use strict";
  
    document.addEventListener("DOMContentLoaded", () => {
      if (!requireAuth()) return;
  
      renderUserChrome();
      initSidebar();
      initProfileMenu();
      initLogout();
  
      if (document.querySelector(".chat-view")) initChat();
      if (document.querySelector(".settings-view")) initSettings();
    });
  
    /* ---- Route protection --------------------------------------------------- */
    function requireAuth() {
      if (!Api.isAuthenticated()) {
        window.location.href = "login.html";
        return false;
      }
      return true;
    }
  
    /* ---- Populate name/avatar/plan everywhere on the page --------------------- */
    function renderUserChrome() {
      const user = Api.getUser();
      if (!user) return;
  
      document.querySelectorAll("[data-user-name]").forEach((el) => (el.textContent = user.name));
      document.querySelectorAll("[data-user-email]").forEach((el) => (el.textContent = user.email));
      document.querySelectorAll("[data-user-initial]").forEach((el) => {
        el.textContent = (user.name || "?").trim().charAt(0).toUpperCase();
      });
      document.querySelectorAll("[data-user-plan]").forEach((el) => {
        el.textContent = user.subscriptionStatus === "pro" ? "Pro plan" : "Free plan";
      });
      document.querySelectorAll("[data-if-pro]").forEach((el) => {
        el.style.display = user.isPremium ? "" : "none";
      });
      document.querySelectorAll("[data-if-free]").forEach((el) => {
        el.style.display = user.isPremium ? "none" : "";
      });
    }
  
    /* ---- Sidebar (mobile open/close) ------------------------------------------- */
    function initSidebar() {
      const toggle = document.querySelector(".sidebar-mobile-toggle");
      const sidebar = document.querySelector(".sidebar");
      const backdrop = document.querySelector(".sidebar-backdrop");
      if (!toggle || !sidebar) return;
  
      const open = () => {
        sidebar.classList.add("is-open");
        if (backdrop) backdrop.classList.add("is-open");
      };
      const close = () => {
        sidebar.classList.remove("is-open");
        if (backdrop) backdrop.classList.remove("is-open");
      };
  
      toggle.addEventListener("click", () => {
        sidebar.classList.contains("is-open") ? close() : open();
      });
      if (backdrop) backdrop.addEventListener("click", close);
    }
  
    /* ---- Profile dropdown menu -------------------------------------------------- */
    function initProfileMenu() {
      const trigger = document.querySelector(".user-card");
      const menu = document.querySelector(".profile-menu");
      if (!trigger || !menu) return;
  
      trigger.setAttribute("aria-expanded", "false");
  
      function close() {
        menu.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
      }
      function toggle() {
        const isOpen = menu.classList.toggle("is-open");
        trigger.setAttribute("aria-expanded", String(isOpen));
      }
  
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        toggle();
      });
      document.addEventListener("click", (e) => {
        if (!menu.contains(e.target) && !trigger.contains(e.target)) close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
      });
    }
  
    /* ---- Logout ----------------------------------------------------------------- */
    function initLogout() {
      document.querySelectorAll("[data-action='logout']").forEach((btn) => {
        btn.addEventListener("click", async () => {
          // Revoke the token server-side first (so it can't be reused even if
          // copied out of storage/cache), then always clear local state and
          // redirect — even if the network call fails, the user must still
          // be able to log out of this device.
          try {
            await Api.Auth.logout();
          } catch (err) {
            console.warn("Server-side logout failed, clearing local session anyway:", err.message);
          }
          Api.logout();
          window.location.href = "login.html";
        });
      });
    }
  
    /* =====================================================================
       IMAGE-REQUEST DETECTION
       Keyword/phrase based classifier that decides whether a typed message
       should go to the image endpoint instead of the chat endpoint.
       ===================================================================== */
  
    const IMAGE_TRIGGER_PATTERNS = [
      /\b(generate|create|make|draw|paint|render|sketch)\b.*\b(image|picture|photo|logo|wallpaper|portrait|illustration|artwork|icon|avatar|cover art|concept art)\b/,
      /\b(image|picture|photo)\s+of\b/,
      /\bdraw\s+(me|a|an|the)\b/,
      /\bpaint\s+(me|a|an|the)\b/,
      /\billustrat(e|ion)\b/,
      /\bconcept art\b/,
      /\bcover art\b/,
      /\b(create|make|design)\s+a\s+logo\b/,
      /\bwallpaper\b/,
      /\bportrait\b/,
      /\brender\s+(me|a|an|the)\b/
    ];
  
    function isImageRequest(text) {
      const lower = text.toLowerCase();
      return IMAGE_TRIGGER_PATTERNS.some((pattern) => pattern.test(lower));
    }
  
    // Phrases that mean "change this image I uploaded" rather than
    // "create a brand new image from scratch" — only meaningful when an
    // image is actually attached to the message.
    const EDIT_TRIGGER_PATTERNS = [
      /\bremove\s+(the\s+)?background\b/,
      /\bchange\s+(the\s+)?(color|colour|hair|hairstyle|background|sky)\b/,
      /\bmake\s+(it|this)\s+(realistic|anime|cartoon|black and white|colou?r)\b/,
      /\bturn\s+(it|this)\s+into\b/,
      /\breplace\s+(the\s+)?(sky|background)\b/,
      /\badd\s+(glasses|a hat|a background)\b/,
      /\bincrease\s+(the\s+)?quality\b/,
      /\brestore\s+(this|the)\s+(old\s+)?photo\b/,
      /\bupscale\b/,
      /\bgenerate\s+variations?\b/,
      /\bedit\s+this\s+image\b/,
      /\bimprove\s+(this|the)\s+(logo|image|photo)\b/,
    ];

    function isEditRequest(text) {
      const lower = text.toLowerCase();
      return EDIT_TRIGGER_PATTERNS.some((pattern) => pattern.test(lower));
    }
  
    /* =====================================================================
       CHAT VIEW
       Streams real responses from POST /api/chat (Groq, via the backend),
       or renders an image bubble via POST /api/image/generate when the
       typed message looks like an image request.
       ===================================================================== */
    function initChat() {
      const scrollEl = document.querySelector(".chat-scroll");
      const threadEl = document.querySelector(".chat-thread");
      const emptyEl = document.querySelector(".chat-empty");
      const form = document.querySelector(".chat-input-bar");
      const textarea = form ? form.querySelector("textarea") : null;
      const sendBtn = form ? form.querySelector(".chat-send-btn") : null;
      const fileInput = form ? form.querySelector(".chat-file-input") : null;
      const attachBtn = form ? form.querySelector(".chat-attach-btn") : null;
      const trayEl = document.querySelector(".attachment-tray");
      const chatViewEl = document.querySelector(".chat-view");
      const historyEl = document.querySelector(".sidebar-history");
      const newChatBtn = document.querySelector("[data-action='new-chat']");
      const memoryListEl = document.querySelector(".memory-list");
      const clearMemoryBtn = document.querySelector("[data-action='clear-memory']");
  
      if (!form || !textarea) return;
  
      let isBusy = false; // true while either a chat stream or an image request is in flight
      let currentConversationId = null; // null until the backend assigns one (first turn of a new chat)
      let historyItems = []; // cached sidebar conversation list
      const conversationHistory = []; // [{role: 'user'|'assistant', content: string}, ...] — text turns only

      // Attachments stay "active" for the whole conversation (not just one
      // turn) so the user doesn't have to re-upload the same file to
      // reference it again later.
      const attachments = []; // [{id, name, ext, category, sizeBytes, preview, thumbnailUrl, status}]
      initAttachments();
      initChatHistory();
      initMemoryPanel();

  
      // Auto-grow textarea
      textarea.addEventListener("input", () => {
        textarea.style.height = "auto";
        textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
        sendBtn.disabled = textarea.value.trim().length === 0 || isBusy;
      });
  
      // Enter to send, Shift+Enter for newline
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          form.requestSubmit ? form.requestSubmit() : handleSend();
        }
      });
  
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        handleSend();
      });
  
      document.querySelectorAll(".suggestion-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          textarea.value = chip.textContent.trim();
          textarea.dispatchEvent(new Event("input"));
          handleSend();
        });
      });
  
      async function handleSend() {
        const text = textarea.value.trim();
        const readyAttachments = attachments.filter((a) => a.status === "ready");
        if ((!text && !readyAttachments.length) || isBusy) return;
  
        if (emptyEl) emptyEl.style.display = "none";
        threadEl.style.display = "flex";
  
        appendMessage("user", text || "(sent with attachments)", { attachments: readyAttachments });
  
        textarea.value = "";
        textarea.style.height = "auto";
        sendBtn.disabled = true;
        isBusy = true;
  
        // An uploaded image + a generation phrase like "draw a cat" should
        // still go to image gen. An uploaded image + an edit phrase like
        // "remove the background" goes to the image-edit flow (describe +
        // regenerate). Anything else with an attached image goes to the
        // vision-capable chat model for analysis/explanation.
        const imageAttachment = readyAttachments.find((a) => a.category === "image");
        if (imageAttachment && isEditRequest(text)) {
          await handleImageEdit(text, imageAttachment);
        } else if (isImageRequest(text) && !imageAttachment) {
          await handleImageGeneration(text);
        } else {
          conversationHistory.push({ role: "user", content: text });
          await handleChatStream(text, readyAttachments);
        }
  
        isBusy = false;
        sendBtn.disabled = textarea.value.trim().length === 0;
        scrollToBottom();
      }
  
      /* ---- Normal streaming chat turn ---- */
      async function handleChatStream(text, turnAttachments = []) {
        const aiMsgEl = appendMessage("ai", "", { pending: true });
        let fullReply = "";
        let firstTokenReceived = false;
        const attachmentIds = turnAttachments.map((a) => a.id);
  
        try {
          await Api.streamChat(
            text,
            conversationHistory.slice(0, -1),
            (token) => {
              if (!firstTokenReceived) {
                // Replace the typing-dots placeholder with the real text container
                // the moment the first token arrives.
                aiMsgEl.innerHTML = '<span class="chat-cursor"></span>';
                firstTokenReceived = true;
              }
              fullReply += token;
              aiMsgEl.innerHTML = UI.escapeHtml(fullReply) + '<span class="chat-cursor"></span>';
              scrollToBottom();
            },
            attachmentIds,
            currentConversationId,
            (meta) => {
              // First frame of the stream: which conversation this turn
              // belongs to. Capture it so the rest of this chat (and any
              // follow-up turn) stays in the same conversation, and so the
              // sidebar can show/update it immediately.
              currentConversationId = meta.conversationId;
              upsertHistoryEntry({ id: meta.conversationId, title: meta.title, preview: text, updatedAt: new Date().toISOString() });
            }
          );
  
          conversationHistory.push({ role: "assistant", content: fullReply });
          renderMessageContent(aiMsgEl, fullReply); // splits fenced code into its own panel, like the image bubble

          // New facts may have been picked up from this turn — refresh the
          // memory panel so it reflects what Genfo AI now remembers.
          refreshMemoryPanel();
        } catch (err) {
          aiMsgEl.closest(".chat-msg").classList.add("is-error");
          aiMsgEl.innerHTML = UI.escapeHtml(describeChatError(err));
          UI.toast(describeChatError(err), "error");
        }
      }
  
      /* ---- Image generation turn ---- */
      async function handleImageGeneration(prompt) {
        const bubbleEl = appendImageBubble();
        await runImageGeneration(bubbleEl, prompt);
      }

      /* ---- Image edit turn (describe uploaded image + regenerate) ---- */
      async function handleImageEdit(instruction, imageAttachment) {
        const bubbleEl = appendImageBubble();
        await runImageGeneration(bubbleEl, instruction, imageAttachment);
      }
  
      async function runImageGeneration(bubbleEl, prompt, imageAttachment = null) {
        setImageBubbleLoading(bubbleEl);
        try {
          const result = imageAttachment
            ? await Api.editImage(imageAttachment.id, prompt, "square", currentConversationId)
            : await Api.generateImage(prompt, "square", currentConversationId);
          if (result.conversationId) {
            currentConversationId = result.conversationId;
            upsertHistoryEntry({ id: result.conversationId, title: prompt, preview: "🖼️ " + prompt, updatedAt: new Date().toISOString() });
          }
          setImageBubbleResult(bubbleEl, prompt, result, imageAttachment);
        } catch (err) {
          setImageBubbleError(bubbleEl, prompt, err, imageAttachment);
          UI.toast(describeImageError(err), "error");
          if (err?.status === 429 && err?.upgrade) {
            const overlay = UI.openUpgradeModal({
              title: "Daily image limit reached",
              message: err.message || "You've reached today's free-plan image limit. Upgrade to Pro for unlimited image generation.",
            });
            Billing.initUpgradeButtons(() => overlay.remove());
          }
        } finally {
          scrollToBottom();
        }
      }
  
      /* =====================================================================
         FILE ATTACHMENTS
         Attach button, drag & drop, paste, upload progress, thumbnails,
         remove/retry. Attachments stay in the tray for the whole
         conversation (not just the next message) until removed.
         ===================================================================== */
      function initAttachments() {
        if (!fileInput || !attachBtn) return;

        attachBtn.addEventListener("click", () => fileInput.click());
        fileInput.addEventListener("change", () => {
          if (fileInput.files.length) uploadNewFiles(fileInput.files);
          fileInput.value = ""; // allow re-selecting the same file later
        });

        // Drag & drop anywhere over the chat view
        if (chatViewEl) {
          ["dragenter", "dragover"].forEach((evt) =>
            chatViewEl.addEventListener(evt, (e) => {
              e.preventDefault();
              chatViewEl.classList.add("is-drag-over");
            })
          );
          ["dragleave", "drop"].forEach((evt) =>
            chatViewEl.addEventListener(evt, (e) => {
              e.preventDefault();
              chatViewEl.classList.remove("is-drag-over");
            })
          );
          chatViewEl.addEventListener("drop", (e) => {
            const files = e.dataTransfer?.files;
            if (files && files.length) uploadNewFiles(files);
          });
        }

        // Paste an image straight from the clipboard (common for screenshots)
        textarea.addEventListener("paste", (e) => {
          const items = Array.from(e.clipboardData?.items || []);
          const imageFiles = items.filter((it) => it.kind === "file" && it.type.startsWith("image/")).map((it) => it.getAsFile());
          if (imageFiles.length) uploadNewFiles(imageFiles);
        });
      }

      async function uploadNewFiles(fileList) {
        const files = Array.from(fileList);
        const remainingSlots = Api.Attachments.MAX_ATTACHMENTS_PER_UPLOAD - attachments.length;
        if (remainingSlots <= 0) {
          UI.toast(`You can attach up to ${Api.Attachments.MAX_ATTACHMENTS_PER_UPLOAD} files at once.`, "error");
          return;
        }

        const toUpload = files.slice(0, remainingSlots);

        // Show optimistic "uploading" placeholders immediately.
        const placeholders = toUpload.map((file) => ({
          tempId: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          sizeBytes: file.size,
          status: "uploading",
          progress: 0,
        }));
        placeholders.forEach((p) => attachments.push(p));
        renderTray();

        try {
          const result = await Api.Attachments.upload(toUpload, (pct) => {
            placeholders.forEach((p) => (p.progress = pct));
            renderTray();
          });

          // Swap placeholders out for the real, uploaded attachment records.
          const uploaded = result.attachments || [];
          placeholders.forEach((p, i) => {
            const idx = attachments.indexOf(p);
            if (idx === -1) return;
            const match = uploaded[i];
            if (match) {
              attachments[idx] = { ...match, status: "ready" };
            } else {
              attachments.splice(idx, 1); // this particular file failed — remove its placeholder
            }
          });

          (result.failures || []).forEach((f) => UI.toast(`${f.name}: ${f.error}`, "error"));
        } catch (err) {
          placeholders.forEach((p) => {
            p.status = "error";
            p.error = describeChatError(err);
          });
          UI.toast(describeChatError(err), "error");
        }

        renderTray();
      }

      function removeAttachment(idOrTemp) {
        const idx = attachments.findIndex((a) => a.id === idOrTemp || a.tempId === idOrTemp);
        if (idx !== -1) attachments.splice(idx, 1);
        renderTray();
      }

      function renderTray() {
        if (!trayEl) return;

        if (!attachments.length) {
          trayEl.style.display = "none";
          trayEl.innerHTML = "";
          return;
        }

        trayEl.style.display = "flex";
        trayEl.innerHTML = attachments
          .map((a) => {
            const key = a.id || a.tempId;
            const sizeLabel = a.sizeBytes ? `${(a.sizeBytes / 1024).toFixed(0)}KB` : "";

            if (a.status === "uploading") {
              return `
                <div class="attachment-chip is-uploading" data-key="${key}">
                  <span class="attachment-chip-name">${UI.escapeHtml(a.name)}</span>
                  <div class="attachment-progress"><div class="attachment-progress-bar" style="width:${a.progress || 0}%"></div></div>
                  <button type="button" class="attachment-chip-remove" data-key="${key}" aria-label="Cancel upload">&times;</button>
                </div>`;
            }

            if (a.status === "error") {
              return `
                <div class="attachment-chip is-error" data-key="${key}">
                  <span class="attachment-chip-name">${UI.escapeHtml(a.name)}</span>
                  <span class="attachment-chip-error" title="${UI.escapeHtml(a.error || "Upload failed")}">Failed</span>
                  <button type="button" class="attachment-chip-retry" data-key="${key}">Retry</button>
                  <button type="button" class="attachment-chip-remove" data-key="${key}" aria-label="Remove">&times;</button>
                </div>`;
            }

            return `
              <div class="attachment-chip is-ready" data-key="${key}">
                ${a.category === "image" && a.thumbnailUrl ? `<img class="attachment-chip-thumb" src="${a.thumbnailUrl}" alt="" />` : `<span class="attachment-chip-icon">${fileIconFor(a.category)}</span>`}
                <span class="attachment-chip-name" title="${UI.escapeHtml(a.preview || a.name)}">${UI.escapeHtml(a.name)}</span>
                <span class="attachment-chip-size">${sizeLabel}</span>
                <button type="button" class="attachment-chip-remove" data-key="${key}" aria-label="Remove attachment">&times;</button>
              </div>`;
          })
          .join("");

        trayEl.querySelectorAll(".attachment-chip-remove").forEach((btn) => {
          btn.addEventListener("click", () => removeAttachment(btn.dataset.key));
        });
        trayEl.querySelectorAll(".attachment-chip-retry").forEach((btn) => {
          btn.addEventListener("click", () => {
            const failed = attachments.find((a) => (a.id || a.tempId) === btn.dataset.key);
            if (!failed) return;
            removeAttachment(btn.dataset.key);
            // Re-uploading requires the original File object, which we don't
            // keep around for memory reasons — so retry just re-opens the
            // file picker rather than silently re-sending stale bytes.
            fileInput.click();
          });
        });
      }

      function fileIconFor(category) {
        if (category === "document") return "📄";
        if (category === "code") return "💻";
        return "📎";
      }
  
      /* =====================================================================
         CHAT HISTORY SIDEBAR (real — backed by GET/PATCH/DELETE
         /api/chat/conversations, not placeholder links)
         ===================================================================== */
      function initChatHistory() {
        if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);
        if (!historyEl) return;
        loadConversationList();
      }

      async function loadConversationList() {
        try {
          historyItems = await Api.Conversations.list();
          renderHistoryList();
        } catch (err) {
          // Sidebar history is a nice-to-have on page load — fail quietly
          // rather than toast the user before they've even sent a message.
          console.error("Failed to load conversation history:", err);
        }
      }

      // Adds a brand-new conversation to the sidebar, or updates/reorders an
      // existing one — called right after the backend tells us which
      // conversation a turn landed in, so the sidebar reflects reality
      // without needing a full reload of the list.
      function upsertHistoryEntry(entry) {
        const idx = historyItems.findIndex((h) => String(h.id) === String(entry.id));
        if (idx === -1) {
          historyItems.unshift({ pinned: false, ...entry });
        } else {
          const merged = { ...historyItems[idx], ...entry };
          historyItems.splice(idx, 1);
          historyItems.unshift(merged);
        }
        renderHistoryList();
      }

      function renderHistoryList() {
        if (!historyEl) return;

        if (!historyItems.length) {
          historyEl.innerHTML = `<p class="history-empty">${UI.escapeHtml(historyEl.dataset.emptyLabel || "No conversations yet")}</p>`;
          return;
        }

        const sorted = [...historyItems].sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
          return new Date(b.updatedAt) - new Date(a.updatedAt);
        });

        historyEl.innerHTML = sorted
          .map(
            (h) => `
            <div class="history-item ${String(h.id) === String(currentConversationId) ? "is-active" : ""}" data-id="${h.id}">
              <span class="history-item-title">${UI.escapeHtml(h.title || "New Chat")}</span>
              <button type="button" class="history-item-delete" data-id="${h.id}" aria-label="Delete conversation">&times;</button>
            </div>`
          )
          .join("");

        historyEl.querySelectorAll(".history-item").forEach((el) => {
          el.addEventListener("click", (e) => {
            if (e.target.closest(".history-item-delete")) return;
            openConversation(el.dataset.id);
          });
        });
        historyEl.querySelectorAll(".history-item-delete").forEach((btn) => {
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            try {
              await Api.Conversations.remove(id);
              historyItems = historyItems.filter((h) => String(h.id) !== String(id));
              if (String(currentConversationId) === String(id)) startNewChat();
              renderHistoryList();
            } catch (err) {
              UI.toast(err.message || "Couldn't delete that conversation.", "error");
            }
          });
        });
      }

      // Loads a past conversation's full messages and replays them into the
      // thread — text turns, and image turns as real image bubbles.
      async function openConversation(id) {
        if (isBusy) return;
        try {
          const conversation = await Api.Conversations.get(id);
          currentConversationId = conversation.id;
          conversationHistory.length = 0;
          threadEl.innerHTML = "";
          threadEl.style.display = "flex";
          if (emptyEl) emptyEl.style.display = "none";

          conversation.messages.forEach((m) => {
            if (m.role === "user") {
              appendMessage("user", m.content, {
                attachments: (m.attachments || []).map((a) => ({ name: a.name, category: a.category })),
              });
              conversationHistory.push({ role: "user", content: m.content });
            } else if (m.role === "assistant") {
              const el = appendMessage("ai", "");
              renderMessageContent(el, m.content);
              conversationHistory.push({ role: "assistant", content: m.content });
            } else if (m.role === "image") {
              const bubbleEl = appendImageBubble();
              setImageBubbleResult(bubbleEl, m.prompt || "", {
                url: m.imageUrl,
                unlimited: false,
                remaining: null,
                limit: null,
              });
            }
          });

          scrollToBottom();
          renderHistoryList();
          closeSidebarOnMobile();
        } catch (err) {
          UI.toast(err.message || "Couldn't load that conversation.", "error");
        }
      }

      function startNewChat() {
        if (isBusy) return;
        currentConversationId = null;
        conversationHistory.length = 0;
        attachments.length = 0;
        renderTray();
        threadEl.innerHTML = "";
        threadEl.style.display = "none";
        if (emptyEl) emptyEl.style.display = "";
        textarea.value = "";
        textarea.style.height = "auto";
        sendBtn.disabled = true;
        renderHistoryList();
        closeSidebarOnMobile();
        textarea.focus();
      }

      function closeSidebarOnMobile() {
        const sidebar = document.querySelector(".sidebar");
        const backdrop = document.querySelector(".sidebar-backdrop");
        if (sidebar) sidebar.classList.remove("is-open");
        if (backdrop) backdrop.classList.remove("is-open");
      }

      /* =====================================================================
         MEMORY PANEL (real — backed by GET/DELETE /api/memory; facts are
         extracted server-side from what you say and reused in every future
         conversation, not just stored locally in this tab)
         ===================================================================== */
      function initMemoryPanel() {
        if (clearMemoryBtn) {
          clearMemoryBtn.addEventListener("click", async () => {
            try {
              await Api.Memory.clear();
              renderMemoryList([]);
            } catch (err) {
              UI.toast(err.message || "Couldn't clear memory.", "error");
            }
          });
        }
        if (!memoryListEl) return;
        refreshMemoryPanel();
      }

      async function refreshMemoryPanel() {
        if (!memoryListEl) return;
        try {
          const items = await Api.Memory.list();
          renderMemoryList(items);
        } catch (err) {
          console.error("Failed to load memory:", err);
        }
      }

      function renderMemoryList(items) {
        if (!memoryListEl) return;

        if (!items.length) {
          memoryListEl.innerHTML = `<p class="mem-empty">${UI.escapeHtml(memoryListEl.dataset.emptyLabel || "No memory yet")}</p>`;
          return;
        }

        memoryListEl.innerHTML = items
          .map(
            (m) => `
            <div class="memory-chip" data-id="${m.id}">
              <span class="memory-chip-text" title="${UI.escapeHtml(m.text)}">${UI.escapeHtml(m.text)}</span>
              <button type="button" class="memory-chip-remove" data-id="${m.id}" aria-label="Forget this">&times;</button>
            </div>`
          )
          .join("");

        memoryListEl.querySelectorAll(".memory-chip-remove").forEach((btn) => {
          btn.addEventListener("click", async () => {
            try {
              await Api.Memory.remove(btn.dataset.id);
              refreshMemoryPanel();
            } catch (err) {
              UI.toast(err.message || "Couldn't forget that.", "error");
            }
          });
        });
      }
  
      function appendMessage(role, text, opts = {}) {
        const wrap = document.createElement("div");
        wrap.className = `chat-msg is-${role}`;
  
        const avatar =
          role === "ai"
            ? `<div class="chat-msg-avatar is-ai">${ICON_SPARK}</div>`
            : `<div class="avatar chat-msg-avatar">${UI.escapeHtml((Api.getUser()?.name || "?").charAt(0))}</div>`;
  
        const attachmentChips =
          opts.attachments && opts.attachments.length
            ? `<div class="msg-attachment-chips">${opts.attachments
                .map(
                  (a) => `
                <span class="msg-attachment-chip">
                  ${a.category === "image" && a.thumbnailUrl ? `<img src="${a.thumbnailUrl}" alt="" />` : ""}
                  <span>${UI.escapeHtml(a.name)}</span>
                </span>`
                )
                .join("")}</div>`
            : "";
  
        wrap.innerHTML = `
          ${avatar}
          <div class="chat-msg-body">
            <div class="chat-msg-name">${role === "ai" ? "Genfo AI" : "You"}</div>
            ${attachmentChips}
            <div class="chat-msg-text">${opts.pending ? '<span class="typing-dots"><span></span><span></span><span></span></span>' : UI.escapeHtml(text)}</div>
          </div>
        `;
        threadEl.appendChild(wrap);
        scrollToBottom();
        return wrap.querySelector(".chat-msg-text");
      }
  
      function appendImageBubble() {
        const wrap = document.createElement("div");
        wrap.className = "chat-msg is-ai is-image";
        wrap.innerHTML = `
          ${`<div class="chat-msg-avatar is-ai">${ICON_SPARK}</div>`}
          <div class="chat-msg-body">
            <div class="chat-msg-name">Genfo AI</div>
            <div class="image-bubble" data-state="loading"></div>
          </div>
        `;
        threadEl.appendChild(wrap);
        scrollToBottom();
        return wrap.querySelector(".image-bubble");
      }
  
      function setImageBubbleLoading(bubbleEl) {
        bubbleEl.dataset.state = "loading";
        bubbleEl.innerHTML = `
          <div class="image-bubble-loading">
            <span class="typing-dots"><span></span><span></span><span></span></span>
            <span class="image-bubble-loading-text">Generating image…</span>
          </div>
        `;
      }
  
      function setImageBubbleResult(bubbleEl, prompt, result, imageAttachment = null) {
        bubbleEl.dataset.state = "done";
  
        const remainingLabel =
          !result.unlimited && result.remaining !== null && result.remaining !== undefined
            ? `${UI.escapeHtml(result.remaining)}${result.limit ? ` / ${UI.escapeHtml(result.limit)}` : ""} left today`
            : "";

        const planBadge = result.unlimited
          ? `<span class="image-bubble-badge">PRO · UNLIMITED</span>`
          : "";

        bubbleEl.innerHTML = `
          <img class="image-bubble-img" src="${result.url}" alt="${UI.escapeHtml(prompt)}" />
          <div class="image-bubble-actions">
            <button type="button" class="image-bubble-btn" data-action="download">Download</button>
            <button type="button" class="image-bubble-btn" data-action="regenerate">Regenerate</button>
            <button type="button" class="image-bubble-btn" data-action="copy-prompt">Copy Prompt</button>
            ${planBadge}
            ${remainingLabel ? `<span class="image-bubble-remaining">${remainingLabel}</span>` : ""}
          </div>
        `;
  
        bubbleEl.querySelector("[data-action='download']").addEventListener("click", () => {
          downloadImage(result.url, prompt);
        });
        bubbleEl.querySelector("[data-action='regenerate']").addEventListener("click", () => {
          runImageGeneration(bubbleEl, prompt, imageAttachment);
        });
        bubbleEl.querySelector("[data-action='copy-prompt']").addEventListener("click", () => {
          copyPromptToClipboard(prompt);
        });
      }
  
      function setImageBubbleError(bubbleEl, prompt, err, imageAttachment = null) {
        bubbleEl.dataset.state = "error";
        bubbleEl.innerHTML = `
          <div class="image-bubble-error">${UI.escapeHtml(describeImageError(err))}</div>
          <div class="image-bubble-actions">
            <button type="button" class="image-bubble-btn" data-action="retry">Try Again</button>
          </div>
        `;
        bubbleEl.querySelector("[data-action='retry']").addEventListener("click", () => {
          runImageGeneration(bubbleEl, prompt, imageAttachment);
        });
      }
  
      function scrollToBottom() {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    }
  
    /* ---- Shared helpers: download, clipboard, filenames ---- */
    function downloadImage(url, prompt) {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugify(prompt)}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  
    function slugify(text) {
      const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-+|-+$)/g, "")
        .slice(0, 60);
      return slug || "genfo-image";
    }
  
    async function copyPromptToClipboard(prompt) {
      try {
        await navigator.clipboard.writeText(prompt);
        UI.toast("Prompt copied to clipboard.", "success");
      } catch {
        UI.toast("Couldn't copy the prompt.", "error");
      }
    }
  
    /* =====================================================================
       CODE BLOCKS
       AI replies are scanned for fenced code (```lang ... ```) and each
       fence is rendered as its own panel — separate from the prose text —
       the same way image generations get their own bubble. Supports copy
       and download; syntax highlighting is applied via highlight.js if
       it's loaded (see the CDN <script> in dashboard.html).
       ===================================================================== */
    function renderMessageContent(container, text) {
      container.innerHTML = "";
      const segments = parseCodeSegments(text);

      segments.forEach((seg) => {
        if (seg.type === "code") {
          container.appendChild(buildCodeBlock(seg.lang, seg.code));
        } else if (seg.content.trim() !== "" || segments.length === 1) {
          const p = document.createElement("div");
          p.className = "chat-msg-paragraph";
          p.innerHTML = UI.escapeHtml(seg.content);
          container.appendChild(p);
        }
      });
    }

    function parseCodeSegments(text) {
      const segments = [];
      const fenceRegex = /```(\w+)?\n?([\s\S]*?)```/g;
      let lastIndex = 0;
      let match;

      while ((match = fenceRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
        }
        segments.push({
          type: "code",
          lang: (match[1] || "plaintext").toLowerCase(),
          code: match[2].replace(/\n$/, ""),
        });
        lastIndex = fenceRegex.lastIndex;
      }

      if (lastIndex < text.length) {
        segments.push({ type: "text", content: text.slice(lastIndex) });
      }
      if (segments.length === 0) {
        segments.push({ type: "text", content: text });
      }
      return segments;
    }

    function buildCodeBlock(lang, code) {
      const wrap = document.createElement("div");
      wrap.className = "code-block";
      wrap.innerHTML = `
        <div class="code-block-header">
          <span class="code-block-lang">${UI.escapeHtml(langLabel(lang))}</span>
          <div class="code-block-actions">
            <button type="button" class="code-block-btn" data-action="copy">Copy</button>
            <button type="button" class="code-block-btn" data-action="download">Download</button>
          </div>
        </div>
        <pre class="code-block-pre"><code class="language-${UI.escapeHtml(lang)}"></code></pre>
      `;

      const codeEl = wrap.querySelector("code");
      codeEl.textContent = code; // textContent, not innerHTML — never trust model output as markup

      wrap.querySelector("[data-action='copy']").addEventListener("click", (e) => {
        copyCodeToClipboard(code, e.currentTarget);
      });
      wrap.querySelector("[data-action='download']").addEventListener("click", () => {
        downloadCode(code, lang);
      });

      if (window.hljs) {
        try {
          window.hljs.highlightElement(codeEl);
        } catch (_) {
          // Unknown language to hljs — leave it unhighlighted rather than crash rendering.
        }
      }

      return wrap;
    }

    const LANG_LABELS = {
      js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript",
      py: "Python", python: "Python", html: "HTML", css: "CSS", json: "JSON",
      bash: "Bash", sh: "Shell", shell: "Shell", java: "Java", c: "C", cpp: "C++", "c++": "C++",
      cs: "C#", csharp: "C#", go: "Go", rust: "Rust", rs: "Rust", php: "PHP",
      ruby: "Ruby", rb: "Ruby", sql: "SQL", yaml: "YAML", yml: "YAML",
      md: "Markdown", markdown: "Markdown", jsx: "JSX", tsx: "TSX", plaintext: "Plain Text",
    };
    const LANG_EXTENSIONS = {
      js: "js", javascript: "js", ts: "ts", typescript: "ts", py: "py", python: "py",
      html: "html", css: "css", json: "json", bash: "sh", sh: "sh", shell: "sh",
      java: "java", c: "c", cpp: "cpp", "c++": "cpp", cs: "cs", csharp: "cs",
      go: "go", rust: "rs", rs: "rs", php: "php", ruby: "rb", rb: "rb",
      sql: "sql", yaml: "yml", yml: "yml", md: "md", markdown: "md", jsx: "jsx", tsx: "tsx",
    };

    function langLabel(lang) {
      return LANG_LABELS[lang] || lang.toUpperCase();
    }

    function downloadCode(code, lang) {
      const ext = LANG_EXTENSIONS[lang] || "txt";
      const blob = new Blob([code], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `genfo-snippet.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    async function copyCodeToClipboard(code, btn) {
      try {
        await navigator.clipboard.writeText(code);
        const original = btn.textContent;
        btn.textContent = "Copied!";
        btn.classList.add("is-copied");
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove("is-copied");
        }, 1600);
      } catch {
        UI.toast("Couldn't copy the code.", "error");
      }
    }

    /* ---- Shared error-to-message mapping ---- */
    function describeChatError(err) {
      return describeRequestError(err, {
        forbidden: "You don't have access to chat on your current plan.",
        rateLimited: "You've hit your chat limit for now. Please try again shortly.",
        serverError: "Something went wrong generating a response. Please try again."
      });
    }
  
    function describeImageError(err) {
      return describeRequestError(err, {
        forbidden: "You don't have permission to generate images on your current plan.",
        rateLimited: "You've reached your image generation limit for today. Try again later or upgrade your plan.",
        serverError: "Something went wrong on our end while generating the image. Please try again."
      });
    }
  
    function describeRequestError(err, messages) {
      if (err?.isNetworkError) {
        return "Can't reach Genfo AI. Check your internet connection and try again.";
      }
      if (err?.isTimeout) {
        return "That took too long and timed out. Please try again.";
      }
  
      switch (err?.status) {
        case 401:
          return "Your session has expired. Please log in again.";
        case 403:
          return messages.forbidden;
        case 429:
          return messages.rateLimited;
        case 500:
          return messages.serverError;
        default:
          return err?.message || "Something went wrong. Please try again.";
      }
    }
  
    const ICON_SPARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  
    /* =====================================================================
       SETTINGS VIEW — account info + Razorpay upgrade flow
       ===================================================================== */
    function initSettings() {
      renderSettingsAccount();
      initUpgradeFlow();
    }
  
    function renderSettingsAccount() {
      const user = Api.getUser();
      if (!user) return;
      const nameEl = document.querySelector("[data-settings-name]");
      const emailEl = document.querySelector("[data-settings-email]");
      const joinedEl = document.querySelector("[data-settings-joined]");
      if (nameEl) nameEl.textContent = user.name;
      if (emailEl) emailEl.textContent = user.email;
      if (joinedEl && user.createdAt) {
        joinedEl.textContent = new Date(user.createdAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      }
    }
  
    /* ---- Plan & billing (Razorpay upgrade) — see js/billing.js for the shared flow */
    function initUpgradeFlow() {
      Billing.initUpgradeButtons((user) => {
        renderUserChrome();
        renderSettingsAccount();
      });
    }
  })();