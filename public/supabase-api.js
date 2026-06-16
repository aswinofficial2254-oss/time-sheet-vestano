import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config.js?v=1";
import { localApi } from "./local-api.js?v=1";

const configured =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("YOUR_PROJECT_REF") &&
  SUPABASE_ANON_KEY.length > 40 &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const settingsFallback = {
  companyName: "Vestano International Pvt Ltd",
  standardHours: 8,
  attendanceLastSync: "",
  attendanceDeviceConfig: {},
};

function requireClient() {
  if (!supabase) {
    throw new Error("Supabase is not configured yet. Add the project URL and anon key.");
  }
  return supabase;
}

function throwIfError(error) {
  if (error) throw new Error(error.message || "Supabase request failed.");
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function mapProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    employeeId: profile.employee_id,
    name: profile.name,
    email: profile.email,
    department: profile.department,
    manager: profile.manager,
    role: profile.role,
    active: profile.active,
    profileImage: profile.profile_image || "",
    createdAt: profile.created_at,
  };
}

function mapSettings(settings) {
  if (!settings) return settingsFallback;
  return {
    companyName: settings.company_name,
    standardHours: Number(settings.standard_hours),
    attendanceLastSync: settings.attendance_last_sync || "",
    attendanceDeviceConfig: settings.attendance_device_config || {},
  };
}

function mapEntry(entry) {
  return {
    id: entry.id,
    userId: entry.user_id,
    employeeId: entry.employee_id,
    employeeName: entry.employee_name,
    date: entry.work_date,
    project: entry.project,
    details: entry.details,
    category: entry.category,
    startTime: String(entry.start_time).slice(0, 5),
    endTime: String(entry.end_time).slice(0, 5),
    breakHours: Number(entry.break_hours),
    totalHours: Number(entry.total_hours),
    overtime: Number(entry.overtime),
    billable: entry.billable,
    workStatus: entry.work_status,
    comments: entry.comments,
    approvalStatus: entry.approval_status,
    approvalComment: entry.approval_comment,
    approvedBy: entry.approved_by,
    approvedAt: entry.approved_at,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

function indiaTimestamp(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(value))
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function mapAttendance(record) {
  return {
    id: record.id,
    userId: record.user_id,
    employeeId: record.employee_id,
    employeeName: record.employee_name,
    punchCode: record.punch_code,
    timestamp: indiaTimestamp(record.punched_at),
    serialNumber: record.serial_number,
    status: record.status,
    verifyMode: record.verify_mode,
  };
}

async function currentProfile() {
  const client = requireClient();
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) return null;

  const { data, error } = await client.from("profiles").select("*").eq("id", session.user.id).single();
  throwIfError(error);
  if (!data.active) {
    await client.auth.signOut();
    throw new Error("This employee account is inactive.");
  }
  return mapProfile(data);
}

async function getSettings() {
  const { data, error } = await requireClient().from("app_settings").select("*").eq("id", true).single();
  throwIfError(error);
  return mapSettings(data);
}

async function getEntries(params = new URLSearchParams()) {
  let query = requireClient()
    .from("timesheet_entries")
    .select("*")
    .order("work_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (params.get("status")) query = query.eq("approval_status", params.get("status"));
  if (params.get("from")) query = query.gte("work_date", params.get("from"));
  if (params.get("to")) query = query.lte("work_date", params.get("to"));
  if (params.get("employeeId")) query = query.eq("employee_id", params.get("employeeId"));
  const { data, error } = await query;
  throwIfError(error);
  return data.map(mapEntry);
}

function entryRpcValues(body) {
  return {
    p_work_date: body.date,
    p_project: body.project,
    p_details: body.details,
    p_category: body.category,
    p_start_time: body.startTime,
    p_end_time: body.endTime,
    p_break_hours: Number(body.breakHours || 0),
    p_billable: body.billable === true,
    p_work_status: body.workStatus || "Completed",
    p_comments: body.comments || "",
  };
}

async function invokeEmployee(action, body) {
  const { data, error } = await requireClient().functions.invoke("admin-users", {
    body: { action, ...body },
  });
  throwIfError(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useSupabaseApi() {
  return location.hostname.endsWith("github.io");
}

export async function supabaseApi(path, options = {}) {
  if (!configured) return localApi(path, options);
  const client = requireClient();
  const method = options.method || "GET";
  const url = new URL(path, location.origin);
  const body = options.body ? JSON.parse(options.body) : {};

  if (url.pathname === "/api/me") {
    const user = await currentProfile();
    return { user, settings: user ? await getSettings() : settingsFallback };
  }

  if (url.pathname === "/api/login" && method === "POST") {
    const identity = String(body.identity || "").trim();
    const { data: email, error: resolveError } = await client.rpc("resolve_login_email", { identity });
    throwIfError(resolveError);
    if (!email) throw new Error("Invalid employee ID/email or password.");
    const { error } = await client.auth.signInWithPassword({ email, password: String(body.password || "") });
    if (error) throw new Error("Invalid employee ID/email or password.");
    return { user: await currentProfile(), settings: await getSettings() };
  }

  if (url.pathname === "/api/logout" && method === "POST") {
    const { error } = await client.auth.signOut();
    throwIfError(error);
    return { ok: true };
  }

  const user = await currentProfile();
  if (!user) throw new Error("Please sign in.");

  if (url.pathname === "/api/dashboard") {
    const { data, error } = await client.rpc("get_dashboard_totals");
    throwIfError(error);
    return {
      totals: {
        hours: Number(data.hours || 0),
        overtime: Number(data.overtime || 0),
        billable: Number(data.billable || 0),
        pending: Number(data.pending || 0),
        employees: Number(data.employees || 0),
      },
    };
  }

  if (url.pathname === "/api/entries" && method === "GET") {
    return { entries: await getEntries(url.searchParams) };
  }

  if (url.pathname === "/api/entries" && method === "POST") {
    const { data, error } = await client.rpc("create_timesheet_entry", entryRpcValues(body));
    throwIfError(error);
    return { entry: mapEntry(firstRow(data)) };
  }

  const entryMatch = url.pathname.match(/^\/api\/entries\/([^/]+)$/);
  if (entryMatch && method === "PATCH") {
    if (body.approvalStatus !== undefined) {
      const { data, error } = await client.rpc("review_timesheet_entry", {
        p_id: entryMatch[1],
        p_approval_status: body.approvalStatus,
        p_approval_comment: body.approvalComment || "",
      });
      throwIfError(error);
      return { entry: mapEntry(firstRow(data)) };
    }
    const { data, error } = await client.rpc("update_timesheet_entry", {
      p_id: entryMatch[1],
      ...entryRpcValues(body),
    });
    throwIfError(error);
    return { entry: mapEntry(firstRow(data)) };
  }

  if (entryMatch && method === "DELETE") {
    const { error } = await client.rpc("delete_timesheet_entry", { p_id: entryMatch[1] });
    throwIfError(error);
    return { ok: true };
  }

  if (url.pathname === "/api/employees" && method === "GET") {
    const { data, error } = await client.from("profiles").select("*").order("name");
    throwIfError(error);
    return { employees: data.map(mapProfile) };
  }

  if (url.pathname === "/api/employees" && method === "POST") {
    return invokeEmployee("create", body);
  }

  const employeeMatch = url.pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch && method === "PATCH") {
    return invokeEmployee("update", { userId: employeeMatch[1], ...body });
  }

  if (employeeMatch && method === "DELETE") {
    return invokeEmployee("delete", { userId: employeeMatch[1] });
  }

  if (url.pathname === "/api/profile" && method === "PATCH") {
    const { data, error } = await client.rpc("update_profile_image", {
      p_profile_image: body.profileImage || "",
    });
    throwIfError(error);
    return { user: mapProfile(firstRow(data)) };
  }

  if (url.pathname === "/api/password-reset/request" && method === "POST") {
    const { error } = await client.auth.signInWithOtp({
      email: user.email,
      options: { shouldCreateUser: false },
    });
    throwIfError(error);
    sessionStorage.setItem("vestano-reset-email", user.email);
    return { ok: true, message: `OTP sent to ${user.email.replace(/^(.{2}).*(@.*)$/, "$1***$2")}.` };
  }

  if (url.pathname === "/api/password-reset/confirm" && method === "POST") {
    const email = sessionStorage.getItem("vestano-reset-email") || user.email;
    const { error: otpError } = await client.auth.verifyOtp({
      email,
      token: String(body.otp || ""),
      type: "email",
    });
    throwIfError(otpError);
    const { error } = await client.auth.updateUser({ password: String(body.password || "") });
    throwIfError(error);
    sessionStorage.removeItem("vestano-reset-email");
    return { ok: true };
  }

  if (url.pathname === "/api/attendance") {
    let query = client.from("attendance_records").select("*").order("punched_at", { ascending: false });
    if (url.searchParams.get("userId")) query = query.eq("user_id", url.searchParams.get("userId"));
    if (url.searchParams.get("from")) query = query.gte("punched_at", `${url.searchParams.get("from")}T00:00:00+05:30`);
    if (url.searchParams.get("to")) query = query.lte("punched_at", `${url.searchParams.get("to")}T23:59:59+05:30`);
    const { data: records, error } = await query;
    throwIfError(error);
    const mappedRecords = user.role === "admin" ? records.filter((record) => record.user_id) : records;

    let devices = [];
    let punchCodes = [];
    if (user.role === "admin") {
      const [{ data: deviceRows, error: deviceError }, { data: mappings, error: mappingError }] =
        await Promise.all([
          client.from("attendance_devices").select("*").order("last_seen", { ascending: false }),
          client.from("attendance_mappings").select("*"),
        ]);
      throwIfError(deviceError || mappingError);
      devices = deviceRows;
      const profileResult = await client.from("profiles").select("id,name");
      throwIfError(profileResult.error);
      const names = new Map(profileResult.data.map((profile) => [profile.id, profile.name]));
      const mappingByCode = new Map(mappings.map((mapping) => [mapping.punch_code, mapping.user_id]));
      punchCodes = [...new Set(records.map((record) => record.punch_code))].map((punchCode) => {
        const userId = mappingByCode.get(punchCode) || "";
        return { punchCode, userId, employeeName: names.get(userId) || "" };
      });
    }
    const settings = await getSettings();
    return {
      records: mappedRecords.map(mapAttendance),
      devices,
      lastSync: settings.attendanceLastSync,
      punchCodes,
    };
  }

  if (url.pathname === "/api/attendance/device-setup") {
    const settings = await getSettings();
    const endpoint = new URL("/functions/v1/iclock/iclock/cdata", SUPABASE_URL);
    return {
      serverHost: endpoint.hostname,
      port: 443,
      protocol: `HTTPS ADMS ${endpoint.pathname}`,
      device: settings.attendanceDeviceConfig,
    };
  }

  if (url.pathname === "/api/attendance/mappings" && method === "POST") {
    const { data: matched, error } = await client.rpc("map_attendance_employee", {
      p_punch_code: body.punchCode,
      p_user_id: body.userId,
    });
    throwIfError(error);
    const { data: employee, error: employeeError } = await client
      .from("profiles")
      .select("*")
      .eq("id", body.userId)
      .single();
    throwIfError(employeeError);
    return { matched, employee: mapProfile(employee) };
  }

  throw new Error("Supabase API route is not implemented.");
}
