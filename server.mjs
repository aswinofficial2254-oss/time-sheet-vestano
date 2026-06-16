import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import net from "node:net";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(root, ".env");

async function loadEnvironmentFile() {
  try {
    const contents = await fs.readFile(envFile, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadEnvironmentFile();

const publicDir = path.join(root, "public");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, "data");
const dataFile = path.join(dataDir, "app-data.json");
const sessionFile = path.join(dataDir, "sessions.json");
const deviceRequestLogFile = path.join(dataDir, "attendance-device-requests.log");
const port = Number(process.env.PORT || 3000);
const attendancePort = Number(process.env.ATTENDANCE_PORT || process.env.PORT || 8081);
const host = process.env.HOST || "0.0.0.0";
const liveAttendanceForwardUrl =
  process.env.LIVE_ATTENDANCE_FORWARD_URL ||
  "https://lorrfeyiqgdfxdjqnpmn.supabase.co/functions/v1/iclock/iclock/cdata";
const liveAttendanceForwardEnabled =
  process.env.LIVE_ATTENDANCE_FORWARD !== "false";
const passwordResetRequests = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function hashSecret(secret, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifySecret(secret, stored) {
  const [salt, expected] = String(stored).split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(secret), salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

function smtpConfig() {
  return {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true").toLowerCase() !== "false",
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  };
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk) => {
      output += chunk.toString();
      const lines = output.trimEnd().split(/\r?\n/);
      const last = lines[lines.length - 1] || "";
      if (/^\d{3} /.test(last)) {
        cleanup();
        const code = Number(last.slice(0, 3));
        if (code >= 400) reject(new Error(`Mail server error ${code}.`));
        else resolve({ code, output });
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function smtpCommand(socket, command, expectedCodes) {
  socket.write(`${command}\r\n`);
  const response = await readSmtpResponse(socket);
  if (!expectedCodes.includes(response.code)) {
    throw new Error(`Unexpected mail server response ${response.code}.`);
  }
  return response;
}

async function sendMail({ to, subject, text: bodyText }) {
  const config = smtpConfig();
  if (!config.host || !config.user || !config.password || !config.from) {
    throw new Error("Email OTP is not configured. Ask the administrator to configure SMTP.");
  }
  let socket = await new Promise((resolve, reject) => {
    const connection = config.secure
      ? tls.connect(
          { host: config.host, port: config.port, servername: config.host },
          () => resolve(connection),
        )
      : net.connect({ host: config.host, port: config.port }, () => resolve(connection));
    connection.setTimeout(15_000, () => connection.destroy(new Error("Mail server timed out.")));
    connection.once("error", reject);
  });
  try {
    await readSmtpResponse(socket);
    await smtpCommand(socket, `EHLO ${os.hostname()}`, [250]);
    if (!config.secure) {
      await smtpCommand(socket, "STARTTLS", [220]);
      socket = await new Promise((resolve, reject) => {
        const secureSocket = tls.connect(
          { socket, servername: config.host },
          () => resolve(secureSocket),
        );
        secureSocket.once("error", reject);
      });
      await smtpCommand(socket, `EHLO ${os.hostname()}`, [250]);
    }
    await smtpCommand(socket, "AUTH LOGIN", [334]);
    await smtpCommand(socket, Buffer.from(config.user).toString("base64"), [334]);
    await smtpCommand(socket, Buffer.from(config.password).toString("base64"), [235]);
    await smtpCommand(socket, `MAIL FROM:<${config.from}>`, [250]);
    await smtpCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await smtpCommand(socket, "DATA", [354]);
    const safeSubject = String(subject).replace(/[\r\n]/g, " ");
    const safeBody = String(bodyText).replace(/^\./gm, "..");
    socket.write(
      [
        `From: Vestano Timesheet <${config.from}>`,
        `To: <${to}>`,
        `Subject: ${safeSubject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        safeBody,
        ".",
        "",
      ].join("\r\n"),
    );
    const dataResponse = await readSmtpResponse(socket);
    if (dataResponse.code !== 250) throw new Error("Mail server rejected the message.");
    await smtpCommand(socket, "QUIT", [221]);
  } finally {
    socket.destroy();
  }
}

async function initialData() {
  const now = new Date().toISOString();
  return {
    settings: {
      companyName: "Vestano International Pvt Ltd",
      standardHours: 8,
      attendanceLastSync: "",
      attendanceDeviceConfig: {
        model: "K90 Pro",
        serialNumber: "NFZ8253403657",
        ipAddress: "192.168.1.201",
        connectionType: "Wi-Fi",
        mode: "ADMS",
      },
    },
    users: [
      {
        id: crypto.randomUUID(),
        employeeId: "ADMIN001",
        name: "System Administrator",
        email: "admin@company.com",
        department: "Administration",
        manager: "",
        role: "super_admin",
        active: true,
        profileImage: "",
        passwordHash: hashSecret("Admin@123"),
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        employeeId: "EMP001",
        name: "Demo Employee",
        email: "employee@company.com",
        department: "Operations",
        manager: "System Administrator",
        role: "employee",
        active: true,
        profileImage: "",
        passwordHash: hashSecret("1234"),
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        employeeId: "ADMIN002",
        name: "Portal Administrator",
        email: "portaladmin@company.com",
        department: "Administration",
        manager: "System Administrator",
        role: "admin",
        active: true,
        profileImage: "",
        passwordHash: hashSecret("ASWIN@123"),
        createdAt: now,
      },
    ],
    entries: [],
    attendance: [],
    attendanceDevices: [],
    attendanceMappings: {},
  };
}

async function loadData() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    return JSON.parse(await fs.readFile(dataFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const data = await initialData();
    await saveData(data);
    return data;
  }
}

let data = await loadData();
data.attendance ??= [];
data.attendanceDevices ??= [];
data.attendanceMappings ??= {};
data.settings.attendanceLastSync ??= "";
data.settings.attendanceDeviceConfig ??= {};
if (!data.users.some((user) => user.role === "super_admin")) {
  const primaryAdmin =
    data.users.find((user) => user.employeeId === "ADMIN001" && user.role === "admin") ||
    data.users.find((user) => user.role === "admin");
  if (primaryAdmin) {
    primaryAdmin.role = "super_admin";
    await saveData();
  }
}
if (!data.users.some((user) => user.role === "admin")) {
  data.users.push({
    id: crypto.randomUUID(),
    employeeId: "ADMIN002",
    name: "Portal Administrator",
    email: "portaladmin@company.com",
    department: "Administration",
    manager: "System Administrator",
    role: "admin",
    active: true,
    profileImage: "",
    passwordHash: hashSecret("Admin@123"),
    createdAt: new Date().toISOString(),
  });
  await saveData();
}

function isSuperAdmin(user) {
  return user?.role === "super_admin";
}

function isAdminUser(user) {
  return ["super_admin", "admin"].includes(user?.role);
}

function hasManagerAccess(user) {
  return ["super_admin", "admin", "manager"].includes(user?.role);
}

async function saveData(nextData = data) {
  await fs.mkdir(dataDir, { recursive: true });
  const tempFile = `${dataFile}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(nextData, null, 2), "utf8");
  await fs.rename(tempFile, dataFile);
}

async function loadSessions() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const stored = JSON.parse(await fs.readFile(sessionFile, "utf8"));
    const now = Date.now();
    return new Map(
      Object.entries(stored).filter(([, session]) => session.expiresAt > now),
    );
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Unable to load saved sessions:", error);
    return new Map();
  }
}

const sessions = await loadSessions();

async function saveSessions() {
  await fs.mkdir(dataDir, { recursive: true });
  const tempFile = `${sessionFile}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(Object.fromEntries(sessions), null, 2), "utf8");
  await fs.rename(tempFile, sessionFile);
}

async function logDeviceRequest(request, url) {
  const address = String(request.socket.remoteAddress || "");
  if (
    !url.pathname.startsWith("/iclock/") &&
    address !== "192.168.1.201" &&
    address !== "::ffff:192.168.1.201"
  ) {
    return;
  }
  const line = [
    new Date().toISOString(),
    address,
    request.method,
    url.pathname,
    url.search,
  ].join("\t");
  await fs.appendFile(deviceRequestLogFile, `${line}\n`, "utf8");
}

function publicUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

function validateProfileImage(profileImage) {
  if (profileImage === undefined) return "";
  if (profileImage === "") return "";
  if (
    typeof profileImage !== "string" ||
    !/^data:image\/(jpeg|png|webp);base64,/i.test(profileImage)
  ) {
    return "Profile image must be JPG, PNG, or WebP.";
  }
  if (profileImage.length > 750_000) return "Profile image is too large.";
  return "";
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function getCurrentUser(request) {
  const token = parseCookies(request).session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token && sessions.delete(token)) void saveSessions();
    return null;
  }
  return data.users.find((user) => user.id === session.userId && user.active) || null;
}

function json(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const body = await readRawBody(request);
  return body ? JSON.parse(body) : {};
}

async function readRawBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body is too large.");
  }
  return body;
}

function requireUser(request, response, roles = []) {
  const user = getCurrentUser(request);
  if (!user) {
    json(response, 401, { error: "Please sign in." });
    return null;
  }
  if (roles.length && !roles.includes(user.role)) {
    json(response, 403, { error: "You do not have permission for this action." });
    return null;
  }
  return user;
}

function calculateHours(startTime, endTime, breakHours = 0) {
  if (!startTime || !endTime) return 0;
  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes < 0) minutes += 24 * 60;
  return Math.max(0, Math.round((minutes / 60 - Number(breakHours || 0)) * 100) / 100);
}

function validateEntry(body) {
  const required = ["date", "project", "details", "category", "startTime", "endTime"];
  const missing = required.find((field) => !String(body[field] || "").trim());
  if (missing) return "Please complete all required fields.";
  if (Number(body.breakHours || 0) < 0 || Number(body.breakHours || 0) > 8) {
    return "Break hours must be between 0 and 8.";
  }
  return "";
}

function attendanceDate(timestamp) {
  const match = String(timestamp || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T]/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "localhost";
}

function text(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function registerAttendanceDevice(serialNumber, request) {
  if (!serialNumber) return null;
  let device = data.attendanceDevices.find((item) => item.serialNumber === serialNumber);
  if (!device) {
    device = {
      id: crypto.randomUUID(),
      serialNumber,
      name: `eSSL Device ${serialNumber}`,
      ipAddress: request.socket.remoteAddress || "",
      lastSeenAt: new Date().toISOString(),
    };
    data.attendanceDevices.push(device);
  } else {
    device.ipAddress = request.socket.remoteAddress || device.ipAddress;
    device.lastSeenAt = new Date().toISOString();
  }
  return device;
}

function normalizeEmployeeCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^\d+$/.test(code) ? String(Number(code)) : code;
}

function findUserByPunchCode(punchCode) {
  const code = String(punchCode || "").trim().toUpperCase();
  const mappedUserId = data.attendanceMappings[code];
  if (mappedUserId) {
    const mappedUser = data.users.find((item) => item.active && item.id === mappedUserId);
    if (mappedUser) return mappedUser;
  }
  const exact = data.users.find(
    (item) => item.active && item.employeeId.toUpperCase() === code,
  );
  if (exact) return exact;
  const normalized = normalizeEmployeeCode(code);
  const normalizedMatches = data.users.filter(
    (item) => item.active && normalizeEmployeeCode(item.employeeId) === normalized,
  );
  return normalizedMatches.length === 1 ? normalizedMatches[0] : null;
}

function addPunch({ serialNumber, punchCode, timestamp, status = "", verifyMode = "", raw = "" }) {
  const normalizedCode = String(punchCode || "").trim().toUpperCase();
  const user = findUserByPunchCode(normalizedCode);
  const duplicate = data.attendance.some(
    (item) =>
      item.serialNumber === serialNumber &&
      item.punchCode === normalizedCode &&
      item.timestamp === timestamp,
  );
  if (duplicate || !normalizedCode || !timestamp) return false;
  data.attendance.push({
    id: crypto.randomUUID(),
    userId: user?.id || "",
    employeeId: user?.employeeId || "",
    punchCode: normalizedCode,
    timestamp,
    status: String(status),
    verifyMode: String(verifyMode),
    serialNumber: serialNumber || "UNKNOWN",
    raw,
    receivedAt: new Date().toISOString(),
  });
  return true;
}

async function forwardAttendanceToLive({ serialNumber, table, rawBody }) {
  if (!liveAttendanceForwardEnabled || !rawBody.trim() || !serialNumber) return;
  const endpoint = new URL(liveAttendanceForwardUrl);
  endpoint.searchParams.set("SN", serialNumber);
  endpoint.searchParams.set("table", table || "ATTLOG");
  endpoint.searchParams.set("Stamp", "local-forward");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: rawBody,
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error(`Live attendance forward failed: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.error("Live attendance forward failed:", error.message);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleAttendanceDevice(request, response, url) {
  const serialNumber = String(url.searchParams.get("SN") || url.searchParams.get("sn") || "").trim();
  const devicePath = url.pathname.replace(/\.aspx$/i, "");
  registerAttendanceDevice(serialNumber, request);

  if (request.method === "GET" && devicePath === "/iclock/cdata") {
    await saveData();
    return text(
      response,
      200,
      `GET OPTION FROM: ${serialNumber}\nATTLOGStamp=0\nOPERLOGStamp=0\nATTPHOTOStamp=0\nErrorDelay=60\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=1111000000\nRealtime=1\nEncrypt=0`,
    );
  }

  if (request.method === "POST" && devicePath === "/iclock/cdata") {
    const table = String(url.searchParams.get("table") || "").toUpperCase();
    const rawBody = await readRawBody(request);
    let added = 0;
    if (!table || table === "ATTLOG") {
      for (const line of rawBody.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        const [punchCode, timestamp, status, verifyMode] = line.split("\t");
        if (addPunch({ serialNumber, punchCode, timestamp, status, verifyMode, raw: line })) added += 1;
      }
    }
    data.settings.attendanceLastSync = new Date().toISOString();
    await saveData();
    if (!table || table === "ATTLOG") {
      await forwardAttendanceToLive({ serialNumber, table: table || "ATTLOG", rawBody });
    }
    return text(response, 200, `OK: ${added}`);
  }

  if (request.method === "GET" && devicePath === "/iclock/getrequest") {
    await saveData();
    return text(response, 200, "OK");
  }

  if (request.method === "POST" && devicePath === "/iclock/devicecmd") {
    await readRawBody(request);
    await saveData();
    return text(response, 200, "OK");
  }

  return text(response, 404, "Not Found");
}

async function handleApi(request, response, url) {
  const method = request.method;

  if (method === "GET" && url.pathname === "/api/health") {
    return json(response, 200, { ok: true });
  }

  if (method === "POST" && url.pathname === "/api/login") {
    const body = await readBody(request);
    const identity = String(body.identity || "").trim().toLowerCase();
    const user = data.users.find(
      (item) =>
        item.active &&
        (item.employeeId.toLowerCase() === identity || item.email.toLowerCase() === identity),
    );
    if (!user || !verifySecret(body.password || "", user.passwordHash)) {
      return json(response, 401, { error: "Invalid employee ID/email or password." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    await saveSessions();
    return json(
      response,
      200,
      { user: publicUser(user), settings: data.settings },
      { "Set-Cookie": `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` },
    );
  }

  if (method === "POST" && url.pathname === "/api/logout") {
    const token = parseCookies(request).session;
    if (token && sessions.delete(token)) await saveSessions();
    return json(
      response,
      200,
      { ok: true },
      { "Set-Cookie": "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" },
    );
  }

  if (method === "GET" && url.pathname === "/api/me") {
    const user = getCurrentUser(request);
    return json(response, 200, {
      user: user ? publicUser(user) : null,
      settings: data.settings,
    });
  }

  if (method === "PATCH" && url.pathname === "/api/profile") {
    const user = requireUser(request, response, ["employee"]);
    if (!user) return;
    const body = await readBody(request);
    const imageError = validateProfileImage(body.profileImage);
    if (imageError) return json(response, 400, { error: imageError });
    if (body.profileImage !== undefined) user.profileImage = body.profileImage;
    await saveData();
    return json(response, 200, { user: publicUser(user) });
  }

  if (method === "POST" && url.pathname === "/api/password-reset/request") {
    const user = requireUser(request, response, ["employee"]);
    if (!user) return;
    const existing = passwordResetRequests.get(user.id);
    if (existing?.lastSentAt && Date.now() - existing.lastSentAt < 60_000) {
      return json(response, 429, { error: "Please wait one minute before requesting another OTP." });
    }
    const otp = String(crypto.randomInt(100000, 1_000_000));
    const record = {
      otpHash: hashSecret(otp),
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
      lastSentAt: Date.now(),
    };
    try {
      await sendMail({
        to: user.email,
        subject: "Vestano password reset OTP",
        text:
          `Your Vestano Timesheet password reset OTP is ${otp}.\n\n` +
          "This OTP expires in 10 minutes. Do not share it with anyone.",
      });
    } catch (error) {
      return json(response, 503, { error: error.message });
    }
    passwordResetRequests.set(user.id, record);
    return json(response, 200, {
      ok: true,
      message: `OTP sent to ${user.email.replace(/^(.{2}).*(@.*)$/, "$1***$2")}.`,
    });
  }

  if (method === "POST" && url.pathname === "/api/password-reset/confirm") {
    const user = requireUser(request, response, ["employee"]);
    if (!user) return;
    const body = await readBody(request);
    const reset = passwordResetRequests.get(user.id);
    if (!reset || reset.expiresAt < Date.now()) {
      passwordResetRequests.delete(user.id);
      return json(response, 400, { error: "OTP has expired. Request a new OTP." });
    }
    if (reset.attempts >= 5) {
      passwordResetRequests.delete(user.id);
      return json(response, 429, { error: "Too many incorrect attempts. Request a new OTP." });
    }
    reset.attempts += 1;
    if (!verifySecret(String(body.otp || ""), reset.otpHash)) {
      return json(response, 400, { error: "Incorrect OTP." });
    }
    if (String(body.password || "").length < 4) {
      return json(response, 400, { error: "Password or PIN must have at least 4 characters." });
    }
    user.passwordHash = hashSecret(body.password);
    passwordResetRequests.delete(user.id);
    await saveData();
    return json(response, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/employees") {
    const user = requireUser(request, response, ["super_admin", "admin", "manager"]);
    if (!user) return;
    return json(response, 200, { employees: data.users.map(publicUser) });
  }

  if (method === "GET" && url.pathname === "/api/attendance") {
    const user = requireUser(request, response, ["super_admin", "admin", "employee"]);
    if (!user) return;
    const isAdmin = isAdminUser(user);
    const isSuper = isSuperAdmin(user);
    let records = isAdmin
      ? data.attendance
      : data.attendance.filter((record) => {
          const matchedUser =
            data.users.find((item) => item.id === record.userId) ||
            findUserByPunchCode(record.punchCode);
          return matchedUser?.id === user.id;
        });
    const employeeId = url.searchParams.get("employeeId");
    const userId = url.searchParams.get("userId");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (isAdmin && employeeId) {
      records = records.filter((record) => record.employeeId === employeeId);
    }
    if (isAdmin && userId) {
      records = records.filter((record) => {
        const matchedUser =
          data.users.find((item) => item.id === record.userId) ||
          findUserByPunchCode(record.punchCode);
        return matchedUser?.id === userId;
      });
    }
    if (from) records = records.filter((record) => attendanceDate(record.timestamp) >= from);
    if (to) records = records.filter((record) => attendanceDate(record.timestamp) <= to);
    records = records
      .map((record) => ({
        ...record,
        ...(() => {
          const matchedUser =
            data.users.find((item) => item.id === record.userId) ||
            findUserByPunchCode(record.punchCode);
          return {
            userId: matchedUser?.id || record.userId,
            employeeId: matchedUser?.employeeId || record.employeeId,
            employeeName: matchedUser?.name || `Unmatched code ${record.punchCode}`,
          };
        })(),
      }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const punchCodes = [...new Set(data.attendance.map((record) => record.punchCode))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((punchCode) => {
        const employee = findUserByPunchCode(punchCode);
        return {
          punchCode,
          userId: employee?.id || "",
          employeeId: employee?.employeeId || "",
          employeeName: employee?.name || "",
        };
      });
    return json(response, 200, {
      records,
      devices: isSuper ? data.attendanceDevices : [],
      lastSync: data.settings.attendanceLastSync,
      mappings: isSuper ? data.attendanceMappings : {},
      punchCodes: isSuper ? punchCodes : [],
    });
  }

  if (method === "GET" && url.pathname === "/api/attendance/device-setup") {
    const admin = requireUser(request, response, ["super_admin"]);
    if (!admin) return;
    return json(response, 200, {
      serverHost: getLanAddress(),
      protocol: "ADMS / iClock push",
      endpoint: `http://${getLanAddress()}:${attendancePort}/iclock/cdata`,
      port: attendancePort,
      employeeMapping: "Machine user code must equal the website Employee ID.",
      device: data.settings.attendanceDeviceConfig,
    });
  }

  if (method === "POST" && url.pathname === "/api/attendance/rematch") {
    const admin = requireUser(request, response, ["super_admin"]);
    if (!admin) return;
    let matched = 0;
    for (const record of data.attendance) {
      const user = findUserByPunchCode(record.punchCode);
      if (user && record.userId !== user.id) {
        record.userId = user.id;
        record.employeeId = user.employeeId;
        matched += 1;
      }
    }
    await saveData();
    return json(response, 200, { matched });
  }

  if (method === "POST" && url.pathname === "/api/attendance/mappings") {
    const admin = requireUser(request, response, ["super_admin"]);
    if (!admin) return;
    const body = await readBody(request);
    const punchCode = String(body.punchCode || "").trim().toUpperCase();
    const employee = data.users.find(
      (item) => item.active && item.id === body.userId && !isAdminUser(item),
    );
    if (!punchCode || !employee) {
      return json(response, 400, { error: "Select a valid punch code and employee." });
    }
    data.attendanceMappings[punchCode] = employee.id;
    let matched = 0;
    for (const record of data.attendance) {
      if (record.punchCode === punchCode) {
        record.userId = employee.id;
        record.employeeId = employee.employeeId;
        matched += 1;
      }
    }
    await saveData();
    return json(response, 200, {
      punchCode,
      employee: publicUser(employee),
      matched,
    });
  }

  const attendanceMatch = url.pathname.match(/^\/api\/attendance\/([^/]+)$/);
  if (attendanceMatch && method === "DELETE") {
    const admin = requireUser(request, response, ["super_admin"]);
    if (!admin) return;
    const index = data.attendance.findIndex((record) => record.id === attendanceMatch[1]);
    if (index === -1) return json(response, 404, { error: "Attendance punch not found." });
    data.attendance.splice(index, 1);
    await saveData();
    return json(response, 200, { ok: true });
  }

  const attendanceDeviceMatch = url.pathname.match(/^\/api\/attendance-devices\/([^/]+)$/);
  if (attendanceDeviceMatch && method === "DELETE") {
    const admin = requireUser(request, response, ["super_admin"]);
    if (!admin) return;
    const index = data.attendanceDevices.findIndex(
      (device) => device.id === attendanceDeviceMatch[1],
    );
    if (index === -1) return json(response, 404, { error: "Attendance device not found." });
    data.attendanceDevices.splice(index, 1);
    await saveData();
    return json(response, 200, { ok: true });
  }

  if (method === "POST" && url.pathname === "/api/employees") {
    const admin = requireUser(request, response, ["super_admin", "admin"]);
    if (!admin) return;
    const body = await readBody(request);
    const employeeId = String(body.employeeId || "").trim().toUpperCase();
    const email = String(body.email || "").trim().toLowerCase();
    if (!employeeId || !body.name || !email || !body.password) {
      return json(response, 400, { error: "Employee ID, name, email, and password are required." });
    }
    if (data.users.some((user) => user.employeeId === employeeId || user.email === email)) {
      return json(response, 409, { error: "Employee ID or email already exists." });
    }
    const employee = {
      id: crypto.randomUUID(),
      employeeId,
      name: String(body.name).trim(),
      email,
      department: String(body.department || "Other").trim(),
      manager: String(body.manager || "").trim(),
      role:
        isSuperAdmin(admin) && ["employee", "manager", "admin"].includes(body.role)
          ? body.role
          : ["employee", "manager"].includes(body.role)
            ? body.role
            : "employee",
      active: true,
      profileImage: "",
      passwordHash: hashSecret(body.password),
      createdAt: new Date().toISOString(),
    };
    data.users.push(employee);
    await saveData();
    return json(response, 201, { employee: publicUser(employee) });
  }

  const employeeMatch = url.pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch && method === "PATCH") {
    const admin = requireUser(request, response, ["super_admin", "admin"]);
    if (!admin) return;
    const employee = data.users.find((user) => user.id === employeeMatch[1]);
    if (!employee) return json(response, 404, { error: "Employee not found." });
    if (!isSuperAdmin(admin) && isAdminUser(employee)) {
      return json(response, 403, { error: "Only the super admin can manage administrator accounts." });
    }
    const body = await readBody(request);
    if (body.employeeId !== undefined) {
      const employeeId = String(body.employeeId).trim().toUpperCase();
      if (!employeeId) return json(response, 400, { error: "Employee ID is required." });
      if (data.users.some((user) => user.id !== employee.id && user.employeeId === employeeId)) {
        return json(response, 409, { error: "Employee ID already exists." });
      }
      employee.employeeId = employeeId;
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!email) return json(response, 400, { error: "Email is required." });
      if (data.users.some((user) => user.id !== employee.id && user.email === email)) {
        return json(response, 409, { error: "Email already exists." });
      }
      employee.email = email;
    }
    for (const field of ["name", "department", "manager"]) {
      if (body[field] !== undefined) employee[field] = String(body[field]).trim();
    }
    if (
      body.role &&
      (
        (isSuperAdmin(admin) && ["employee", "manager", "admin"].includes(body.role)) ||
        ["employee", "manager"].includes(body.role)
      ) &&
      !isAdminUser(employee)
    ) {
      employee.role = body.role;
    }
    if (body.role === "admin" && isSuperAdmin(admin) && employee.role !== "super_admin") {
      employee.role = "admin";
    }
    if (typeof body.active === "boolean" && employee.id !== admin.id) employee.active = body.active;
    if (body.password) employee.passwordHash = hashSecret(body.password);
    await saveData();
    return json(response, 200, { employee: publicUser(employee) });
  }

  if (employeeMatch && method === "DELETE") {
    const admin = requireUser(request, response, ["super_admin", "admin"]);
    if (!admin) return;
    const index = data.users.findIndex((user) => user.id === employeeMatch[1]);
    if (index === -1) return json(response, 404, { error: "Employee not found." });
    const employee = data.users[index];
    if (!isSuperAdmin(admin) && isAdminUser(employee)) {
      return json(response, 403, { error: "Only the super admin can manage administrator accounts." });
    }
    if (isAdminUser(employee) || employee.id === admin.id) {
      return json(response, 400, { error: "The administrator account cannot be deleted." });
    }
    if (employee.active) {
      return json(response, 409, {
        error: "Deactivate the employee before deleting the account.",
      });
    }
    data.users.splice(index, 1);
    data.entries = data.entries.filter((entry) => entry.userId !== employee.id);
    data.attendance = data.attendance.filter((record) => record.userId !== employee.id);
    for (const [code, userId] of Object.entries(data.attendanceMappings)) {
      if (userId === employee.id) delete data.attendanceMappings[code];
    }
    for (const [token, session] of sessions) {
      if (session.userId === employee.id) sessions.delete(token);
    }
    await Promise.all([saveData(), saveSessions()]);
    return json(response, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/entries") {
    const user = requireUser(request, response);
    if (!user) return;
    const allAccess = hasManagerAccess(user);
    let entries = allAccess ? data.entries : data.entries.filter((entry) => entry.userId === user.id);
    const employeeId = url.searchParams.get("employeeId");
    const status = url.searchParams.get("status");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (employeeId) entries = entries.filter((entry) => entry.employeeId === employeeId);
    if (status) entries = entries.filter((entry) => entry.approvalStatus === status);
    if (from) entries = entries.filter((entry) => entry.date >= from);
    if (to) entries = entries.filter((entry) => entry.date <= to);
    entries = entries
      .map((entry) => ({
        ...entry,
        employeeName: data.users.find((item) => item.id === entry.userId)?.name || "Former employee",
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    return json(response, 200, { entries });
  }

  if (method === "POST" && url.pathname === "/api/entries") {
    const user = requireUser(request, response);
    if (!user) return;
    const body = await readBody(request);
    const validationError = validateEntry(body);
    if (validationError) return json(response, 400, { error: validationError });
    const totalHours = calculateHours(body.startTime, body.endTime, body.breakHours);
    const entry = {
      id: crypto.randomUUID(),
      userId: user.id,
      employeeId: user.employeeId,
      date: body.date,
      project: String(body.project).trim(),
      details: String(body.details).trim(),
      category: String(body.category).trim(),
      startTime: body.startTime,
      endTime: body.endTime,
      breakHours: Number(body.breakHours || 0),
      totalHours,
      overtime: Math.max(0, Math.round((totalHours - data.settings.standardHours) * 100) / 100),
      billable: body.billable === true,
      workStatus: String(body.workStatus || "Completed"),
      comments: String(body.comments || "").trim(),
      approvalStatus: "Submitted",
      approvalComment: "",
      approvedBy: "",
      approvedAt: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.entries.push(entry);
    await saveData();
    return json(response, 201, { entry });
  }

  const entryMatch = url.pathname.match(/^\/api\/entries\/([^/]+)$/);
  if (entryMatch && method === "PATCH") {
    const user = requireUser(request, response);
    if (!user) return;
    const entry = data.entries.find((item) => item.id === entryMatch[1]);
    if (!entry) return json(response, 404, { error: "Timesheet entry not found." });
    const body = await readBody(request);
    const isApprover = isAdminUser(user);

    if (body.approvalStatus !== undefined) {
      if (!isApprover) return json(response, 403, { error: "Only admins can approve entries." });
      if (!["Approved", "Rejected", "Submitted"].includes(body.approvalStatus)) {
        return json(response, 400, { error: "Invalid approval status." });
      }
      entry.approvalStatus = body.approvalStatus;
      entry.approvalComment = String(body.approvalComment || "").trim();
      entry.approvedBy = user.name;
      entry.approvedAt = new Date().toISOString();
    } else {
      if (entry.userId !== user.id || entry.approvalStatus === "Approved") {
        return json(response, 403, { error: "This entry cannot be edited." });
      }
      const merged = { ...entry, ...body };
      const validationError = validateEntry(merged);
      if (validationError) return json(response, 400, { error: validationError });
      for (const field of [
        "date", "project", "details", "category", "startTime", "endTime",
        "workStatus", "comments",
      ]) {
        if (body[field] !== undefined) entry[field] = String(body[field]).trim();
      }
      if (body.breakHours !== undefined) entry.breakHours = Number(body.breakHours);
      if (body.billable !== undefined) entry.billable = body.billable === true;
      entry.totalHours = calculateHours(entry.startTime, entry.endTime, entry.breakHours);
      entry.overtime = Math.max(
        0,
        Math.round((entry.totalHours - data.settings.standardHours) * 100) / 100,
      );
      entry.approvalStatus = "Submitted";
    }
    entry.updatedAt = new Date().toISOString();
    await saveData();
    return json(response, 200, { entry });
  }

  if (entryMatch && method === "DELETE") {
    const user = requireUser(request, response);
    if (!user) return;
    const index = data.entries.findIndex((item) => item.id === entryMatch[1]);
    if (index === -1) return json(response, 404, { error: "Timesheet entry not found." });
    const entry = data.entries[index];
    if (!isSuperAdmin(user) && (entry.userId !== user.id || entry.approvalStatus === "Approved")) {
      return json(response, 403, { error: "This entry cannot be deleted." });
    }
    data.entries.splice(index, 1);
    await saveData();
    return json(response, 200, { ok: true });
  }

  if (method === "GET" && url.pathname === "/api/dashboard") {
    const user = requireUser(request, response);
    if (!user) return;
    const visible = hasManagerAccess(user)
      ? data.entries
      : data.entries.filter((entry) => entry.userId === user.id);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const thisMonth = visible.filter((entry) => entry.date.startsWith(month));
    const totals = {
      hours: thisMonth.reduce((sum, entry) => sum + entry.totalHours, 0),
      overtime: thisMonth.reduce((sum, entry) => sum + entry.overtime, 0),
      billable: thisMonth
        .filter((entry) => entry.billable)
        .reduce((sum, entry) => sum + entry.totalHours, 0),
      pending: visible.filter((entry) => entry.approvalStatus === "Submitted").length,
      employees: data.users.filter((item) => item.active && !isAdminUser(item)).length,
    };
    return json(response, 200, { totals });
  }

  return json(response, 404, { error: "API route not found." });
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return json(response, 403, { error: "Forbidden." });
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  } catch {
    const content = await fs.readFile(path.join(publicDir, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(content);
  }
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    await logDeviceRequest(request, url);
    if (url.pathname.startsWith("/iclock/")) {
      await handleAttendanceDevice(request, response, url);
    } else if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else {
      await serveStatic(response, url.pathname);
    }
  } catch (error) {
    console.error(error);
    json(response, 500, { error: "Unexpected server error." });
  }
}

const server = http.createServer(handleRequest);
const attendanceServer =
  attendancePort === port ? null : http.createServer(handleRequest);

server.listen(port, host, () => {
  console.log(`Corporate Timesheet Portal running at http://localhost:${port}`);
});

if (attendanceServer) {
  attendanceServer.listen(attendancePort, host, () => {
    console.log(`eSSL attendance receiver running on port ${attendancePort}`);
  });
}
