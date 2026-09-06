/* ==========================================================================
   GENFO AI — API CLIENT

   Handles:
   - Authentication
   - Payments
   - Streaming Chat (Groq)
   - Image Generation

   Backend:
   /api/chat
   /api/image/generate

   All thrown errors carry extra metadata so callers (dashboard.js) can
   branch on failure type without re-parsing messages:
     err.status          -> HTTP status code, if the server responded
     err.isNetworkError   -> true if fetch itself failed (offline/DNS/CORS)
     err.isTimeout        -> true if the request was aborted by our timeout
   ========================================================================== */

   const Api = (() => {

    const BASE_URL =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:5000/api"
    : "https://genfo-ai-pro.onrender.com/api";
  
    const TOKEN_KEY = "genfoToken";
    const USER_KEY = "genfoUser";
  
    const CHAT_TIMEOUT_MS = 60000;   // streaming responses can legitimately take a while
    const IMAGE_TIMEOUT_MS = 45000;  // image generation is slower than a single chat token
  
    /* ==========================================================
       STORAGE
       ========================================================== */
  
    function getToken() {
      return localStorage.getItem(TOKEN_KEY);
    }
  
    function setToken(token) {
      localStorage.setItem(TOKEN_KEY, token);
    }
  
    function clearToken() {
      localStorage.removeItem(TOKEN_KEY);
    }
  
    function getUser() {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
  
    function setUser(user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  
    function clearUser() {
      localStorage.removeItem(USER_KEY);
    }
  
    function isAuthenticated() {
      return Boolean(getToken());
    }
  
    function logout() {
      clearToken();
      clearUser();
    }
  
    /* ==========================================================
       ERROR HELPERS
       ========================================================== */
  
    function makeError(message, { status = null, isNetworkError = false, isTimeout = false } = {}) {
      const err = new Error(message);
      err.status = status;
      err.isNetworkError = isNetworkError;
      err.isTimeout = isTimeout;
      return err;
    }
  
    // Runs a fetch with a hard timeout, normalizing abort/network failures
    // into the makeError() shape so every caller sees the same fields.
    async function fetchWithTimeout(url, options, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
  
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } catch (err) {
        if (err.name === "AbortError") {
          throw makeError("The request timed out. Please try again.", { isTimeout: true });
        }
        throw makeError("Can't reach the Genfo AI server. Check your connection.", { isNetworkError: true });
      } finally {
        clearTimeout(timer);
      }
    }
  
    /* ==========================================================
       REQUEST HELPER (plain JSON endpoints — auth, payments, etc.)
       ========================================================== */
  
    async function request(path, { method = "GET", body = null, auth = false } = {}) {
      const headers = { "Content-Type": "application/json" };
  
      if (auth) {
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
  
      const response = await fetchWithTimeout(
        `${BASE_URL}${path}`,
        {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined
        },
        CHAT_TIMEOUT_MS
      );
  
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // no/invalid JSON body — payload stays null
      }
  
      if (!response.ok) {
        throw makeError(payload?.message || `Request failed (${response.status})`, {
          status: response.status
        });
      }
  
      return payload;
    }
  
    /* ==========================================================
       AUTH
       ========================================================== */
  
    const Auth = {
      signup(name, email, password) {
        return request("/auth/signup", { method: "POST", body: { name, email, password } });
      },
  
      login(email, password) {
        return request("/auth/login", { method: "POST", body: { email, password } });
      },
  
      me() {
        return request("/auth/me", { auth: true });
      },
  
      google(idToken) {
        return request("/auth/google", { method: "POST", body: { idToken } });
      },
  
      logout() {
        return request("/auth/logout", { method: "POST", auth: true });
      }
    };
  
    /* ==========================================================
       PAYMENTS
       ========================================================== */
  
    const Payment = {
      createOrder(amount, currency = "INR") {
        return request("/payment/create-order", { method: "POST", auth: true, body: { amount, currency } });
      },
  
      verify(data) {
        return request("/payment/verify", { method: "POST", auth: true, body: data });
      }
    };
  
    /* ==========================================================
       FILE ATTACHMENTS

       Uploaded once via POST /api/upload (multipart/form-data), which
       returns lightweight metadata + an attachment id. That id is then
       passed to streamChat()'s attachmentIds so the backend can pull the
       full extracted text / image data server-side — the browser never
       needs to re-send the file contents on every chat turn.
       ========================================================== */

    const MAX_ATTACHMENTS_PER_UPLOAD = 5;

    // Uses XMLHttpRequest instead of fetch so we can report upload progress
    // (fetch has no built-in upload-progress event).
    function uploadFiles(files, onProgress) {
      const token = getToken();
      if (!token) {
        return Promise.reject(makeError("Not authenticated.", { status: 401 }));
      }

      const formData = new FormData();
      Array.from(files)
        .slice(0, MAX_ATTACHMENTS_PER_UPLOAD)
        .forEach((file) => formData.append("files", file));

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${BASE_URL}/upload`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable && typeof onProgress === "function") {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.onload = () => {
          let payload = null;
          try {
            payload = JSON.parse(xhr.responseText);
          } catch {
            // no/invalid JSON body
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(payload?.data || { attachments: [], failures: [] });
          } else {
            reject(makeError(payload?.message || `Upload failed (${xhr.status})`, { status: xhr.status }));
          }
        };

        xhr.onerror = () => reject(makeError("Can't reach the Genfo AI server. Check your connection.", { isNetworkError: true }));
        xhr.ontimeout = () => reject(makeError("The upload timed out. Please try again.", { isTimeout: true }));
        xhr.timeout = 60000;

        xhr.send(formData);
      });
    }

    const Attachments = { upload: uploadFiles, MAX_ATTACHMENTS_PER_UPLOAD };

    /* ==========================================================
       CONVERSATIONS (the real chat sidebar — list/load/rename/delete)
       ========================================================== */

    const Conversations = {
      list() {
        return request("/chat/conversations", { auth: true }).then((r) => r.data.conversations);
      },
      get(id) {
        return request(`/chat/conversations/${id}`, { auth: true }).then((r) => r.data);
      },
      remove(id) {
        return request(`/chat/conversations/${id}`, { method: "DELETE", auth: true });
      },
      rename(id, title) {
        return request(`/chat/conversations/${id}`, { method: "PATCH", auth: true, body: { title } });
      },
      pin(id, pinned) {
        return request(`/chat/conversations/${id}`, { method: "PATCH", auth: true, body: { pinned } });
      }
    };

    /* ==========================================================
       MEMORY (durable facts Genfo AI has learned about the user,
       reused across every conversation — not just the current tab)
       ========================================================== */

    const Memory = {
      list() {
        return request("/memory", { auth: true }).then((r) => r.data.items);
      },
      remove(id) {
        return request(`/memory/${id}`, { method: "DELETE", auth: true });
      },
      clear() {
        return request("/memory", { method: "DELETE", auth: true });
      }
    };

    /* ==========================================================
       STREAMING CHAT
       ========================================================== */
  
    async function streamChat(message, history, onToken, attachmentIds = [], conversationId = null, onMeta = null) {
      const token = getToken();
      if (!token) {
        throw makeError("Not authenticated.", { status: 401 });
      }
  
      const response = await fetchWithTimeout(
        `${BASE_URL}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ message, history, attachmentIds, conversationId })
        },
        CHAT_TIMEOUT_MS
      );
  
      if (!response.ok) {
        let msg = `Chat failed (${response.status})`;
        try {
          const err = await response.json();
          msg = err.message || msg;
        } catch {
          // no JSON body — keep default message
        }
        throw makeError(msg, { status: response.status });
      }
  
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
  
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
  
        buffer += decoder.decode(value, { stream: true });
  
        const lines = buffer.split("\n");
        buffer = lines.pop();
  
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
  
          const data = line.slice(5).trim();
          if (!data) continue;
  
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
  
          if (parsed.error) {
            throw makeError(parsed.error, { status: response.status });
          }
  
          // First frame of every stream: which conversation this turn
          // belongs to (new or existing), so the sidebar can track it.
          if (parsed.conversationId && typeof onMeta === "function") {
            onMeta({ conversationId: parsed.conversationId, title: parsed.title, isNew: parsed.isNew });
          }
  
          if (parsed.token) {
            onToken(parsed.token);
          }
  
          if (parsed.done) {
            return;
          }
        }
      }
    }
  
    /* ==========================================================
       IMAGE GENERATION
  
       Backend returns raw image bytes on success.
       Response headers:
         X-Images-Remaining
         X-Image-Limit
       ========================================================== */
  
    async function parseImageResponse(response) {
      if (!response.ok) {
        let msg = `Image request failed (${response.status})`;
        let upgrade = false;
        try {
          const err = await response.json();
          msg = err.message || msg;
          upgrade = Boolean(err?.data?.upgrade);
        } catch {
          // no JSON body — keep default message
        }
        const apiErr = makeError(msg, { status: response.status });
        apiErr.upgrade = upgrade;
        throw apiErr;
      }

      const blob = await response.blob();
      const limitHeader = response.headers.get("X-Image-Limit");
      const remainingHeader = response.headers.get("X-Images-Remaining");
      const plan = response.headers.get("X-User-Plan") || "free";
      const conversationId = response.headers.get("X-Conversation-Id") || null;

      return {
        url: URL.createObjectURL(blob),
        remaining: remainingHeader === "unlimited" ? null : remainingHeader,
        limit: limitHeader === "unlimited" ? null : limitHeader,
        unlimited: limitHeader === "unlimited",
        plan,
        conversationId
      };
    }

    async function generateImage(prompt, aspect = "square", conversationId = null) {
      const token = getToken();
      if (!token) {
        throw makeError("Not authenticated.", { status: 401 });
      }
  
      const response = await fetchWithTimeout(
        `${BASE_URL}/image/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ prompt, aspect, conversationId })
        },
        IMAGE_TIMEOUT_MS
      );
  
      return parseImageResponse(response);
    }

    // Approximates editing an uploaded image: the backend describes it via
    // a vision model (informed by `instruction`) then generates a fresh
    // image from that description — not a pixel-level edit of the original,
    // but a confident, working result rather than a refusal.
    async function editImage(attachmentId, instruction, aspect = "square", conversationId = null) {
      const token = getToken();
      if (!token) {
        throw makeError("Not authenticated.", { status: 401 });
      }

      const response = await fetchWithTimeout(
        `${BASE_URL}/image/edit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ attachmentId, instruction, aspect, conversationId })
        },
        IMAGE_TIMEOUT_MS
      );

      return parseImageResponse(response);
    }
  
    return {
      BASE_URL,
  
      getToken,
      setToken,
      clearToken,
  
      getUser,
      setUser,
      clearUser,
  
      isAuthenticated,
      logout,
  
      Auth,
      Payment,
      Attachments,
      Conversations,
      Memory,
  
      streamChat,
      generateImage,
      editImage
    };
  
  })();