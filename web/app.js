const state = {
  token: sessionStorage.getItem("sol-solar-token") || "",
  sessionId: "",
  protocolVersion: "2025-11-25",
  resource: "",
  clientId: "sol-solar-web",
  siteId: localStorage.getItem("sol-solar-site") || "",
  nextId: 1,
  uiTools: {},
  uiRead: {},
  speak: localStorage.getItem("sol-solar-speak") !== "off",
};

const headline = document.querySelector("#headline");
const rest = document.querySelector("#rest");
const kicker = document.querySelector("#kicker");
const charts = document.querySelector("#charts");
const trace = document.querySelector("#trace");
const connect = document.querySelector("#connect");
const mic = document.querySelector("#mic");
const heard = document.querySelector("#heard");
const speakToggle = document.querySelector("#speak");
const memory = document.querySelector("#memory");

function field(id) {
  return document.querySelector(id).value.trim();
}

function numberField(id) {
  const value = field(id);
  if (value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function addTrace(line) {
  const item = document.createElement("li");
  item.textContent = line;
  trace.append(item);
}

function splitSpoken(spoken) {
  const parts = spoken.split(/(?<=\.)\s+/);
  const take = (parts[0] || "").length < 16 && parts.length > 1 ? 2 : 1;
  headline.textContent = parts.slice(0, take).join(" ") || spoken;
  rest.textContent = parts.slice(take).join(" ");
  headline.classList.toggle("is-error", /couldn't|don't|isn't a strong|out of range|Tell me/i.test(spoken));
}

function siteArgs() {
  const args = {
    place: field("#place"),
    system_kw: numberField("#system"),
    tilt_degrees: numberField("#tilt"),
    azimuth_degrees: Number(field("#azimuth")),
  };
  const price = numberField("#price");
  const currency = field("#currency").toUpperCase();
  if (price !== undefined || currency) {
    args.price_per_kwh = price;
    args.currency = currency;
  }
  if (state.siteId) args.site_id = state.siteId;
  return args;
}

function batteryArgs() {
  return {
    ...siteArgs(),
    battery_kwh: numberField("#battery"),
    charge_percent: numberField("#charge"),
    household_load_kw: numberField("#load"),
  };
}

function householdArgs() {
  return {
    ...siteArgs(),
    appliances: [
      { name: field("#appliance") || "washing machine", power_kw: numberField("#power"), duration_hours: numberField("#duration") },
      { name: "dishwasher", power_kw: 1, duration_hours: 1 },
      { name: "car charging", power_kw: 1.4, duration_hours: 3 },
    ],
  };
}

function savedApplianceArgs() {
  return { ...siteArgs(), appliance_name: field("#appliance") || "washing machine" };
}

function dayPlanArgs() {
  return {
    ...siteArgs(),
    appliances: [
      { name: "dishwasher", power_kw: 1, duration_hours: 1 },
      { name: "washing machine", power_kw: numberField("#power"), duration_hours: numberField("#duration") },
      { name: "car charging", power_kw: 1.4, duration_hours: 3 },
    ],
  };
}

function applianceArgs() {
  return {
    ...siteArgs(),
    appliance_name: field("#appliance"),
    power_kw: numberField("#power"),
    duration_hours: numberField("#duration"),
  };
}

function validate(kind) {
  if (!field("#place") || numberField("#system") === undefined) return "Add a city and an array size first.";
  if ((kind === "wash" || kind === "savings" || kind === "day" || kind === "remember") && (numberField("#power") === undefined || numberField("#duration") === undefined)) {
    return "Add the appliance power and hours. They are assumptions, not a meter reading.";
  }
  if (kind === "outage" && (numberField("#battery") === undefined || numberField("#charge") === undefined || numberField("#load") === undefined)) {
    return "Add a battery size, a charge percent, and a household load. They are assumptions, not a battery reading.";
  }
  const price = numberField("#price");
  const currency = field("#currency");
  if ((price === undefined) !== (currency === "")) return "Add both a price and a currency, or leave both empty.";
  return "";
}

async function rpc(message) {
  const headers = {
    authorization: `Bearer ${state.token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (state.sessionId) {
    headers["mcp-session-id"] = state.sessionId;
    headers["mcp-protocol-version"] = state.protocolVersion;
  }
  const response = await fetch("/mcp", { method: "POST", headers, body: JSON.stringify(message) });
  const sid = response.headers.get("mcp-session-id");
  if (sid) state.sessionId = sid;
  if (response.status === 202) return null;
  if (response.status === 401) {
    state.token = "";
    state.initialized = false;
    sessionStorage.removeItem("sol-solar-token");
    connect.textContent = "Connect this browser";
    throw new Error("The connection expired. Tap Connect this browser, then ask again.");
  }
  const type = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!response.ok) throw new Error(raw || `HTTP ${response.status}`);
  if (type.includes("text/event-stream")) {
    let matched = null;
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const parsed = JSON.parse(payload);
      if (!message.id || parsed.id === message.id) matched = parsed;
    }
    if (!matched) throw new Error("The MCP stream did not include a result.");
    return matched;
  }
  return raw ? JSON.parse(raw) : null;
}

async function ensureSession() {
  if (state.sessionId || state.initialized) return;
  const initialized = await rpc({
    jsonrpc: "2.0",
    id: state.nextId++,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
      clientInfo: { name: "sol-solar-web", version: "1.1.0" },
    },
  });
  state.protocolVersion = initialized?.result?.protocolVersion || state.protocolVersion;
  addTrace(`initialize → protocol ${state.protocolVersion}, transport Streamable HTTP`);
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  const listed = await rpc({ jsonrpc: "2.0", id: state.nextId++, method: "tools/list", params: {} });
  const tools = listed?.result?.tools || [];
  for (const tool of tools) {
    const uri = tool._meta?.ui?.resourceUri;
    if (uri) state.uiTools[tool.name] = uri;
  }
  addTrace(`tools/list → ${tools.length} tools, ${Object.keys(state.uiTools).length} with an MCP App view`);
  state.initialized = true;
  if (!state.sessionId) addTrace("stateless server: no Mcp-Session-Id, the household travels in site_id");
}

async function readUiResource(uri) {
  if (state.uiRead[uri]) return;
  const message = await rpc({ jsonrpc: "2.0", id: state.nextId++, method: "resources/read", params: { uri } });
  const content = message?.result?.contents?.[0];
  if (!content) throw new Error("The MCP App resource was empty.");
  state.uiRead[uri] = true;
  addTrace(`resources/read ${uri} → ${content.mimeType}, ${content.text.length} characters`);
}

// Minimal MCP Apps host: one sandboxed iframe per tool result.
function showCard(args, result) {
  charts.replaceChildren();
  const frame = document.createElement("iframe");
  frame.className = "app-frame";
  frame.title = "Sol Solar card (MCP App)";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.src = "/ui/solar-card.html";
  const onMessage = (event) => {
    if (event.source !== frame.contentWindow) return;
    const msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    const reply = (body) => frame.contentWindow.postMessage({ jsonrpc: "2.0", id: msg.id, ...body }, "*");
    if (msg.method === "ui/initialize") {
      reply({ result: {
        protocolVersion: "2026-01-26",
        hostInfo: { name: "sol-solar-web", version: "1.1.0" },
        hostCapabilities: {},
        hostContext: { theme: "dark", displayMode: "inline", availableDisplayModes: ["inline"] },
      } });
    } else if (msg.method === "ui/notifications/initialized") {
      frame.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: args } }, "*");
      frame.contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result }, "*");
      addTrace("ui/notifications/tool-result → MCP App card");
    } else if (msg.method === "ui/notifications/size-changed" && msg.params?.height) {
      frame.style.height = `${Math.min(900, Math.ceil(msg.params.height) + 4)}px`;
    } else if (msg.id !== undefined && msg.method) {
      reply({ error: { code: -32601, message: "Not supported by this host" } });
    }
  };
  window.addEventListener("message", onMessage);
  frame.addEventListener("load", () => undefined, { once: true });
  charts.append(frame);
}

function say(text) {
  if (!state.speak || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function rememberSite(id) {
  if (!id) return;
  state.siteId = id;
  localStorage.setItem("sol-solar-site", id);
}

async function callTool(name, args) {
  await ensureSession();
  addTrace(`tools/call ${name}`);
  const message = await rpc({
    jsonrpc: "2.0",
    id: state.nextId++,
    method: "tools/call",
    params: { name, arguments: args },
  });
  if (message?.error) throw new Error(message.error.message || "MCP error");
  const result = message?.result;
  if (!result) throw new Error("The tool returned no result.");
  const spoken = (result.content || []).filter((item) => item.type === "text").map((item) => item.text).join(" ");
  return { name, args, raw: result, spoken, data: result.structuredContent || {}, isError: Boolean(result.isError) };
}

function draw(data) {
  const days = data.days || [];
  charts.replaceChildren();
  if (!days.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No hourly forecast in this answer.";
    charts.append(empty);
    return;
  }
  const peak = Math.max(0.05, ...days.flatMap((day) => day.hours.map((hour) => hour.energy_kwh)));
  for (const day of days) {
    const block = document.createElement("div");
    block.className = "day";
    const title = document.createElement("p");
    const label = day.label === "today" ? "Today" : day.label === "tomorrow" ? "Tomorrow" : day.date;
    title.textContent = `${label} · ${day.total_kwh} kWh expected`;
    const bars = document.createElement("div");
    bars.className = "bars";
    for (const hour of day.hours) {
      const bar = document.createElement("div");
      bar.className = hour.in_window ? "bar in-window" : "bar";
      bar.style.height = `${Math.max(2, (hour.energy_kwh / peak) * 100)}%`;
      const when = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: data.timezone || "UTC" }).format(new Date(hour.start));
      bar.title = `${when}: ${hour.energy_kwh} kWh`;
      bars.append(bar);
    }
    const scale = document.createElement("div");
    scale.className = "hours";
    const first = day.hours[0];
    const last = day.hours[day.hours.length - 1];
    const fmt = (iso) => new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: data.timezone || "UTC" }).format(new Date(iso));
    const startLabel = document.createElement("span");
    const endLabel = document.createElement("span");
    startLabel.textContent = fmt(first.start);
    endLabel.textContent = fmt(last.start);
    scale.append(startLabel, endLabel);
    block.append(title, bars, scale);
    charts.append(block);
  }
}

async function ask(kind) {
  const problem = validate(kind);
  if (problem) {
    kicker.textContent = "Need one more detail";
    headline.textContent = problem;
    rest.textContent = "";
    return;
  }
  if (!state.token) {
    kicker.textContent = "Connect first";
    headline.textContent = "Connect this browser, then ask again.";
    rest.textContent = "Connection uses OAuth with PKCE, the same shape Alexa+ asks for.";
    return;
  }
  connect.disabled = true;
  kicker.textContent = "Checking the forecast";
  headline.textContent = "Looking up the roof…";
  rest.textContent = "";
  try {
    let remembered = await callTool("remember_solar_site", siteArgs());
    if (remembered.isError && state.siteId) {
      // The saved household is gone (for example a fresh serverless instance). Start a new one from the form.
      state.siteId = "";
      localStorage.removeItem("sol-solar-site");
      remembered = await callTool("remember_solar_site", siteArgs());
    }
    rememberSite(remembered.data.site_id);
    let result = remembered;
    if (kind === "remember") {
      result = await callTool("remember_household_appliances", householdArgs());
      rememberSite(result.data.site_id);
    }
    if (kind === "saved-wash") result = await callTool("best_time_for_appliance", savedApplianceArgs());
    if (kind === "saved-day") result = await callTool("plan_the_solar_day", siteArgs());
    if (kind === "outage") result = await callTool("battery_through_the_night", batteryArgs());
    if (kind === "wash") result = await callTool("best_time_for_appliance", applianceArgs());
    if (kind === "day") result = await callTool("plan_the_solar_day", dayPlanArgs());
    if (kind === "forecast") result = await callTool("forecast_pv_production", siteArgs());
    if (kind === "briefing") result = await callTool("daily_solar_briefing", siteArgs());
    if (kind === "savings") result = await callTool("estimate_savings", applianceArgs());
    const kickers = {
      "run-today": "Run it today",
      "wait-tomorrow": "Wait until tomorrow",
      "partial-today": "Today covers part of it",
      "partial-tomorrow": "Tomorrow is better",
      "no-window": "No strong window",
      today: "Today's plan",
      tomorrow: "Wait until tomorrow",
    };
    if (typeof result.data.lasts === "boolean") kicker.textContent = result.data.lasts ? "It should last the night" : "It runs out overnight";
    else kicker.textContent = kickers[result.data.decision] || kickers[result.data.day] || "Spoken answer";
    if (result.isError) kicker.textContent = "Need one more detail";
    splitSpoken(result.spoken);
    say(result.spoken);
    if (result.data.appliances) memory.textContent = `Saved for this home: ${result.data.appliances.map((item) => item.name).join(", ")}. Ask again tomorrow without retyping.`;
    if (result.data.timezone === undefined && remembered.data.timezone) result.data.timezone = remembered.data.timezone;
    const uri = state.uiTools[result.name];
    if (uri && !result.isError) {
      await readUiResource(uri);
      showCard(result.args, result.raw);
    } else {
      draw(result.data.days ? result.data : remembered.data);
    }
  } catch (error) {
    kicker.textContent = "The call failed";
    headline.textContent = "The server did not return an estimate.";
    rest.textContent = error instanceof Error ? error.message : "Unknown error";
  } finally {
    connect.disabled = false;
  }
}

async function beginConnect() {
  const config = await (await fetch("/client-config")).json();
  state.resource = config.resource;
  state.clientId = config.clientId;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  sessionStorage.setItem("sol-solar-verifier", verifier);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const url = new URL("/authorize", window.location.origin);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", state.clientId);
  url.searchParams.set("redirect_uri", `${window.location.origin}/`);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", state.resource);
  url.searchParams.set("scope", "solar:read");
  url.searchParams.set("state", "web");
  window.location.assign(url.toString());
}

async function finishConnect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return;
  const verifier = sessionStorage.getItem("sol-solar-verifier");
  const config = await (await fetch("/client-config")).json();
  const response = await fetch("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier || "",
      client_id: config.clientId,
      redirect_uri: `${window.location.origin}/`,
      resource: config.resource,
    }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error_description || "Token exchange failed");
  state.token = json.access_token;
  sessionStorage.setItem("sol-solar-token", state.token);
  window.history.replaceState({}, "", "/");
  connect.textContent = "Connected";
  addTrace("OAuth 2.1 authorization code + PKCE S256");
}

connect.addEventListener("click", () => void beginConnect());

// Voice in: the browser's speech recognition picks one of the questions. Voice out: speechSynthesis reads the tool text.
const intents = [
  ["remember", /\b(remember|memorize)\b/],
  ["saved-day", /\bplan\b.*\b(saved|my appliances|usual)\b/],
  ["outage", /\b(battery|outage|night|blackout)\b/],
  ["day", /\b(plan|dishwasher|car)\b/],
  ["briefing", /\b(morning|briefing|window)\b/],
  ["savings", /\b(save|saving|money|cost)\b/],
  ["forecast", /\b(how much|forecast|produce|make)\b/],
  ["saved-wash", /\b(washer|washing|laundry)\b/],
];

function intentFor(text) {
  const lower = text.toLowerCase();
  for (const [kind, pattern] of intents) if (pattern.test(lower)) return kind;
  return "";
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recognition) {
  mic.disabled = true;
  mic.title = "This browser has no speech recognition. Tap a question instead.";
} else {
  mic.addEventListener("click", () => {
    const recognizer = new Recognition();
    recognizer.lang = "en-US";
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
    mic.classList.add("is-listening");
    heard.textContent = "Listening…";
    recognizer.onresult = (event) => {
      const text = event.results[0][0].transcript;
      const kind = intentFor(text);
      heard.textContent = kind ? `Heard: “${text}”` : `Heard: “${text}”. Try asking about the battery, the washer, or the day plan.`;
      if (kind) void ask(kind);
    };
    recognizer.onerror = () => { heard.textContent = "I didn't catch that. Tap a question instead."; };
    recognizer.onend = () => mic.classList.remove("is-listening");
    recognizer.start();
  });
}
speakToggle.checked = state.speak;
speakToggle.addEventListener("change", () => {
  state.speak = speakToggle.checked;
  localStorage.setItem("sol-solar-speak", state.speak ? "on" : "off");
  if (!state.speak && "speechSynthesis" in window) window.speechSynthesis.cancel();
});
if (state.siteId) memory.textContent = "This browser remembers your home from an earlier visit. Ask about your saved appliances.";
for (const button of document.querySelectorAll("[data-ask]")) {
  button.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[data-ask]")) other.classList.remove("is-active");
    button.classList.add("is-active");
    void ask(button.dataset.ask);
  });
}
if (state.token) connect.textContent = "Connected";
finishConnect().catch((error) => {
  headline.textContent = "The connection did not finish.";
  rest.textContent = error instanceof Error ? error.message : "Unknown error";
});
