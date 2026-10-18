const statusEl = document.querySelector("#status");
const transcript = document.querySelector("#transcript");
const protocol = document.querySelector("#protocol");
const form = document.querySelector("#ask");

let nextId = 1;
let busy = false;

form.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || busy) return;
  event.preventDefault();
  void run(button.dataset.action);
});

void connect();

async function connect() {
  try {
    const init = await rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "sol-solar-simulator", version: "1.0.0" },
    });
    await rpc("notifications/initialized", {}, { notification: true });
    const tools = await rpc("tools/list", {});
    const version = init.result?.protocolVersion ?? "unknown";
    const names = (tools.result?.tools ?? []).map((tool) => tool.name);
    setStatus(`Connected. Protocol ${version}. ${names.length} tools.`, "ready");
    showProtocol({ initialize: init.result, tools: names });
  } catch (error) {
    setStatus(error.message, "bad");
    showProtocol({ error: error.message });
  }
}

async function run(action) {
  const place = value("#place").trim();
  const peak = numberValue("#peak");
  if (!place || !Number.isFinite(peak)) {
    addBubble("assistant", "Add a place and an array size first.", true);
    return;
  }
  if (action === "savings" && !Number.isFinite(numberValue("#price"))) {
    addBubble("user", "What is that energy worth?");
    addBubble(
      "assistant",
      "Type the price you pay per kilowatt-hour. This server does not look up a tariff.",
      true,
    );
    return;
  }

  const question = questionFor(action, place, peak);
  addBubble("user", question);
  setBusy(true);
  try {
    const location = await callTool("resolve_location", { place, count: 3 });
    const best = readJson(location).best;
    addBubble("assistant", summaryOf(location), Boolean(location.isError));
    if (!best || location.isError) return;
    const system = {
      latitude: best.latitude,
      longitude: best.longitude,
      peak_power_kw: peak,
      place_name: [best.name, best.admin1, best.country].filter(Boolean).join(", "),
      ...optionalNumber("tilt_degrees", "#tilt"),
      ...optionalNumber("azimuth_degrees", "#azimuth"),
    };
    let result;
    if (action === "forecast") {
      result = await callTool("forecast_pv_production", system);
    } else if (action === "appliance") {
      result = await callTool("best_appliance_hours", {
        ...system,
        appliance_name: value("#appliance").trim() || "appliance",
        power_watts: numberValue("#watts"),
        duration_hours: numberValue("#hours"),
        day: "auto",
      });
    } else if (action === "savings") {
      result = await callTool("estimate_savings", {
        ...system,
        grid_price_per_kwh: numberValue("#price"),
        currency: value("#currency").trim() || "USD",
      });
    } else {
      result = await callTool("typical_monthly_yield", system);
    }
    addBubble("assistant", summaryOf(result), Boolean(result.isError), toolText(result));
  } catch (error) {
    addBubble("assistant", error.message, true);
  } finally {
    setBusy(false);
  }
}

function questionFor(action, place, peak) {
  if (action === "forecast") return `What will a ${peak} kW array near ${place} make today and tomorrow?`;
  if (action === "appliance") {
    return `When should I run the ${value("#appliance")} (${value("#watts")} W for ${value("#hours")} h) near ${place}?`;
  }
  if (action === "savings") {
    return `What is the remaining production near ${place} worth at ${value("#price")} ${value("#currency")} per kWh?`;
  }
  return `What does a typical year look like for a ${peak} kW array near ${place}?`;
}

async function callTool(name, args) {
  const message = await rpc("tools/call", { name, arguments: args });
  showProtocol({ method: "tools/call", name, arguments: args, result: message.result ?? message.error });
  if (message.error) {
    throw new Error(message.error.message || "MCP error");
  }
  return message.result;
}

async function rpc(method, params, options = {}) {
  const id = options.notification ? undefined : nextId++;
  const body = { jsonrpc: "2.0", method, params };
  if (id !== undefined) body.id = id;
  const response = await fetch("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status === 202 || text.length === 0) return { result: null };
  const payload = parseBody(response.headers.get("content-type") || "", text);
  if (!response.ok && !payload.result && !payload.error) {
    throw new Error(`HTTP ${response.status}`);
  }
  return payload;
}

function parseBody(contentType, text) {
  if (contentType.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .pop();
    return JSON.parse(data || "{}");
  }
  return JSON.parse(text);
}

function summaryOf(result) {
  const text = toolText(result);
  const first = text.split("\n")[0] || text;
  return first.replace(/^SUMMARY:\s*/, "");
}

function toolText(result) {
  return (result.content || []).map((item) => item.text || "").join("\n");
}

function readJson(result) {
  const text = toolText(result);
  const start = text.indexOf("{");
  if (start === -1) return {};
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return {};
  }
}

function addBubble(role, text, isError = false, raw = "") {
  const item = document.createElement("li");
  item.className = `bubble ${role}${isError ? " error" : ""}`;
  item.textContent = text;
  if (raw) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Tool response";
    const pre = document.createElement("pre");
    pre.textContent = raw;
    details.append(summary, pre);
    item.append(details);
  }
  transcript.append(item);
  item.scrollIntoView({ block: "nearest" });
}

function showProtocol(value) {
  protocol.textContent = JSON.stringify(value, null, 2);
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` ${kind}` : ""}`;
}

function setBusy(state) {
  busy = state;
  for (const button of form.querySelectorAll("button")) button.disabled = state;
}

function value(selector) {
  return document.querySelector(selector).value;
}

function numberValue(selector) {
  const raw = value(selector).trim();
  if (raw === "") return Number.NaN;
  return Number(raw);
}

function optionalNumber(name, selector) {
  const parsed = numberValue(selector);
  return Number.isFinite(parsed) ? { [name]: parsed } : {};
}
