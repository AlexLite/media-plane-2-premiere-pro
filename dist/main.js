"use strict";
(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // src/persistence.ts
  var BINDINGS_KEY = "plane-sequence-bindings-v1";
  var TOKEN_PREFIX = "plane-token:";
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  function uxp() {
    return __require("uxp");
  }
  var BindingStore = class {
    storage() {
      return uxp().localStorage ?? window.localStorage;
    }
    get(sequenceId) {
      return this.all()[sequenceId];
    }
    save(binding2) {
      const values = this.all();
      values[binding2.sequenceId] = binding2;
      this.storage().setItem(BINDINGS_KEY, JSON.stringify(values));
    }
    all() {
      try {
        return JSON.parse(this.storage().getItem(BINDINGS_KEY) ?? "{}");
      } catch {
        return {};
      }
    }
    async saveToken(baseUrl, token) {
      const secure = uxp().storage?.secureStorage;
      if (!secure) throw new Error("UXP secure storage is unavailable in this host.");
      await secure.setItem(TOKEN_PREFIX + baseUrl, encoder.encode(token).buffer);
    }
    async getToken(baseUrl) {
      const value = await uxp().storage?.secureStorage?.getItem(TOKEN_PREFIX + baseUrl);
      return value ? decoder.decode(value) : void 0;
    }
  };

  // src/timecode.ts
  var TIME = /^(?:(\d{2}):)?([0-5]\d):([0-5]\d)$/;
  function parseTimecode(value) {
    const m = TIME.exec(value.trim());
    if (!m) return void 0;
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  function validTimecodes(items) {
    return (items ?? []).filter((item) => parseTimecode(item.value) === item.seconds);
  }
  function timecodesFromHtml(html) {
    const matches = html.matchAll(/<span\s+[^>]*data-plane-timecode=["'](\d{2}:\d{2}:\d{2})["'][^>]*>/gi);
    const result = [];
    for (const match of matches) {
      const seconds = parseTimecode(match[1]);
      if (seconds !== void 0) result.push({ value: match[1], seconds });
    }
    return result;
  }

  // src/plane-client.ts
  var PlaneError = class extends Error {
    constructor(message2, status) {
      super(message2);
      this.status = status;
    }
  };
  var PlaneClient = class {
    constructor(baseUrl, token) {
      this.token = token;
      this.root = baseUrl.replace(/\/$/, "");
    }
    async request(path, init = {}) {
      const response = await fetch(`${this.root}/api/v1${path}`, { ...init, headers: { "X-API-Key": this.token, "Content-Type": "application/json", ...init.headers } });
      if (!response.ok) throw new PlaneError(`Plane request failed (${response.status})`, response.status);
      return response.status === 204 ? void 0 : await response.json();
    }
    async validate() {
      await this.request("/workspaces/");
    }
    async getProjects(workspace) {
      const data = await this.request(`/workspaces/${encodeURIComponent(workspace)}/projects/`);
      return Array.isArray(data) ? data : data.results ?? [];
    }
    async getIssues(workspace, project) {
      const data = await this.request(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/`);
      return Array.isArray(data) ? data : data.results ?? [];
    }
    async getWorkItem(workspace, project, issue2) {
      return this.request(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue2)}/`);
    }
    async getStates(workspace, project) {
      return this.request(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/states/`);
    }
    async updateState(workspace, project, issue2, state) {
      return this.request(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue2)}/`, { method: "PATCH", body: JSON.stringify({ state }) });
    }
    async getComments(workspace, project, issue2) {
      const data = await this.request(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue2)}/comments/`);
      const comments2 = Array.isArray(data) ? data : data.results;
      return comments2.map((c) => ({ ...c, timecodes: c.timecodes ? validTimecodes(c.timecodes) : timecodesFromHtml(c.comment_html) }));
    }
    async createComment(workspace, project, issue2, commentHtml) {
      return this.request(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue2)}/comments/`, { method: "POST", body: JSON.stringify({ comment_html: commentHtml }) });
    }
  };

  // src/markers.ts
  var PREFIX = "[plane-timecode-review]";
  function serializeIdentity(identity) {
    return `${PREFIX}${JSON.stringify(identity)}`;
  }
  function readIdentity(comment) {
    if (!comment.startsWith(PREFIX)) return void 0;
    const firstLine = comment.slice(PREFIX.length).split("\n", 1)[0];
    try {
      const v = JSON.parse(firstLine);
      return v.plugin === "plane-timecode-review" && typeof v.commentId === "string" && typeof v.timecode === "string" ? v : void 0;
    } catch {
      return void 0;
    }
  }
  function markerKey(identity) {
    return `${identity.commentId}\0${identity.timecode}`;
  }
  async function reconcileMarkers(gateway, desired2) {
    const existing = await gateway.list();
    const required = new Map(desired2.map((item) => [markerKey(item.identity), item]));
    const seen = /* @__PURE__ */ new Set();
    for (const marker of existing) {
      const identity = readIdentity(marker.comments);
      if (!identity) continue;
      const key = markerKey(identity);
      if (!required.has(key) || seen.has(key)) await gateway.remove(marker.id);
      else seen.add(key);
    }
    for (const [key, marker] of required) if (!seen.has(key)) await gateway.create({ startSeconds: marker.startSeconds, name: marker.name, comments: `${serializeIdentity(marker.identity)}
${marker.comment}` });
  }

  // src/premiere.ts
  var PremiereAdapter = class {
    app() {
      return __require("premierepro").app;
    }
    activeSequence() {
      const sequence2 = this.app().project.activeSequence;
      if (!sequence2) return void 0;
      const fps = Number(sequence2.videoFrameRate ?? sequence2.frameRate ?? 30);
      const durationSeconds = Number(sequence2.duration?.seconds ?? sequence2.end?.seconds ?? 0);
      return { id: String(sequence2.sequenceID ?? sequence2.id), name: sequence2.name, fps, durationSeconds };
    }
    markers() {
      const sequence2 = this.app().project.activeSequence;
      if (!sequence2) throw new Error("No active sequence");
      const collection = sequence2.markers;
      return {
        async list() {
          const output = [];
          for (const marker of collection) output.push({ id: String(marker.id ?? marker.guid), startSeconds: Number(marker.start?.seconds ?? marker.startTime?.seconds ?? 0), name: marker.name ?? "", comments: marker.comments ?? marker.comment ?? "" });
          return output;
        },
        async create(value) {
          const marker = collection.createMarker(value.startSeconds);
          marker.name = value.name;
          marker.comments = value.comments;
        },
        async remove(id) {
          const marker = [...collection].find((m) => String(m.id ?? m.guid) === id);
          if (marker) collection.deleteMarker(marker);
        }
      };
    }
  };

  // src/main.ts
  var root = document.querySelector("#app");
  var store = new BindingStore();
  var premiere = new PremiereAdapter();
  var sequence;
  var binding;
  var client;
  var issue;
  var comments = [];
  var states = [];
  var checked = /* @__PURE__ */ new Set();
  var projects = [];
  var issues = [];
  var draft = {};
  var draftToken = "";
  var escape = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var plain = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  function active() {
    sequence = premiere.activeSequence();
    binding = sequence && store.get(sequence.id);
  }
  function message(text, cls = "muted") {
    root.innerHTML = `<p class="${cls}">${escape(text)}</p>`;
  }
  function bindEvents() {
    root.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", () => void action(el.dataset.action)));
  }
  function connection(error = "") {
    active();
    if (!sequence) {
      root.innerHTML = `<h2>Plane Review</h2><p class="warning">Open or select a sequence in Premiere, then reopen this panel.</p>`;
      return;
    }
    root.innerHTML = `<h2>Connect sequence</h2><p class="muted">Binding: ${escape(sequence.name)}</p>${error ? `<p class="error">${escape(error)}</p>` : ""}
  <label>Plane base URL<input id="baseUrl" placeholder="https://plane.example.com" value="${escape(draft.baseUrl ?? binding?.baseUrl ?? "")}"/></label>
  <label>Personal access token<input id="token" type="password" placeholder="Stored only in UXP secure storage" value="${escape(draftToken)}"/></label>
  <label>Workspace slug<input id="workspace" value="${escape(draft.workspaceSlug ?? binding?.workspaceSlug ?? "")}"/></label>
  <button class="secondary" data-action="discover">Load projects &amp; items</button>
  <label>Project ${projects.length ? `<select id="project">${projects.map((p) => `<option value="${escape(p.id)}" ${p.id === draft.projectId || p.id === binding?.projectId ? "selected" : ""}>${escape(p.identifier ? `${p.identifier} \u2014 ${p.name}` : p.name)}</option>`).join("")}</select>` : `<input id="project" value="${escape(draft.projectId ?? binding?.projectId ?? "")}" placeholder="Load or enter project ID"/>`}</label>
  <label>Work item ${issues.length ? `<select id="workItem">${issues.map((i) => `<option value="${escape(i.id)}" ${i.id === draft.workItemId || i.id === binding?.workItemId ? "selected" : ""}>${escape(i.identifier)} \u2014 ${escape(i.name)}</option>`).join("")}</select>` : `<input id="workItem" value="${escape(draft.workItemId ?? binding?.workItemId ?? "")}" placeholder="Load or enter work item ID"/>`}</label>
  <button data-action="connect">Validate, save &amp; open review</button>`;
    bindEvents();
  }
  async function load() {
    active();
    if (!sequence) return connection();
    if (!binding) return connection();
    const token = await store.getToken(binding.baseUrl);
    if (!token) return connection("No saved token for this Plane URL.");
    client = new PlaneClient(binding.baseUrl, token);
    const [loadedIssue, loadedComments, loadedStates] = await Promise.all([client.getWorkItem(binding.workspaceSlug, binding.projectId, binding.workItemId), client.getComments(binding.workspaceSlug, binding.projectId, binding.workItemId), client.getStates(binding.workspaceSlug, binding.projectId)]);
    issue = loadedIssue;
    comments = loadedComments;
    states = loadedStates;
    const markers = await premiere.markers().list();
    checked = /* @__PURE__ */ new Set();
    for (const comment of comments) for (const tc of comment.timecodes ?? []) {
      const identity = { commentId: comment.id, timecode: tc.value };
      const exists = markers.some((m) => markerKey(readIdentity(m.comments) ?? { commentId: "", timecode: "" }) === markerKey(identity));
      if (!exists) checked.add(markerKey(identity));
    }
    review();
  }
  function review(error = "") {
    if (!sequence || !binding || !issue) return connection(error);
    const options = states.map((s) => `<option value="${escape(s.id)}" ${s.id === issue.state_detail?.id || s.name === issue.state ? "selected" : ""}>${escape(s.name)}</option>`).join("");
    const commentHtml = comments.map((comment) => {
      const author = comment.actor_detail?.display_name ?? comment.actor_detail?.first_name ?? "Plane user";
      const list = (comment.timecodes ?? []).map((tc) => {
        const key = markerKey({ commentId: comment.id, timecode: tc.value });
        const out = tc.seconds > sequence.durationSeconds;
        return `<label class="timecode"><input type="checkbox" data-key="${escape(key)}" ${checked.has(key) || out ? "checked" : ""} ${out ? "disabled" : ""}/><span>${escape(tc.value)}${out ? ' <span class="warning">(outside sequence)</span>' : ""}</span></label>`;
      }).join("");
      return list ? `<section class="comment"><h3>${escape(author)}</h3><p class="muted">${escape(plain(comment.comment_html).slice(0, 180))}</p>${list}</section>` : "";
    }).join("") || `<p class="muted">No Plane timecodes in this comment stream.</p>`;
    root.innerHTML = `<div class="row"><h2>${escape(sequence.name)}</h2><button class="secondary" data-action="refresh">Refresh</button></div><p>${escape(issue.identifier)} \u2014 ${escape(issue.name)}</p>${error ? `<p class="error">${escape(error)}</p>` : ""}
  <label>Status<select id="status">${options}</select></label><button data-action="state">Update status</button>
  <label>Reply<textarea id="reply" placeholder="Write a Plane comment\u2026"></textarea></label><button data-action="reply">Post reply</button><h3>Timecodes</h3>${commentHtml}`;
    bindEvents();
    root.querySelectorAll("input[data-key]").forEach((box) => box.addEventListener("change", () => void toggle(box.dataset.key, box.checked)));
  }
  function desired() {
    return comments.flatMap((comment) => (comment.timecodes ?? []).filter((tc) => !checked.has(markerKey({ commentId: comment.id, timecode: tc.value })) && tc.seconds <= sequence.durationSeconds).map((tc) => ({ identity: { plugin: "plane-timecode-review", commentId: comment.id, timecode: tc.value }, startSeconds: tc.seconds, name: `${issue.identifier} ${tc.value}`, comment: `${comment.actor_detail?.display_name ?? "Plane user"} \xB7 ${tc.value} \xB7 ${plain(comment.comment_html).slice(0, 160)}` })));
  }
  async function toggle(key, isChecked) {
    isChecked ? checked.add(key) : checked.delete(key);
    try {
      await reconcileMarkers(premiere.markers(), desired());
    } catch (e) {
      review(String(e));
      return;
    }
    review();
  }
  async function action(name) {
    try {
      if (name === "discover") {
        const value = (id) => (root.querySelector(`#${id}`)?.value ?? "").trim();
        const baseUrl = value("baseUrl"), token = value("token"), workspace = value("workspace");
        if (!baseUrl || !token || !workspace) throw new Error("Enter Plane URL, token, and workspace first.");
        draftToken = token;
        draft = { ...draft, baseUrl, workspaceSlug: workspace, projectId: value("project"), workItemId: value("workItem") };
        const discovery = new PlaneClient(baseUrl, token);
        await discovery.validate();
        projects = await discovery.getProjects(workspace);
        const selectedProject = draft.projectId || projects[0]?.id;
        draft.projectId = selectedProject;
        issues = selectedProject ? await discovery.getIssues(workspace, selectedProject) : [];
        connection();
      }
      if (name === "connect") {
        const val = (id) => (root.querySelector(`#${id}`)?.value ?? "").trim();
        const baseUrl = val("baseUrl");
        const token = val("token");
        const next = { sequenceId: sequence.id, baseUrl, workspaceSlug: val("workspace"), projectId: val("project"), workItemId: val("workItem") };
        if (!baseUrl || !token || !next.workspaceSlug || !next.projectId || !next.workItemId) throw new Error("Complete every connection field.");
        const validation = new PlaneClient(baseUrl, token);
        await validation.validate();
        await store.saveToken(baseUrl, token);
        store.save(next);
        binding = next;
        draft = {};
        draftToken = "";
        message("Connected. Loading review\u2026");
        await load();
      }
      if (name === "refresh") {
        message("Refreshing\u2026");
        await load();
      }
      if (name === "state") {
        await client.updateState(binding.workspaceSlug, binding.projectId, binding.workItemId, root.querySelector("#status").value);
        await load();
      }
      if (name === "reply") {
        const text = root.querySelector("#reply").value.trim();
        if (!text) return;
        await client.createComment(binding.workspaceSlug, binding.projectId, binding.workItemId, `<p>${escape(text)}</p>`);
        await load();
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (name === "connect" || name === "discover") connection(detail);
      else review(detail);
    }
  }
  void load().catch((e) => connection(e instanceof Error ? e.message : String(e)));
})();
