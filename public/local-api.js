const STORAGE_KEY = "vestano-timesheet-local";

const settings = {
  companyName: "Vestano International Pvt Ltd",
  standardHours: 8,
  attendanceLastSync: new Date().toISOString(),
  attendanceDeviceConfig: {
    model: "K90 Pro",
    serialNumber: "DEMO-K90",
    ipAddress: "Not connected",
    connectionType: "Browser",
    mode: "Demo",
  },
};

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function initialData() {
  return {
    currentUserId: null,
    users: [
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
        password: "Admin@123",
        createdAt: new Date().toISOString(),
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
        password: "1234",
        createdAt: new Date().toISOString(),
      },
    ],
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
        approvedBy: "",
        approvedAt: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    attendanceMappings: { EMP001: "demo-employee" },
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

function publicUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

function currentUser(data) {
  return publicUser(data.users.find((user) => user.id === data.currentUserId && user.active));
}

function requireUser(data) {
  const user = data.users.find((item) => item.id === data.currentUserId && item.active);
  if (!user) throw new Error("Please sign in.");
  return user;
}

function requireAdmin(data) {
  const user = requireUser(data);
  if (user.role !== "admin") throw new Error("Only admins can perform this action.");
  return user;
}

function calculateHours(start, end, breakHours) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  return Math.max(0, Math.round((minutes / 60 - Number(breakHours || 0)) * 100) / 100);
}

function employeeFor(data, userId) {
  return data.users.find((user) => user.id === userId);
}

function enrichEntry(data, entry) {
  const employee = employeeFor(data, entry.userId);
  return {
    ...entry,
    employeeName: employee?.name || entry.employeeName || "Former employee",
    employeeId: employee?.employeeId || entry.employeeId,
  };
}

function attendanceFor(user) {
  if (!user || user.role === "admin") return [];
  return [
    {
      id: `${user.id}-punch-1`,
      userId: user.id,
      employeeId: user.employeeId,
      employeeName: user.name,
      punchCode: user.employeeId,
      timestamp: `${dateOffset(0)} 09:02:00`,
      serialNumber: "DEMO-K90",
    },
    {
      id: `${user.id}-punch-2`,
      userId: user.id,
      employeeId: user.employeeId,
      employeeName: user.name,
      punchCode: user.employeeId,
      timestamp: `${dateOffset(0)} 17:31:00`,
      serialNumber: "DEMO-K90",
    },
  ];
}

function filteredEntries(data, user, params) {
  let entries = user.role === "admin"
    ? data.entries
    : data.entries.filter((entry) => entry.userId === user.id);
  if (params.get("status")) entries = entries.filter((entry) => entry.approvalStatus === params.get("status"));
  if (params.get("from")) entries = entries.filter((entry) => entry.date >= params.get("from"));
  if (params.get("to")) entries = entries.filter((entry) => entry.date <= params.get("to"));
  return entries
    .map((entry) => enrichEntry(data, entry))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function employeePayload(body) {
  return {
    employeeId: String(body.employeeId || "").trim(),
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    department: String(body.department || "Other"),
    manager: String(body.manager || "").trim(),
    role: ["employee", "manager"].includes(body.role) ? body.role : "employee",
  };
}

export async function localApi(path, options = {}) {
  const data = loadData();
  const method = options.method || "GET";
  const url = new URL(path, location.origin);
  const body = options.body ? JSON.parse(options.body) : {};

  if (url.pathname === "/api/me") {
    return { user: currentUser(data), settings };
  }

  if (url.pathname === "/api/login" && method === "POST") {
    const identity = String(body.identity || "").trim().toLowerCase();
    const user = data.users.find(
      (item) =>
        item.active &&
        (item.employeeId.toLowerCase() === identity || item.email.toLowerCase() === identity),
    );
    if (!user || user.password !== body.password) {
      throw new Error("Invalid employee ID/email or password.");
    }
    data.currentUserId = user.id;
    saveData(data);
    return { user: publicUser(user), settings };
  }

  if (url.pathname === "/api/logout" && method === "POST") {
    data.currentUserId = null;
    saveData(data);
    return { ok: true };
  }

  const user = requireUser(data);

  if (url.pathname === "/api/dashboard") {
    const entries = user.role === "admin"
      ? data.entries
      : data.entries.filter((entry) => entry.userId === user.id);
    return {
      totals: {
        hours: entries.reduce((sum, entry) => sum + entry.totalHours, 0),
        overtime: entries.reduce((sum, entry) => sum + entry.overtime, 0),
        billable: entries.filter((entry) => entry.billable).reduce((sum, entry) => sum + entry.totalHours, 0),
        pending: entries.filter((entry) => entry.approvalStatus === "Submitted").length,
        employees: data.users.filter((item) => item.active && item.role !== "admin").length,
      },
    };
  }

  if (url.pathname === "/api/entries" && method === "GET") {
    return { entries: filteredEntries(data, user, url.searchParams) };
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
      approvedBy: "",
      approvedAt: "",
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
    if (body.approvalStatus !== undefined) {
      const admin = requireAdmin(data);
      entry.approvalStatus = body.approvalStatus;
      entry.approvalComment = String(body.approvalComment || "").trim();
      entry.approvedBy = admin.name;
      entry.approvedAt = new Date().toISOString();
    } else {
      if (entry.userId !== user.id || entry.approvalStatus === "Approved") {
        throw new Error("This entry cannot be edited.");
      }
      Object.assign(entry, body);
      entry.totalHours = calculateHours(entry.startTime, entry.endTime, entry.breakHours);
      entry.overtime = Math.max(0, entry.totalHours - settings.standardHours);
      entry.approvalStatus = "Submitted";
    }
    entry.updatedAt = new Date().toISOString();
    saveData(data);
    return { entry: enrichEntry(data, entry) };
  }

  if (entryMatch && method === "DELETE") {
    const index = data.entries.findIndex((entry) => entry.id === entryMatch[1]);
    if (index === -1 || data.entries[index].userId !== user.id || data.entries[index].approvalStatus === "Approved") {
      throw new Error("This entry cannot be deleted.");
    }
    data.entries.splice(index, 1);
    saveData(data);
    return { ok: true };
  }

  if (url.pathname === "/api/employees" && method === "GET") {
    requireAdmin(data);
    return { employees: data.users.map(publicUser) };
  }

  if (url.pathname === "/api/employees" && method === "POST") {
    requireAdmin(data);
    const values = employeePayload(body);
    if (!values.employeeId || !values.name || !values.email || !body.password) {
      throw new Error("Employee ID, name, email, and password are required.");
    }
    if (data.users.some((item) => item.employeeId.toLowerCase() === values.employeeId.toLowerCase())) {
      throw new Error("Employee ID already exists.");
    }
    if (data.users.some((item) => item.email.toLowerCase() === values.email.toLowerCase())) {
      throw new Error("Email already exists.");
    }
    const employee = {
      id: crypto.randomUUID(),
      ...values,
      active: true,
      profileImage: "",
      password: String(body.password),
      createdAt: new Date().toISOString(),
    };
    data.users.push(employee);
    saveData(data);
    return { employee: publicUser(employee) };
  }

  const employeeMatch = url.pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch && method === "PATCH") {
    requireAdmin(data);
    const employee = data.users.find((item) => item.id === employeeMatch[1]);
    if (!employee) throw new Error("Employee not found.");
    if (employee.role === "admin" && body.active === false) throw new Error("Admin accounts cannot be deactivated.");
    Object.assign(employee, employeePayload({ ...employee, ...body }));
    if (body.active !== undefined) employee.active = Boolean(body.active);
    if (body.password) employee.password = String(body.password);
    saveData(data);
    return { employee: publicUser(employee) };
  }

  if (employeeMatch && method === "DELETE") {
    requireAdmin(data);
    const index = data.users.findIndex((item) => item.id === employeeMatch[1]);
    if (index === -1) throw new Error("Employee not found.");
    if (data.users[index].role === "admin" || data.users[index].active) {
      throw new Error("Deactivate non-admin employees before deleting them.");
    }
    data.entries = data.entries.filter((entry) => entry.userId !== data.users[index].id);
    data.users.splice(index, 1);
    saveData(data);
    return { ok: true };
  }

  if (url.pathname === "/api/profile" && method === "PATCH") {
    user.profileImage = body.profileImage ?? user.profileImage;
    saveData(data);
    return { user: publicUser(user) };
  }

  if (url.pathname === "/api/password-reset/request" && method === "POST") {
    return { ok: true, message: "Browser fallback mode does not send email. Use your current password." };
  }

  if (url.pathname === "/api/password-reset/confirm" && method === "POST") {
    user.password = String(body.password || "");
    saveData(data);
    return { ok: true };
  }

  if (url.pathname === "/api/attendance") {
    const employeeRecords = user.role === "admin"
      ? data.users.filter((item) => item.role !== "admin").flatMap(attendanceFor)
      : attendanceFor(user);
    return {
      records: employeeRecords,
      devices: [{ serialNumber: "DEMO-K90" }],
      lastSync: settings.attendanceLastSync,
      punchCodes: data.users
        .filter((item) => item.role !== "admin")
        .map((item) => ({ punchCode: item.employeeId, userId: item.id, employeeName: item.name })),
    };
  }

  if (url.pathname === "/api/attendance/device-setup") {
    return {
      serverHost: "Supabase not configured",
      port: "N/A",
      protocol: "Browser fallback",
      device: settings.attendanceDeviceConfig,
    };
  }

  if (url.pathname === "/api/attendance/mappings" && method === "POST") {
    requireAdmin(data);
    data.attendanceMappings[body.punchCode] = body.userId;
    saveData(data);
    const employee = data.users.find((item) => item.id === body.userId);
    return { matched: 0, employee: publicUser(employee) };
  }

  throw new Error("This action is not available.");
}
