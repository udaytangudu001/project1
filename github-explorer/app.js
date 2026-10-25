(() => {
  "use strict";

  const API = "https://api.github.com";
  const TOKEN_KEY = "gitscope.githubToken";
  const HISTORY_KEY = "gitscope.recentProfiles";
  const THEME_KEY = "gitscope.theme";
  const PALETTE = ["#80e6ad", "#82aaff", "#c5a2ff", "#ffb980", "#ff7f99", "#5fd4d0", "#e5d478", "#f38bbc", "#91a4bb"];
  const LANGUAGE_COLORS = {
    JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572a5", Java: "#b07219",
    Go: "#00add8", Rust: "#dea584", Ruby: "#701516", PHP: "#4f5d95", C: "#555555",
    "C++": "#f34b7d", Swift: "#f05138", Kotlin: "#a97bff", HTML: "#e34c26",
    CSS: "#563d7c", Shell: "#89e051", Vue: "#41b883", Dart: "#00b4ab",
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { profile: null, repos: [], events: [], allLanguages: [], busy: false };

  const els = {
    form: $("#searchForm"), input: $("#usernameInput"), status: $("#statusRegion"), welcome: $("#welcomePanel"),
    dashboard: $("#dashboard"), loading: $("#loadingPanel"), dashboardContent: $("#dashboardContent"),
    profile: $("#profileCard"), stats: $("#statsGrid"), languageChart: $("#languageChart"),
    starsChart: $("#starsChart"), heatmap: $("#heatmap"), repoList: $("#repoList"), repoSearch: $("#repoSearch"),
    languageFilter: $("#languageFilter"), repoSort: $("#repoSort"), repoCount: $("#repoCount"), repoEmpty: $("#repoEmpty"),
    activityList: $("#activityList"), activityCount: $("#activityCount"), recent: $("#recentSearches"),
    clearHistory: $("#clearHistory"), tokenPanel: $("#tokenPanel"), tokenInput: $("#tokenInput"),
    repoDialog: $("#repoDialog"), readme: $("#readmeContent"),
  };

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function safeUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function number(value) {
    return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value || 0);
  }

  function dateLabel(value, options = { month: "short", day: "numeric", year: "numeric" }) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, options).format(date);
  }

  function relativeTime(value) {
    const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
    const units = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
    for (const [size, unit] of units) if (seconds >= size) return `${Math.floor(seconds / size)} ${unit}${Math.floor(seconds / size) === 1 ? "" : "s"} ago`;
    return "just now";
  }

  class ApiError extends Error {
    constructor(status, message, remaining) { super(message); this.status = status; this.remaining = remaining; }
    get rateLimited() { return this.status === 429 || (this.status === 403 && (this.remaining === "0" || /rate limit/i.test(this.message))); }
  }

  async function api(path, { accept = "application/vnd.github+json" } = {}) {
    const headers = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API}${path}`, { headers });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).message || ""; } catch { /* keep the HTTP fallback */ }
      throw new ApiError(response.status, detail || `GitHub returned ${response.status}.`, response.headers.get("x-ratelimit-remaining"));
    }
    return response.json();
  }

  async function loadAllRepos(username) {
    const all = [];
    for (let page = 1; ; page += 1) {
      const batch = await api(`/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated&type=owner&page=${page}`);
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  function setStatus(message = "", kind = "") {
    if (!message) { els.status.replaceChildren(); return; }
    const card = document.createElement("div");
    card.className = `status-card ${kind}`;
    card.setAttribute("role", kind === "error" ? "alert" : "status");
    const icon = document.createElement("span"); icon.className = "status-icon"; icon.textContent = kind === "error" ? "!" : "✓";
    const copy = document.createElement("div");
    const [headline, ...rest] = message.split("\n");
    copy.innerHTML = `<strong>${escapeHtml(headline)}</strong><p>${escapeHtml(rest.join(" "))}</p>`;
    card.append(icon, copy);
    if (kind === "error" && localStorage.getItem(TOKEN_KEY)) {
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "text-button"; retry.textContent = "Try again";
      retry.addEventListener("click", () => search(els.input.value)); card.append(retry);
    }
    els.status.replaceChildren(card);
  }

  function showSkeleton() {
    els.welcome.hidden = true; els.dashboard.hidden = false;
    els.dashboardContent.hidden = true;
    els.loading.hidden = false;
    els.loading.innerHTML = `<div class="skeleton skeleton-profile"></div><div class="skeleton-stat-row">${Array.from({ length: 4 }, () => '<div class="skeleton skeleton-stat"></div>').join("")}</div><div class="skeleton skeleton-content"></div>`;
  }

  function showTokenPanel() {
    els.tokenPanel.hidden = false;
    els.tokenInput.focus();
  }

  function tokenError(error) {
    if (error.rateLimited) {
      setStatus("GitHub’s anonymous API limit is reached.\nAdd a read-only public GitHub token to continue. It is stored only in this browser.", "error");
      showTokenPanel();
      return;
    }
    setStatus(error.status === 404 ? "That GitHub username wasn’t found.\nCheck the spelling and try again." : `Couldn’t load this profile.\n${error.message || "Check your connection and try again."}`, "error");
  }

  function renderProfile(user) {
    const name = user.name || user.login;
    const links = [];
    if (user.company) links.push(`<span class="profile-link-item"><span class="profile-link-icon">⌘</span>${escapeHtml(user.company)}</span>`);
    if (user.location) links.push(`<span class="profile-link-item"><span class="profile-link-icon">⌖</span>${escapeHtml(user.location)}</span>`);
    const blog = safeUrl(user.blog);
    if (blog) links.push(`<a class="profile-link-item" href="${escapeHtml(blog)}" target="_blank" rel="noreferrer"><span class="profile-link-icon">↗</span>${escapeHtml(user.blog.replace(/^https?:\/\//, ""))}</a>`);
    if (user.twitter_username) links.push(`<a class="profile-link-item" href="https://twitter.com/${encodeURIComponent(user.twitter_username)}" target="_blank" rel="noreferrer"><span class="profile-link-icon">𝕏</span>@${escapeHtml(user.twitter_username)}</a>`);
    els.profile.innerHTML = `
      <img class="profile-avatar" src="${escapeHtml(user.avatar_url)}" alt="${escapeHtml(name)}’s GitHub avatar" />
      <div class="profile-main"><div class="profile-name-row"><h2 class="profile-name">${escapeHtml(name)}</h2><span class="profile-handle">@${escapeHtml(user.login)}</span></div>
        ${user.bio ? `<p class="profile-bio">${escapeHtml(user.bio)}</p>` : ""}
        <div class="profile-links">${links.join("") || '<span class="muted">No public bio details yet</span>'}</div>
        <div class="follow-row"><span><strong>${number(user.followers)}</strong> followers</span><span><strong>${number(user.following)}</strong> following</span><span><strong>${number(user.public_repos)}</strong> public repos</span></div>
      </div>
      <div class="profile-cta"><a class="github-profile-button" href="${escapeHtml(user.html_url)}" target="_blank" rel="noreferrer">View GitHub profile ↗</a><span class="joined-date">Joined ${dateLabel(user.created_at, { month: "short", year: "numeric" })}</span></div>`;
  }

  function renderStats(repos) {
    const stats = [
      ["Total stars", repos.reduce((sum, repo) => sum + repo.stargazers_count, 0), "Across public repositories"],
      ["Forks", repos.reduce((sum, repo) => sum + repo.forks_count, 0), "Community-made copies"],
      ["Watchers", repos.reduce((sum, repo) => sum + repo.watchers_count, 0), "Repository subscriptions"],
      ["Open issues", repos.reduce((sum, repo) => sum + repo.open_issues_count, 0), "Issues and pull requests"],
    ];
    els.stats.innerHTML = stats.map(([label, value, caption]) => `<article class="stat-card"><span class="stat-label">${label}</span><strong class="stat-value">${number(value)}</strong><span class="stat-caption">${caption}</span></article>`).join("");
  }

  function renderLanguageChart(repos) {
    const counts = new Map();
    repos.forEach(repo => { if (repo.language) counts.set(repo.language, (counts.get(repo.language) || 0) + 1); });
    const languages = [...counts].sort((a, b) => b[1] - a[1]);
    const total = languages.reduce((sum, item) => sum + item[1], 0);
    if (!total) { els.languageChart.innerHTML = '<div class="empty-chart">No language data available yet.</div>'; return; }
    const top = languages.slice(0, 8);
    const others = languages.slice(8).reduce((sum, item) => sum + item[1], 0);
    if (others) top.push(["Other", others]);
    let offset = 0;
    const circles = top.map(([language, count], index) => {
      const length = (count / total) * 100;
      const circle = `<circle cx="50" cy="50" r="38" stroke="${PALETTE[index % PALETTE.length]}" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="-${offset}" pathLength="100"/>`;
      offset += length;
      return circle;
    }).join("");
    const legend = top.slice(0, 6).map(([language, count], index) => `<div class="legend-item"><span class="legend-color" style="background:${PALETTE[index % PALETTE.length]}"></span><span class="legend-name">${escapeHtml(language)}</span><span class="legend-pct">${Math.round(count / total * 100)}%</span></div>`).join("");
    els.languageChart.innerHTML = `<div class="donut-chart" role="img" aria-label="Language distribution across ${total} repositories"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" stroke="var(--surface-raised)" pathLength="100"/>${circles}</svg><div class="donut-center"><strong>${total}</strong><span>repos</span></div></div><div class="legend-list">${legend}</div>`;
  }

  function renderStarsChart(repos) {
    const top = [...repos].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 6);
    const max = top[0]?.stargazers_count || 1;
    if (!top.length) { els.starsChart.innerHTML = '<div class="empty-chart">No public repositories to rank.</div>'; return; }
    els.starsChart.innerHTML = top.map(repo => `<div class="star-bar-row"><span class="star-repo-name" title="${escapeHtml(repo.name)}">${escapeHtml(repo.name)}</span><span class="star-bar-track"><span class="star-bar" style="display:block;width:${Math.max(2, repo.stargazers_count / max * 100)}%"></span></span><span class="star-bar-value">${number(repo.stargazers_count)}</span></div>`).join("");
  }

  function renderHeatmap(events) {
    const counts = new Map();
    events.forEach(event => { const day = event.created_at?.slice(0, 10); if (day) counts.set(day, (counts.get(day) || 0) + 1); });
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 89);
    const cells = [];
    let date = new Date(start);
    while (date.getUTCDay() !== 0) date.setUTCDate(date.getUTCDate() - 1);
    const gridStart = new Date(date);
    for (let week = 0; week < 14; week += 1) {
      for (let weekday = 0; weekday < 7; weekday += 1) {
        const day = new Date(gridStart); day.setUTCDate(gridStart.getUTCDate() + week * 7 + weekday);
        const iso = day.toISOString().slice(0, 10);
        const count = counts.get(iso) || 0;
        const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
        cells.push(`<span class="heat-cell" data-level="${level}" title="${count} public event${count === 1 ? "" : "s"} on ${dateLabel(iso)}" aria-label="${count} public events on ${dateLabel(iso)}"></span>`);
      }
    }
    els.heatmap.innerHTML = `<div class="heat-labels"><span>12 weeks ago</span><span>This week</span></div><div class="heatmap-grid">${cells.join("")}</div><div class="heatmap-legend">Less <span class="heat-cell"></span><span class="heat-cell" data-level="1"></span><span class="heat-cell" data-level="2"></span><span class="heat-cell" data-level="3"></span><span class="heat-cell" data-level="4"></span> More</div>`;
  }

  function languageColor(language) { return LANGUAGE_COLORS[language] || PALETTE[(language || "").length % PALETTE.length]; }

  function renderRepos() {
    const query = els.repoSearch.value.trim().toLowerCase();
    const language = els.languageFilter.value;
    const sort = els.repoSort.value;
    const filtered = state.repos.filter(repo => {
      const matchesText = !query || `${repo.name} ${repo.description || ""} ${(repo.topics || []).join(" ")}`.toLowerCase().includes(query);
      return matchesText && (!language || repo.language === language);
    });
    if (sort === "stars") filtered.sort((a, b) => b.stargazers_count - a.stargazers_count);
    if (sort === "updated") filtered.sort((a, b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));
    if (sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));
    els.repoCount.textContent = `${filtered.length}${filtered.length !== state.repos.length ? ` / ${state.repos.length}` : ""}`;
    els.repoEmpty.hidden = filtered.length > 0;
    els.repoList.innerHTML = filtered.map(repo => `
      <button class="repo-card" type="button" data-repo="${escapeHtml(repo.full_name)}" aria-label="Open ${escapeHtml(repo.full_name)} repository details">
        <span class="repo-name-row"><span class="repo-name">${escapeHtml(repo.name)}</span><span class="repo-visibility">${repo.archived ? "ARCHIVED" : "PUBLIC"}</span></span>
        <span class="repo-description">${escapeHtml(repo.description || "No description provided.")}</span>
        ${repo.topics?.length ? `<span class="repo-topics">${repo.topics.slice(0, 4).map(topic => `<span class="topic-chip">${escapeHtml(topic)}</span>`).join("")}</span>` : ""}
        <span class="repo-meta">
          ${repo.language ? `<span class="repo-meta-item"><span class="lang-dot" style="--language-color:${languageColor(repo.language)}"></span>${escapeHtml(repo.language)}</span>` : ""}
          <span class="repo-meta-item">☆ ${number(repo.stargazers_count)}</span><span class="repo-meta-item">⑂ ${number(repo.forks_count)}</span>
          <span class="repo-meta-item">Updated ${relativeTime(repo.pushed_at || repo.updated_at)}</span>
        </span>
      </button>`).join("");
  }

  const EVENT_INFO = {
    PushEvent: { icon: "⇧", describe(event) { const commits = event.payload?.commits || []; return `<strong>pushed</strong> ${commits.length ? `${commits.length} commit${commits.length === 1 ? "" : "s"}` : "to"} to`; } },
    PullRequestEvent: { icon: "⑂", describe(event) { return `<strong>${escapeHtml(event.payload?.action || "updated")}</strong> a pull request in`; } },
    IssuesEvent: { icon: "◉", describe(event) { return `<strong>${escapeHtml(event.payload?.action || "updated")}</strong> an issue in`; } },
    WatchEvent: { icon: "☆", describe() { return "<strong>starred</strong>"; } },
    ReleaseEvent: { icon: "⬡", describe(event) { return `<strong>published a release</strong> in`; } },
    CreateEvent: { icon: "＋", describe(event) { const kind = event.payload?.ref_type || "repository"; return `<strong>created ${escapeHtml(kind)}</strong> in`; } },
    ForkEvent: { icon: "⑂", describe() { return "<strong>forked</strong>"; } },
    DeleteEvent: { icon: "−", describe(event) { return `<strong>deleted a ${escapeHtml(event.payload?.ref_type || "branch")}</strong> in`; } },
    PublicEvent: { icon: "◎", describe() { return "<strong>made public</strong>"; } },
  };

  function renderEvents(events) {
    const items = events.filter(event => EVENT_INFO[event.type]).slice(0, 16);
    els.activityCount.textContent = `${items.length} events`;
    if (!items.length) { els.activityList.innerHTML = '<div class="activity-empty">No recent public events found.</div>'; return; }
    els.activityList.innerHTML = items.map(event => {
      const info = EVENT_INFO[event.type];
      const repo = event.repo?.name || "a repository";
      let extra = "";
      if (event.type === "PushEvent") {
        const commit = event.payload?.commits?.[0]?.message;
        if (commit) extra = `<div class="activity-title">“${escapeHtml(commit.split("\n")[0])}”</div>`;
        if (event.payload?.ref) extra += `<div class="activity-time">${escapeHtml(event.payload.ref.replace("refs/heads/", ""))}</div>`;
      }
      const repoLink = `https://github.com/${repo.split("/").map(encodeURIComponent).join("/")}`;
      return `<article class="activity-item"><span class="activity-icon" aria-hidden="true">${info.icon}</span><div class="activity-copy"><div class="activity-title">${info.describe(event)} <a href="${repoLink}" target="_blank" rel="noreferrer">${escapeHtml(repo)}</a></div>${extra}<div class="activity-time" title="${dateLabel(event.created_at)}">${relativeTime(event.created_at)}</div></div></article>`;
    }).join("");
  }

  function renderDashboard() {
    els.welcome.hidden = true; els.dashboard.hidden = false;
    els.loading.hidden = true; els.dashboardContent.hidden = false;
    renderProfile(state.profile); renderStats(state.repos); renderLanguageChart(state.repos);
    renderStarsChart(state.repos); renderHeatmap(state.events); renderRepos(); renderEvents(state.events);
  }

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  }

  function saveHistory(user) {
    const history = loadHistory().filter(item => item.login.toLowerCase() !== user.login.toLowerCase());
    history.unshift({ login: user.login, name: user.name || user.login, avatar: user.avatar_url });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 6)));
    renderHistory();
  }

  function renderHistory() {
    const history = loadHistory();
    els.clearHistory.hidden = !history.length;
    if (!history.length) { els.recent.innerHTML = '<p class="muted small">Profiles you visit will show up here.</p>'; return; }
    els.recent.innerHTML = history.map(item => `<button class="recent-chip" type="button" data-user="${escapeHtml(item.login)}"><img src="${escapeHtml(item.avatar)}" alt="" /><span>${escapeHtml(item.login)}</span></button>`).join("");
  }

  function setBusy(busy) {
    state.busy = busy;
    const button = $(".search-button", els.form);
    button.disabled = busy;
    button.innerHTML = busy ? '<span>Loading profile…</span><span aria-hidden="true">◌</span>' : '<span>Explore profile</span><span aria-hidden="true">→</span>';
    els.input.setAttribute("aria-busy", String(busy));
  }

  async function search(rawUsername, { updateUrl = true } = {}) {
    if (state.busy) return;
    const username = rawUsername.trim().replace(/^@/, "");
    if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username)) {
      setStatus("Enter a valid GitHub username.\nUse letters, numbers, and hyphens.", "error");
      els.input.focus(); return;
    }
    els.input.value = username;
    setStatus(); setBusy(true); showSkeleton();
    if (updateUrl) {
      const url = new URL(window.location.href); url.searchParams.set("user", username);
      history.pushState({ user: username }, "", url);
    }
    try {
      const profilePromise = api(`/users/${encodeURIComponent(username)}`);
      const reposPromise = loadAllRepos(username);
      const eventsPromise = api(`/users/${encodeURIComponent(username)}/events/public?per_page=100`);
      const [profileResult, repoResult, eventResult] = await Promise.allSettled([profilePromise, reposPromise, eventsPromise]);
      if (profileResult.status === "rejected") throw profileResult.reason;
      state.profile = profileResult.value;
      state.repos = repoResult.status === "fulfilled" ? repoResult.value : [];
      state.events = eventResult.status === "fulfilled" ? eventResult.value : [];
      renderDashboard(); saveHistory(state.profile);
      if (repoResult.status === "rejected" || eventResult.status === "rejected") {
        const partialError = repoResult.status === "rejected" ? repoResult.reason : eventResult.reason;
        if (partialError.rateLimited) {
          setStatus("Profile loaded with partial data.\nAdd a token to load all repositories and recent activity.", "error"); showTokenPanel();
        } else setStatus("Profile loaded with partial data.\nSome repository or activity details could not be fetched.", "warning");
      }
    } catch (error) {
      els.dashboard.hidden = true; els.welcome.hidden = false;
      tokenError(error);
    } finally { setBusy(false); }
  }

  function inlineMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt) => `<span class="muted">[image: ${alt || "README image"}]</span>`);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+[^)]*)?\)/g, (_m, label, url) => `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`);
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return html;
  }

  function renderReadme(markdown) {
    const lines = markdown.replace(/\r/g, "").split("\n");
    const output = [];
    let paragraph = []; let code = []; let inCode = false; let listType = "";
    const flushParagraph = () => { if (paragraph.length) { output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`); paragraph = []; } };
    const closeList = () => { if (listType) { output.push(`</${listType}>`); listType = ""; } };
    for (const line of lines) {
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
        if (inCode) { output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`); code = []; inCode = false; }
        else { flushParagraph(); closeList(); inCode = true; }
        continue;
      }
      if (inCode) { code.push(line); continue; }
      if (!line.trim()) { flushParagraph(); closeList(); continue; }
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
      if (heading) { flushParagraph(); closeList(); const level = heading[1].length; output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); continue; }
      if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(line)) { flushParagraph(); closeList(); output.push("<hr />"); continue; }
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph(); const desired = ordered ? "ol" : "ul";
        if (listType !== desired) { closeList(); output.push(`<${desired}>`); listType = desired; }
        output.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`); continue;
      }
      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) { flushParagraph(); closeList(); output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); continue; }
      closeList(); paragraph.push(line.trim());
    }
    if (inCode) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    flushParagraph(); closeList();
    return output.join("") || '<p class="muted">This README is empty.</p>';
  }

  function decodeBase64(text) {
    const binary = atob(text.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function openRepository(fullName) {
    const repo = state.repos.find(item => item.full_name === fullName);
    if (!repo) return;
    $("#dialogOwner").textContent = `${repo.owner.login} /`;
    $("#dialogTitle").textContent = repo.name;
    $("#dialogMeta").innerHTML = `<span>☆ ${number(repo.stargazers_count)} stars</span><span>⑂ ${number(repo.forks_count)} forks</span><span>${repo.language ? escapeHtml(repo.language) : "No language tag"}</span><span>Updated ${dateLabel(repo.pushed_at)}</span>`;
    $("#dialogTopics").innerHTML = (repo.topics || []).map(topic => `<span class="topic-chip">${escapeHtml(topic)}</span>`).join("");
    const branchPath = (repo.default_branch || "main").split("/").map(encodeURIComponent).join("/");
    $("#readmeSource").href = `${repo.html_url}/blob/${branchPath}/README.md`;
    els.readme.innerHTML = '<div class="readme-loading">Loading README…</div>';
    els.repoDialog.showModal();
    try {
      const readme = await api(`/repos/${repo.full_name.split("/").map(encodeURIComponent).join("/")}/readme`);
      els.readme.innerHTML = renderReadme(decodeBase64(readme.content || ""));
    } catch (error) {
      els.readme.innerHTML = `<p class="muted">${error.status === 404 ? "This repository doesn’t have a README yet." : `Could not load the README: ${escapeHtml(error.message)}`}</p>`;
      if (error.rateLimited) { setStatus("GitHub’s anonymous API limit is reached.\nAdd a token to keep exploring.", "error"); showTokenPanel(); }
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    $("#themeToggle").setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  }

  els.form.addEventListener("submit", event => { event.preventDefault(); search(els.input.value); });
  document.addEventListener("click", event => {
    const userButton = event.target.closest("[data-user]");
    if (userButton) { event.preventDefault(); search(userButton.dataset.user); }
    const repoButton = event.target.closest("[data-repo]");
    if (repoButton) openRepository(repoButton.dataset.repo);
  });
  els.repoSearch.addEventListener("input", renderRepos);
  els.languageFilter.addEventListener("change", renderRepos);
  els.repoSort.addEventListener("change", renderRepos);
  $("#repoReset").addEventListener("click", () => { els.repoSearch.value = ""; els.languageFilter.value = ""; els.repoSort.value = "stars"; renderRepos(); });
  $("#clearHistory").addEventListener("click", () => { localStorage.removeItem(HISTORY_KEY); renderHistory(); });
  $("#themeToggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#closeRepoDialog").addEventListener("click", () => els.repoDialog.close());
  els.repoDialog.addEventListener("click", event => { if (event.target === els.repoDialog) els.repoDialog.close(); });
  $("#closeToken").addEventListener("click", () => { els.tokenPanel.hidden = true; els.input.focus(); });
  els.tokenPanel.addEventListener("click", event => { if (event.target === els.tokenPanel) { els.tokenPanel.hidden = true; els.input.focus(); } });
  $("#tokenForm").addEventListener("submit", event => {
    event.preventDefault(); const token = els.tokenInput.value.trim();
    if (token) { localStorage.setItem(TOKEN_KEY, token); els.tokenInput.value = ""; els.tokenPanel.hidden = true; search(els.input.value); }
  });
  $("#removeToken").addEventListener("click", () => { localStorage.removeItem(TOKEN_KEY); els.tokenInput.value = ""; els.tokenPanel.hidden = true; setStatus("Saved token removed.\nRequests will use GitHub’s anonymous rate limit.", "success"); });
  document.addEventListener("keydown", event => {
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) { event.preventDefault(); els.input.focus(); }
    if (!els.tokenPanel.hidden && event.key === "Escape") { els.tokenPanel.hidden = true; els.input.focus(); }
    if (!els.tokenPanel.hidden && event.key === "Tab") {
      const focusable = $$('button:not([disabled]), input:not([disabled]), a[href]', els.tokenPanel);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener("popstate", () => { const user = new URLSearchParams(location.search).get("user"); if (user) search(user, { updateUrl: false }); else { els.dashboard.hidden = true; els.welcome.hidden = false; setStatus(); } });

  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  renderHistory();
  const initialUser = new URLSearchParams(window.location.search).get("user");
  if (initialUser) search(initialUser, { updateUrl: false });
})();
