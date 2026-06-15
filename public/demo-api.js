const STORAGE_KEY = "vestano-timesheet-demo";

const settings = {
  companyName: "Vestano International Pvt Ltd",
  standardHours: 8,
};

const users = [
  {
    id: "demo-admin",
    employeeId: "ADMIN001",
    name: "System Administrator",
    email: "admin@company.com",
    department: "Administration",
    manager: "",
    role: "admin",
    active: true,
    profileImage: "",
  },
  {
    id: "demo-employee",
    employeeId: "EMP001",
    name: "Demo Employee",
    email: "employee@company.com",
    department: "Information Technology",
    manager: "System Administrator",
    role: "employee",
    active: true,
    profileImage: "",
  },
];

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function initialData() {
  return {
    userId: null,
    entries: [
      {
        id: "demo-entry-1",
        userId: "demo-employee",
        employeeId: "EMP001",
        employeeName: "Demo Employee",
        date: dateOffset(0),
        project: "Timesheet Portal",
        details: "Reviewed daily tasks and updated project progress.",
        category: "Project Work",
        startTime: "09:00",
        endTime: "17:30",
        breakHours: 0.5,
        totalHours: 8,
        overtime: 0,
        billable: true,
        workStatus: "Completed",
        comments: "",
        approvalStatus: "Submitted",
        approvalComment: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

function loadData() {
  try {
    return { ...initialData(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return initialData();
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function currentUser(data) {
  return users.find((user) => user.id === data.userId) || null;
}

function calculateHours(start, end, breakHours) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return Math.max(0, (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60 - Number(breakHours || 0));
}

function attendanceFor(user) {
  if (!user || user.role !== "employee") return [];
  return [
    {
      id: "demo-punch-1",
      userId: user.id,
      employeeId: user.employeeId,
      employeeName: user.name,
      punchCode: user.employeeId,
      timestamp: `${dateOffset(0)} 09:02:00`,
      serialNumber: "DEMO-K90",
    },
    {
      id: "demo-punch-2",
      userId: user.id,
      employeeId: user.employeeId,
      employeeName: user.name,
      punchCode: user.employeeId,
      timestamp: `${dateOffset(0)} 17:31:00`,
      serialNumber: "DEMO-K90",
    },
  ];
}

function requireUser(data) {
  const user = currentUser(data);
  if (!user) throw new Error("Please sign in.");
  return user;
}

export function useDemoApi() {
  return location.hostname.endsWith("github.io");
}

export async function demoApi(path, options = {}) {
  const data = loadData();
  const method = options.method || "GET";
  const url = new URL(path, location.origin);
  const body = options.body ? JSON.parse(options.body) : {};

  if (url.pathname === "/api/me") {
    return { user: currentUser(data), settings };
  }

  if (url.pathname === "/api/login" && method === "POST") {
    const identity = String(body.identity || "").trim().toLowerCase();
    const match =
      identity === "emp001" || identity === "employee@company.com"
        ? { user: users[1], password: "1234" }
        : identity === "admin001" || identity === "admin@company.com"
          ? { user: users[0], password: "Admin@123" }
          : null;
    if (!match || body.password !== match.password) {
      throw new Error("Invalid employee ID/email or password.");
    }
    data.userId = match.user.id;
    saveData(data);
    return { user: match.user, settings };
  }

  if (url.pathname === "/api/logout" && method === "POST") {
    data.userId = null;
    saveData(data);
    return { ok: true };
  }

  const user = requireUser(data);

  if (url.pathname === "/api/dashboard") {
    const visible = user.role === "admin" ? data.entries : data.entries.filter((entry) => entry.userId === user.id);
    return {
      totals: {
        hours: visible.reduce((sum, entry) => sum + entry.totalHours, 0),
        overtime: visible.reduce((sum, entry) => sum + entry.overtime, 0),
        billable: visible.filter((entry) => entry.billable).reduce((sum, entry) => sum + entry.totalHours, 0),
        pending: visible.filter((entry) => entry.approvalStatus === "Submitted").length,
        employees: users.filter((item) => item.active && item.role !== "admin").length,
      },
    };
  }

  if (url.pathname === "/api/entries" && method === "GET") {
    let entries = user.role === "admin" ? data.entries : data.entries.filter((entry) => entry.userId === user.id);
    const status = url.searchParams.get("status");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (status) entries = entries.filter((entry) => entry.approvalStatus === status);
    if (from) entries = entries.filter((entry) => entry.date >= from);
    if (to) entries = entries.filter((entry) => entry.date <= to);
    return { entries: [...entries].sort((a, b) => b.date.localeCompare(a.date)) };
  }

  if (url.pathname === "/api/entries" && method === "POST") {
    const totalHours = calculateHours(body.startTime, body.endTime, body.breakHours);
    const entry = {
      ...body,
      id: crypto.randomUUID(),
      userId: user.id,
      employeeId: user.employeeId,
      employeeName: user.name,
      totalHours,
      overtime: Math.max(0, totalHours - settings.standardHours),
      approvalStatus: "Submitted",
      approvalComment: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    data.entries.push(entry);
    saveData(data);
    return { entry };
  }

  const entryMatch = url.pathname.match(/^\/api\/entries\/([^/]+)$/);
  if (entryMatch && method === "PATCH") {
    const entry = data.entries.find((item) => item.id === entryMatch[1]);
    if (!entry) throw new Error("Timesheet entry not found.");
    Object.assign(entry, body, { updatedAt: new Date().toISOString() });
    if (body.approvalStatus === undefined) {
      entry.totalHours = calculateHours(entry.startTime, entry.endTime, entry.breakHours);
      entry.overtime = Math.max(0, entry.totalHours - settings.standardHours);
      entry.approvalStatus = "Submitted";
    }
    saveData(data);
    return { entry };
  }

  if (entryMatch && method === "DELETE") {
    data.entries = data.entries.filter((entry) => entry.id !== entryMatch[1]);
    saveData(data);
    return { ok: true };
  }

  if (url.pathname === "/api/employees") {
    return { employees: users };
  }

  if (url.pathname === "/api/attendance") {
    const records =
      user.role === "admin"
        ? users.filter((item) => item.role === "employee").flatMap(attendanceFor)
        : attendanceFor(user);
    return {
      records,
      devices: [{ serialNumber: "DEMO-K90" }],
      lastSync: new Date().toISOString(),
      punchCodes: [{ punchCode: "EMP001", userId: "demo-employee", employeeName: "Demo Employee" }],
    };
  }

  if (url.pathname === "/api/attendance/device-setup") {
    return {
      serverHost: "Demo mode",
      port: "N/A",
      protocol: "Browser demo",
      device: {
        model: "K90 Pro",
        serialNumber: "DEMO-K90",
        ipAddress: "Not connected",
        mode: "Demo",
        connectionType: "Browser",
      },
    };
  }

  if (url.pathname === "/api/profile" && method === "PATCH") {
    user.profileImage = body.profileImage ?? user.profileImage;
    return { user };
  }

  throw new Error("This action requires the live server.");
}
