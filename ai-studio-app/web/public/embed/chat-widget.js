// TODO: Embeddable chat widget for external websites.
// - Brand references (window.EcholAI, CSS class prefix "echolai-") are hardcoded
//   because this is a standalone .js file that can't import from TS modules.
// - When this feature is production-ready, generate this file at build time from
//   branding constants (packages/types/src/branding.ts) or make the global name
//   configurable via a data attribute on the script tag.
// - Depends on: /api/v1/agents/:slug/sessions (exists), API key auth (exists)
// - Missing: documentation, Settings UI to show embed snippet, rate limiting
(function () {
  "use strict";

  var config = window.EcholAI || {};
  if (!config.agentSlug || !config.apiKey) {
    console.error("EcholAI: agentSlug and apiKey are required. Set window.EcholAI = { agentSlug, apiKey, baseUrl }");
    return;
  }

  var baseUrl = (config.baseUrl || "").replace(/\/$/, "");
  var agentSlug = config.agentSlug;
  var apiKey = config.apiKey;
  var title = config.title || "Chat";
  var placeholder = config.placeholder || "Type a message...";
  var position = config.position || "bottom-right";
  var primaryColor = config.primaryColor || "#5c1a1a";

  var sessionId = null;
  var isOpen = false;
  var isLoading = false;

  var style = document.createElement("style");
  style.textContent = [
    ".echolai-widget{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a}",
    ".echolai-fab{position:fixed;z-index:99999;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,0.2);transition:transform .2s}",
    ".echolai-fab:hover{transform:scale(1.05)}",
    ".echolai-fab svg{width:24px;height:24px;fill:white}",
    ".echolai-panel{position:fixed;z-index:99999;width:380px;height:520px;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,0.15);background:#fff;opacity:0;transform:translateY(16px) scale(0.95);transition:opacity .2s,transform .2s;pointer-events:none}",
    ".echolai-panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}",
    ".echolai-header{padding:14px 16px;color:white;font-weight:600;font-size:15px;display:flex;align-items:center;justify-content:space-between}",
    ".echolai-close{background:none;border:none;color:white;cursor:pointer;font-size:18px;padding:0 4px;opacity:0.8}",
    ".echolai-close:hover{opacity:1}",
    ".echolai-messages{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;background:#f9fafb}",
    ".echolai-msg{max-width:85%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}",
    ".echolai-msg.user{align-self:flex-end;color:white;border-bottom-right-radius:4px}",
    ".echolai-msg.assistant{align-self:flex-start;background:white;color:#1a1a1a;border:1px solid #e5e7eb;border-bottom-left-radius:4px}",
    ".echolai-msg.system{align-self:center;color:#6b7280;font-size:12px;font-style:italic}",
    ".echolai-input-area{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #e5e7eb;background:#fff}",
    ".echolai-input{flex:1;border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:13px;outline:none;font-family:inherit;resize:none}",
    ".echolai-send{width:36px;height:36px;border-radius:8px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;transition:opacity .15s}",
    ".echolai-send:disabled{opacity:0.5;cursor:not-allowed}",
    ".echolai-send svg{width:16px;height:16px;fill:white}",
    ".echolai-typing{display:flex;gap:4px;padding:8px 14px;align-self:flex-start}",
    ".echolai-typing span{width:6px;height:6px;border-radius:50%;background:#9ca3af;animation:echolai-bounce .6s infinite alternate}",
    ".echolai-typing span:nth-child(2){animation-delay:.2s}",
    ".echolai-typing span:nth-child(3){animation-delay:.4s}",
    "@keyframes echolai-bounce{to{transform:translateY(-4px);opacity:0.4}}",
    ".echolai-empty{flex:1;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:13px}",
  ].join("\n");
  document.head.appendChild(style);

  var posStyle = position === "bottom-left"
    ? "bottom:20px;left:20px" : "bottom:20px;right:20px";
  var panelPos = position === "bottom-left"
    ? "bottom:88px;left:20px" : "bottom:88px;right:20px";

  // FAB button
  var fabSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  fabSvg.setAttribute("viewBox", "0 0 24 24");
  var fabPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  fabPath.setAttribute("d", "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z");
  fabSvg.appendChild(fabPath);

  var fab = document.createElement("button");
  fab.className = "echolai-fab";
  fab.style.cssText = posStyle + ";background:" + primaryColor;
  fab.appendChild(fabSvg);
  fab.setAttribute("aria-label", "Open chat");
  fab.onclick = function () { togglePanel(); };
  document.body.appendChild(fab);

  // Panel
  var panel = document.createElement("div");
  panel.className = "echolai-panel echolai-widget";
  panel.style.cssText = panelPos;

  var header = document.createElement("div");
  header.className = "echolai-header";
  header.style.background = primaryColor;
  var titleSpan = document.createElement("span");
  titleSpan.textContent = title;
  var closeBtn = document.createElement("button");
  closeBtn.className = "echolai-close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.onclick = function () { panel.classList.remove("open"); isOpen = false; };
  header.appendChild(titleSpan);
  header.appendChild(closeBtn);

  var msgsEl = document.createElement("div");
  msgsEl.className = "echolai-messages";
  var emptyEl = document.createElement("div");
  emptyEl.className = "echolai-empty";
  emptyEl.textContent = "Send a message to start chatting";
  msgsEl.appendChild(emptyEl);

  var inputArea = document.createElement("div");
  inputArea.className = "echolai-input-area";
  var inputEl = document.createElement("input");
  inputEl.className = "echolai-input";
  inputEl.placeholder = placeholder;

  var sendSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  sendSvg.setAttribute("viewBox", "0 0 24 24");
  var sendPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  sendPath.setAttribute("d", "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z");
  sendSvg.appendChild(sendPath);

  var sendBtn = document.createElement("button");
  sendBtn.className = "echolai-send";
  sendBtn.style.background = primaryColor;
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.appendChild(sendSvg);

  inputArea.appendChild(inputEl);
  inputArea.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(msgsEl);
  panel.appendChild(inputArea);
  document.body.appendChild(panel);

  sendBtn.onclick = function () { sendMessage(); };
  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  function togglePanel() {
    isOpen = !isOpen;
    if (isOpen) {
      panel.classList.add("open");
      inputEl.focus();
    } else {
      panel.classList.remove("open");
    }
  }

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || isLoading) return;

    inputEl.value = "";
    clearEmpty();
    appendMsg("user", text);
    showTyping();
    isLoading = true;
    sendBtn.disabled = true;

    var url, body;
    if (!sessionId) {
      url = baseUrl + "/api/v1/agents/" + encodeURIComponent(agentSlug) + "/sessions";
      body = { message: text };
    } else {
      url = baseUrl + "/api/v1/agents/" + encodeURIComponent(agentSlug) + "/sessions/" + sessionId + "/messages";
      body = { message: text };
    }

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify(body),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        hideTyping();
        isLoading = false;
        sendBtn.disabled = false;

        if (data.error) {
          appendMsg("system", "Error: " + data.error);
          return;
        }

        if (data.sessionId) sessionId = data.sessionId;
        var responseText = (data.response && data.response.text) || data.response || "";
        if (responseText) appendMsg("assistant", responseText);
      })
      .catch(function () {
        hideTyping();
        isLoading = false;
        sendBtn.disabled = false;
        appendMsg("system", "Connection error. Please try again.");
      });
  }

  function appendMsg(role, text) {
    var div = document.createElement("div");
    div.className = "echolai-msg " + role;
    if (role === "user") div.style.background = primaryColor;
    div.textContent = text;
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function showTyping() {
    var div = document.createElement("div");
    div.className = "echolai-typing";
    div.id = "echolai-typing";
    for (var i = 0; i < 3; i++) {
      div.appendChild(document.createElement("span"));
    }
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById("echolai-typing");
    if (el) el.remove();
  }

  function clearEmpty() {
    var empty = msgsEl.querySelector(".echolai-empty");
    if (empty) empty.remove();
  }
})();
