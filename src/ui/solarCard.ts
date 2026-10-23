/**
 * MCP App view (SEP-1865, `text/html;profile=mcp-app`) for Sol Solar tool results.
 * One self-contained HTML document: no network access, no external scripts.
 * It speaks the MCP Apps postMessage dialect: `ui/initialize`, then
 * `ui/notifications/initialized`, then it renders `ui/notifications/tool-result`.
 */
export const SOLAR_CARD_URI = "ui://sol-solar/solar-card.html";
export const SOLAR_CARD_MIME = "text/html;profile=mcp-app";

export const SOLAR_CARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sol Solar card</title>
<style>
  :root { color-scheme: light dark; --sun: #f5a524; --sun-soft: #fde7b8; --ink: #1d1b16; --muted: #6b6558; --card: #fffaf0; --line: #eadfc8; --ok: #2f7d4f; --warn: #b4462b; }
  @media (prefers-color-scheme: dark) { :root { --ink: #f5efe2; --muted: #b6ad99; --card: #1f1c16; --line: #3a342a; --sun-soft: #4a3a17; } }
  :root[data-theme="dark"] { color-scheme: dark; --ink: #f5efe2; --muted: #b6ad99; --card: #1f1c16; --line: #3a342a; --sun-soft: #4a3a17; }
  :root[data-theme="light"] { color-scheme: light; --ink: #1d1b16; --muted: #6b6558; --card: #fffaf0; --line: #eadfc8; --sun-soft: #fde7b8; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: transparent; }
  body { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  .kicker { margin: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .headline { margin: 4px 0 10px; font-size: 18px; font-weight: 650; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--sun-soft); }
  .pill.ok { background: #d8efe0; color: var(--ok); } .pill.warn { background: #f7ddd5; color: var(--warn); }
  .day { margin: 10px 0 4px; }
  .day-title { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .bars { position: relative; display: flex; align-items: flex-end; gap: 3px; height: 72px; border-bottom: 1px solid var(--line); }
  .bar { flex: 1; background: #d9cfba; border-radius: 3px 3px 0 0; min-height: 2px; }
  .bar.hit { background: var(--sun); }
  .typical { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--muted); font-size: 10px; color: var(--muted); }
  .hours { display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); }
  ul { margin: 8px 0 0; padding-left: 18px; } li { margin: 2px 0; }
  .gauge { height: 10px; border-radius: 6px; background: var(--line); overflow: hidden; margin: 6px 0 2px; }
  .gauge > span { display: block; height: 100%; background: var(--ok); }
  .gauge.short > span { background: var(--warn); }
  .foot { margin-top: 10px; font-size: 11px; color: var(--muted); }
  .empty { color: var(--muted); }
</style>
</head>
<body>
<div class="card" id="card"><p class="empty">Waiting for a Sol Solar answer…</p></div>
<script>
(function () {
  var card = document.getElementById("card");
  var nextId = 1;
  var pending = {};
  var tz = "UTC";

  function send(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: "2.0", id: id, method: method, params: params });
    return new Promise(function (resolve) { pending[id] = resolve; });
  }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function hour(iso) {
    try { return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso)); }
    catch (e) { return iso; }
  }
  function kwh(n) { return (Math.round(n * 10) / 10) + " kWh"; }
  var decisions = {
    "run-today": ["Run it today", "ok"], "wait-tomorrow": ["Wait until tomorrow", ""],
    "partial-today": ["Today covers part of it", "warn"], "partial-tomorrow": ["Tomorrow is better", ""],
    "no-window": ["No strong window", "warn"], today: ["Today's plan", "ok"], tomorrow: ["Tomorrow's plan", ""]
  };

  function render(result) {
    var data = (result && result.structuredContent) || {};
    var spoken = data.spoken || ((result && result.content) || []).filter(function (c) { return c.type === "text"; }).map(function (c) { return c.text; }).join(" ");
    tz = data.timezone || "UTC";
    card.replaceChildren();
    var label = "Sol Solar";
    var tone = "";
    if (typeof data.lasts === "boolean") { label = data.lasts ? "Battery lasts the night" : "Battery runs out overnight"; tone = data.lasts ? "ok" : "warn"; }
    else if (decisions[data.decision]) { label = decisions[data.decision][0]; tone = decisions[data.decision][1]; }
    else if (decisions[data.day]) { label = decisions[data.day][0]; tone = decisions[data.day][1]; }
    if (result && result.isError) { label = "Need one more detail"; tone = "warn"; }
    card.append(el("p", "kicker", "Sol Solar · spoken answer"));
    var parts = spoken.split(/(?<=\\.)\\s+/);
    var lead = parts[0] || spoken;
    if (lead.length < 16 && parts[1]) lead += " " + parts[1];
    card.append(el("p", "headline", lead));
    card.append(el("span", "pill " + tone, label));

    if (data.window) {
      card.append(el("p", "", "Window: " + data.window.day_label + " " + hour(data.window.start) + " – " + hour(data.window.end) +
        " · solar " + kwh(data.window.solar_kwh) + " of " + kwh(data.window.load_kwh)));
    }
    if (typeof data.stored_kwh === "number" && typeof data.night_need_kwh === "number") {
      var ratio = data.night_need_kwh > 0 ? Math.min(1, data.stored_kwh / data.night_need_kwh) : 1;
      var g = el("div", "gauge" + (data.lasts ? "" : " short"));
      var fill = el("span"); fill.style.width = Math.round(ratio * 100) + "%"; g.append(fill);
      card.append(el("p", "", "Stored " + kwh(data.stored_kwh) + " · night needs " + kwh(data.night_need_kwh)));
      card.append(g);
      if (data.refill_at) card.append(el("p", "", "Sun refills it by about " + hour(data.refill_at)));
    }
    var typical = data.typical && typeof data.typical.daily_kwh === "number" ? data.typical.daily_kwh : null;
    var days = data.days || [];
    var peak = 0.05;
    days.forEach(function (d) { d.hours.forEach(function (h) { if (h.energy_kwh > peak) peak = h.energy_kwh; }); });
    days.forEach(function (d) {
      var box = el("div", "day");
      var title = el("div", "day-title");
      title.append(el("span", "", d.label === "today" ? "Today" : d.label === "tomorrow" ? "Tomorrow" : d.date));
      title.append(el("span", "", kwh(d.total_kwh) + (typical ? " · typical " + kwh(typical) : "")));
      var bars = el("div", "bars");
      d.hours.forEach(function (h) {
        var b = el("div", h.in_window ? "bar hit" : "bar");
        b.style.height = Math.max(2, (h.energy_kwh / peak) * 100) + "%";
        b.title = hour(h.start) + ": " + h.energy_kwh + " kWh";
        bars.append(b);
      });
      var scale = el("div", "hours");
      if (d.hours.length) { scale.append(el("span", "", hour(d.hours[0].start))); scale.append(el("span", "", hour(d.hours[d.hours.length - 1].start))); }
      box.append(title, bars, scale);
      card.append(box);
    });
    if (data.runs && data.runs.length) {
      var ul = el("ul");
      data.runs.forEach(function (r) { ul.append(el("li", "", r.name + ": " + hour(r.start) + " – " + hour(r.end) + " (" + kwh(r.load_kwh) + ")")); });
      card.append(ul);
    }
    if (data.unscheduled && data.unscheduled.length) {
      card.append(el("p", "", "Not covered by the roof: " + data.unscheduled.join(", ")));
    }
    card.append(el("p", "foot", "Model estimate from Open-Meteo (CC BY 4.0) and PVGIS © European Communities. Power, hours, battery and load are what you typed."));
    reportSize();
  }

  function reportSize() {
    send({ jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: document.body.scrollWidth, height: document.body.scrollHeight } });
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (msg.id !== undefined && pending[msg.id] && !msg.method) { pending[msg.id](msg.result || {}); delete pending[msg.id]; return; }
    if (msg.method === "ui/notifications/tool-result") render(msg.params);
    if (msg.method === "ui/resource-teardown" && msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
    if (msg.method === "ping" && msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
  });

  if (typeof ResizeObserver === "function") new ResizeObserver(reportSize).observe(document.body);

  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "sol-solar-card", version: "1.1.0" },
    appCapabilities: { availableDisplayModes: ["inline"] }
  }).then(function (result) {
    var theme = result && result.hostContext && result.hostContext.theme;
    if (theme === "dark" || theme === "light") document.documentElement.setAttribute("data-theme", theme);
    send({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
  });
})();
</script>
</body>
</html>`;
