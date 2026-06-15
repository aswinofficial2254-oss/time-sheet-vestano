const state = {
  user: null,
  settings: null,
  entries: [],
  employees: [],
  attendance: [],
  attendanceDefaultsSet: false,
  pendingProfileImage: undefined,
  page: "dashboard",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const loginView = $("#loginView");
const appView = $("#appView");
const loginForm = $("#loginForm");
const entryForm = $("#entryForm");
const employeeForm = $("#employeeForm");
const editEmployeeForm = $("#editEmployeeForm");
const approvalForm = $("#approvalForm");
const profileForm = $("#profileForm");
const passwordResetForm = $("#passwordResetForm");
const entryDialog = $("#entryDialog");
const employeeDialog = $("#employeeDialog");
const editEmployeeDialog = $("#editEmployeeDialog");
const approvalDialog = $("#approvalDialog");
const passwordResetDialog = $("#passwordResetDialog");

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show ${type === "error" ? "error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function formatDate(date, options = {}) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  }).format(new Date(`${date}T12:00:00`));
}

function initials(name) {
  return String(name)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function badgeClass(value) {
  return String(value).toLowerCase().replaceAll(" ", "-");
}

function isManager() {
  return ["admin", "manager"].includes(state.user?.role);
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  $("#companyName").textContent = state.settings.companyName;
  $("#sidebarUser").textContent = state.user.name;
  $("#sidebarRole").textContent = state.user.role;
  $("#userInitials").textContent = initials(state.user.name);
  renderSidebarAvatar();
  $("#welcomeTitle").textContent = `Good ${getGreeting()}, ${state.user.name.split(" ")[0]}`;
  const today = new Date();
  $("#todayLabel").textContent = today.toLocaleDateString("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  $("#todayDate").textContent = today.toLocaleDateString("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  $$("[data-role]").forEach((element) => {
    const role = element.dataset.role;
    element.classList.toggle(
      "hidden",
      role === "admin"
        ? state.user.role !== "admin"
        : role === "employee"
          ? state.user.role !== "employee"
          : !isManager(),
    );
  });
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function showLogin() {
  state.user = null;
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
}

function renderSidebarAvatar() {
  const avatar = $("#userInitials");
  avatar.innerHTML = state.user.profileImage
    ? `<img src="${state.user.profileImage}" alt="${escapeHtml(state.user.name)}" />`
    : initials(state.user.name);
}

function navigate(page) {
  if (page === "approvals" && !isManager()) page = "dashboard";
  if (page === "attendance" && state.user.role !== "admin") page = "dashboard";
  if (page === "employees" && state.user.role !== "admin") page = "dashboard";
  if (page === "profile" && state.user.role !== "employee") page = "dashboard";
  state.page = page;
  $$(".page").forEach((element) => element.classList.toggle("active", element.id === `${page}Page`));
  $$("#mainNav button").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  const titles = {
    dashboard: "Overview",
    timesheet: "My Timesheet",
    profile: "My Profile",
    attendance: "Attendance",
    approvals: "Approvals",
    employees: "Employees",
  };
  $("#pageTitle").textContent = titles[page];
  $("#quickAddButton").classList.toggle("hidden", page === "timesheet");
  $(".sidebar").classList.remove("open");
  if (page === "dashboard") loadDashboard();
  if (page === "timesheet") loadEntries();
  if (page === "profile") loadProfile();
  if (page === "attendance") loadAttendance();
  if (page === "approvals") loadApprovals();
  if (page === "employees") loadEmployees();
}

function renderProfileImage() {
  const preview = $("#profileImagePreview");
  const image = state.pendingProfileImage ?? state.user.profileImage;
  preview.innerHTML = image
    ? `<img src="${image}" alt="${escapeHtml(state.user.name)}" />`
    : initials(state.user.name);
}

function loadProfile() {
  state.pendingProfileImage = undefined;
  $("#profileDisplayName").textContent = state.user.name;
  $("#profileDisplayId").textContent = state.user.employeeId;
  $("#profileEmployeeId").textContent = state.user.employeeId;
  $("#profileRole").textContent = state.user.role;
  $("#profileEmail").textContent = state.user.email;
  $("#profileDepartment").textContent = state.user.department || "—";
  $("#profileManager").textContent = state.user.manager || "—";
  renderProfileImage();
}

async function resizeProfileImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }
  const bitmap = await createImageBitmap(file);
  const size = 320;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const sourceSize = Math.min(bitmap.width, bitmap.height);
  const sourceX = (bitmap.width - sourceSize) / 2;
  const sourceY = (bitmap.height - sourceSize) / 2;
  context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function loadDashboard() {
  const dashboardRequests = [
    api("/api/dashboard"),
    api("/api/entries"),
  ];
  if (state.user.role === "employee") dashboardRequests.push(api("/api/attendance"));
  const [{ totals }, { entries }, attendancePayload] = await Promise.all(dashboardRequests);
  const metrics = isManager()
    ? [
        ["Team hours", totals.hours.toFixed(1), ""],
        ["Pending approvals", totals.pending, "orange"],
        ["Billable hours", totals.billable.toFixed(1), "green"],
        ["Active employees", totals.employees, ""],
      ]
    : [
        ["Hours this month", totals.hours.toFixed(1), ""],
        ["Pending approval", totals.pending, "orange"],
        ["Billable hours", totals.billable.toFixed(1), "green"],
        ["Overtime", totals.overtime.toFixed(1), "orange"],
      ];
  $("#statsGrid").innerHTML = metrics
    .map(
      ([label, value, color]) => `
        <article class="stat-card ${color}">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>`,
    )
    .join("");

  const recent = entries.slice(0, 5);
  $("#recentEntries").classList.toggle("empty-state", !recent.length);
  $("#recentEntries").innerHTML = recent.length
    ? recent
        .map(
          (entry) => `
            <article class="activity-item">
              <div class="activity-date">${new Date(`${entry.date}T12:00:00`).toLocaleDateString("en", {
                day: "2-digit",
                month: "short",
              })}</div>
              <div>
                <strong>${escapeHtml(entry.project)}</strong>
                <p>${escapeHtml(isManager() ? `${entry.employeeName} · ${entry.details}` : entry.details)}</p>
              </div>
              <span class="hours">${entry.totalHours.toFixed(1)}h</span>
            </article>`,
        )
        .join("")
    : "No work entries yet.";

  if (state.user.role === "employee") {
    $("#employeeAttendanceCard").classList.remove("hidden");
    renderEmployeeAttendance(attendancePayload.records);
  } else {
    $("#employeeAttendanceCard").classList.add("hidden");
  }
}

function groupAttendanceRecords(records) {
  const grouped = new Map();
  for (const record of records) {
    const date = attendanceDateFromTimestamp(record.timestamp);
    const punches = grouped.get(date) || [];
    punches.push(record.timestamp);
    grouped.set(date, punches);
  }
  return [...grouped.entries()]
    .map(([date, punches]) => ({ date, punches: punches.sort() }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderEmployeeAttendance(records) {
  const days = groupAttendanceRecords(records);
  const recentDays = days.slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const todayRecord = days.find((day) => day.date === today);
  const todayTotals = todayRecord ? calculateAttendanceDay(todayRecord.punches) : null;
  const first = todayRecord?.punches[0];
  const last = todayRecord?.punches[todayRecord.punches.length - 1];

  $("#todayAttendanceStatus").textContent = !todayRecord
    ? "No punch today"
    : todayTotals.isOpen
      ? "Checked in"
      : "Checked out";
  $("#todayAttendanceStatus").className = `badge ${todayRecord ? (todayTotals.isOpen ? "submitted" : "approved") : ""}`;

  const summary = [
    ["Check in", first ? timeFromTimestamp(first) : "—"],
    ["Check out", todayRecord && !todayTotals.isOpen ? timeFromTimestamp(last) : "—"],
    ["Break time", todayTotals?.breakHours ? formatDuration(todayTotals.breakHours) : "—"],
    ["Break count", todayTotals ? todayTotals.breakCount : "—"],
    ["Net working", todayTotals ? formatDuration(todayTotals.workingHours) : "—"],
    ["Status", todayTotals ? todayTotals.employeeStatus : "—"],
  ];
  $("#employeeAttendanceSummary").innerHTML = summary
    .map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  $("#employeeAttendanceEmpty").classList.toggle("hidden", recentDays.length > 0);
  $("#employeeAttendanceRows").innerHTML = recentDays
    .map((day) => {
      const totals = calculateAttendanceDay(day.punches);
      const dayFirst = day.punches[0];
      const dayLast = day.punches[day.punches.length - 1];
      return `
        <tr>
          <td>${formatDate(day.date)}</td>
          <td>${timeFromTimestamp(dayFirst)}</td>
          <td>${totals.isOpen ? "Open" : timeFromTimestamp(dayLast)}</td>
          <td>${totals.breakHours ? formatDuration(totals.breakHours) : "—"}</td>
          <td>${totals.breakCount}</td>
          <td><strong>${formatDuration(totals.workingHours)}</strong></td>
          <td><span class="badge ${totals.isOpen ? "submitted" : "approved"}">${totals.employeeStatus}</span></td>
        </tr>`;
    })
    .join("");
}

function entryQuery() {
  const params = new URLSearchParams();
  if ($("#filterFrom").value) params.set("from", $("#filterFrom").value);
  if ($("#filterTo").value) params.set("to", $("#filterTo").value);
  if ($("#filterStatus").value) params.set("status", $("#filterStatus").value);
  return params.toString() ? `?${params}` : "";
}

async function loadEntries() {
  const payload = await api(`/api/entries${entryQuery()}`);
  state.entries = payload.entries;
  $("#timesheetEmpty").classList.toggle("hidden", state.entries.length > 0);
  $("#timesheetRows").innerHTML = state.entries
    .map((entry) => {
      const editable = !isManager() && entry.approvalStatus !== "Approved";
      return `
        <tr>
          <td><strong>${formatDate(entry.date, { year: undefined })}</strong></td>
          <td class="detail-cell">
            <strong>${escapeHtml(entry.project)}</strong>
            <span>${escapeHtml(entry.details)}</span>
          </td>
          <td>${entry.startTime}–${entry.endTime}</td>
          <td><strong>${entry.totalHours.toFixed(2)}</strong>${entry.overtime ? `<br><small>${entry.overtime.toFixed(2)} OT</small>` : ""}</td>
          <td><span class="badge ${badgeClass(entry.workStatus)}">${escapeHtml(entry.workStatus)}</span></td>
          <td><span class="badge ${badgeClass(entry.approvalStatus)}">${entry.approvalStatus}</span></td>
          <td>
            <div class="row-actions">
              ${editable ? `<button class="mini-button" data-edit="${entry.id}">Edit</button>` : ""}
              ${editable ? `<button class="mini-button danger-text" data-delete="${entry.id}">Delete</button>` : ""}
            </div>
          </td>
        </tr>`;
    })
    .join("");
}

async function loadApprovals() {
  const { entries } = await api("/api/entries?status=Submitted");
  state.entries = entries;
  $("#approvalEmpty").classList.toggle("hidden", entries.length > 0);
  $("#approvalList").innerHTML = entries
    .map(
      (entry) => `
        <article class="approval-card">
          <header>
            <div>
              <h3>${escapeHtml(entry.employeeName)}</h3>
              <p>${entry.employeeId} · ${formatDate(entry.date)}</p>
            </div>
            <span class="badge submitted">Submitted</span>
          </header>
          <strong>${escapeHtml(entry.project)}</strong>
          <p class="work-copy">${escapeHtml(entry.details)}</p>
          <div class="approval-meta">
            <div><span>Hours</span><strong>${entry.totalHours.toFixed(2)}</strong></div>
            <div><span>Time</span><strong>${entry.startTime}–${entry.endTime}</strong></div>
            <div><span>Category</span><strong>${escapeHtml(entry.category)}</strong></div>
          </div>
          <button class="button secondary" data-review="${entry.id}">Review entry</button>
        </article>`,
    )
    .join("");
}

function attendanceQuery() {
  const params = new URLSearchParams();
  if ($("#attendanceEmployeeFilter").value) {
    params.set("userId", $("#attendanceEmployeeFilter").value);
  }
  if ($("#attendanceFrom").value) params.set("from", $("#attendanceFrom").value);
  if ($("#attendanceTo").value) params.set("to", $("#attendanceTo").value);
  return params.toString() ? `?${params}` : "";
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setTwoMonthAttendanceRange() {
  const today = new Date();
  const twoMonthsAgo = new Date(today);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  $("#attendanceFrom").value = dateInputValue(twoMonthsAgo);
  $("#attendanceTo").value = dateInputValue(today);
  $("#attendanceEmployeeFilter").value = "";
}

function timeFromTimestamp(timestamp) {
  const time = String(timestamp).split(" ")[1] || "";
  return time.slice(0, 5);
}

function attendanceDateFromTimestamp(timestamp) {
  const match = String(timestamp || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T]/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return dateInputValue(parsed);
}

function hoursBetween(startTimestamp, endTimestamp) {
  const start = new Date(startTimestamp.replace(" ", "T"));
  const end = new Date(endTimestamp.replace(" ", "T"));
  const hours = (end - start) / 3_600_000;
  return Number.isFinite(hours) && hours >= 0 ? hours : 0;
}

function formatDuration(hours) {
  const totalMinutes = Math.max(0, Math.round(Number(hours || 0) * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${wholeHours}h ${String(minutes).padStart(2, "0")}m`;
}

function calculateAttendanceDay(punches) {
  let workingHours = 0;
  let breakHours = 0;
  for (let index = 0; index + 1 < punches.length; index += 2) {
    workingHours += hoursBetween(punches[index], punches[index + 1]);
  }
  for (let index = 1; index + 1 < punches.length; index += 2) {
    breakHours += hoursBetween(punches[index], punches[index + 1]);
  }
  return {
    workingHours,
    breakHours,
    breakCount: Math.floor((punches.length - 1) / 2),
    isOpen: punches.length % 2 === 1,
    employeeStatus: punches.length % 2 === 1 ? "Inside / Working" : "Left",
  };
}

async function loadAttendance() {
  if (!state.attendanceDefaultsSet) {
    setTwoMonthAttendanceRange();
    state.attendanceDefaultsSet = true;
  }
  if (state.user.role === "admin") {
    const payload = await api("/api/employees");
    state.employees = payload.employees;
    const currentEmployee = $("#attendanceEmployeeFilter").value;
    $("#attendanceEmployeeFilter").innerHTML = [
      '<option value="">All employees</option>',
      ...state.employees
        .filter((employee) => employee.active && employee.role !== "admin")
        .map(
          (employee) =>
            `<option value="${employee.id}">${escapeHtml(employee.name)} (${employee.employeeId})</option>`,
        ),
    ].join("");
    $("#attendanceEmployeeFilter").value = state.employees.some(
      (employee) => employee.id === currentEmployee && employee.active,
    )
      ? currentEmployee
      : "";
  }
  const { records, devices, lastSync, punchCodes } = await api(
    `/api/attendance${attendanceQuery()}`,
  );
  state.attendance = records;
  const adminView = isManager();
  $$("[data-attendance-admin]").forEach((element) => element.classList.toggle("hidden", !adminView));

  const grouped = new Map();
  for (const record of records) {
    const date = attendanceDateFromTimestamp(record.timestamp);
    const key = `${record.userId || record.punchCode}|${date}`;
    const group = grouped.get(key) || {
      date,
      employeeName: record.employeeName,
      employeeId: record.employeeId || record.punchCode,
      punches: [],
      devices: new Set(),
      matched: Boolean(record.userId),
    };
    group.punches.push(record.timestamp);
    group.devices.add(record.serialNumber);
    grouped.set(key, group);
  }

  const days = [...grouped.values()]
    .map((group) => ({
      ...group,
      punches: group.punches.sort(),
      deviceList: [...group.devices].join(", "),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  $("#attendanceEmpty").classList.toggle("hidden", days.length > 0);
  $("#attendanceRows").innerHTML = days
    .map((day) => {
      const first = day.punches[0];
      const last = day.punches[day.punches.length - 1];
      const totals = calculateAttendanceDay(day.punches);
      return `
        <tr>
          <td><strong>${formatDate(day.date)}</strong></td>
          ${adminView ? `<td class="employee-cell"><strong>${escapeHtml(day.employeeName)}</strong><span>${escapeHtml(day.employeeId)}${day.matched ? "" : " · Needs mapping"}</span></td>` : ""}
          <td>${timeFromTimestamp(first)}</td>
          <td>${totals.isOpen ? '<span class="badge submitted">Open</span>' : timeFromTimestamp(last)}</td>
          <td>${totals.breakHours ? formatDuration(totals.breakHours) : "—"}</td>
          <td>${totals.breakCount}</td>
          <td><strong>${formatDuration(totals.workingHours)}</strong></td>
          <td><span class="badge ${totals.isOpen ? "submitted" : "approved"}">${totals.employeeStatus}</span></td>
          <td>${day.punches.length}</td>
        </tr>`;
    })
    .join("");

  $("#attendanceSyncBadge").textContent = lastSync
    ? `Last sync ${new Date(lastSync).toLocaleString()}`
    : "Waiting for device";
  $("#attendanceSyncBadge").className = `badge ${lastSync ? "approved" : ""}`;

  if (state.user.role === "admin") {
    $("#deviceSetupCard").classList.remove("hidden");
    const setup = await api("/api/attendance/device-setup");
    $("#deviceServerHost").textContent = setup.serverHost.split(":")[0];
    $("#deviceServerPort").textContent = setup.port;
    $("#deviceProtocol").textContent = setup.protocol;
    $("#connectedDeviceCount").textContent = devices.length;
    $("#configuredDeviceModel").textContent = setup.device.model || "—";
    $("#configuredDeviceSerial").textContent = setup.device.serialNumber || "—";
    $("#configuredDeviceIp").textContent = setup.device.ipAddress || "—";
    $("#configuredDeviceConnection").textContent =
      [setup.device.mode, setup.device.connectionType].filter(Boolean).join(" / ") || "—";

    $("#attendanceMappingCard").classList.toggle("hidden", !punchCodes.length);
    $("#unmatchedPunchCode").innerHTML = punchCodes
      .map(
        (code) =>
          `<option value="${escapeHtml(code.punchCode)}" data-user-id="${code.userId}">${escapeHtml(code.punchCode)}${code.employeeName ? ` — ${escapeHtml(code.employeeName)}` : " — Not linked"}</option>`,
      )
      .join("");
    $("#attendanceEmployee").innerHTML = state.employees
      .filter((employee) => employee.active && employee.role !== "admin")
      .map(
        (employee) =>
          `<option value="${employee.id}">${escapeHtml(employee.name)} (${employee.employeeId})</option>`,
      )
      .join("");
    const selectedCode = $("#unmatchedPunchCode").selectedOptions[0];
    if (selectedCode?.dataset.userId) {
      $("#attendanceEmployee").value = selectedCode.dataset.userId;
    }
  } else {
    $("#deviceSetupCard").classList.add("hidden");
    $("#attendanceMappingCard").classList.add("hidden");
  }
}

async function loadEmployees() {
  const { employees } = await api("/api/employees");
  state.employees = employees;
  $("#employeeRows").innerHTML = employees
    .map(
      (employee) => `
        <tr>
          <td class="employee-cell"><strong>${escapeHtml(employee.name)}</strong><span>${escapeHtml(employee.email)}</span></td>
          <td>${employee.employeeId}</td>
          <td>${escapeHtml(employee.department)}</td>
          <td>${escapeHtml(employee.manager || "—")}</td>
          <td><span class="badge">${employee.role}</span></td>
          <td>
            <button
              class="mini-button ${employee.active ? "danger-text" : ""}"
              data-access="${employee.id}"
              data-active="${employee.active}"
              ${employee.role === "admin" ? "disabled" : ""}
            >
              ${employee.active ? "Deactivate" : "Activate"}
            </button>
          </td>
          <td>
            <div class="row-actions">
              <button class="mini-button" data-edit-employee="${employee.id}">Edit</button>
              ${
                employee.role === "admin" || employee.active
                  ? ""
                  : `<button class="mini-button danger-text" data-delete-employee="${employee.id}" data-employee-name="${escapeHtml(employee.name)}">Delete</button>`
              }
            </div>
          </td>
        </tr>`,
    )
    .join("");
}

function openEntry(entry = null) {
  entryForm.reset();
  entryForm.elements.id.value = entry?.id || "";
  entryForm.elements.date.value = entry?.date || new Date().toISOString().slice(0, 10);
  entryForm.elements.category.value = entry?.category || "Project Work";
  entryForm.elements.project.value = entry?.project || "";
  entryForm.elements.details.value = entry?.details || "";
  entryForm.elements.startTime.value = entry?.startTime || "09:00";
  entryForm.elements.endTime.value = entry?.endTime || "17:30";
  entryForm.elements.breakHours.value = entry?.breakHours ?? 0.5;
  entryForm.elements.workStatus.value = entry?.workStatus || "Completed";
  entryForm.elements.billable.checked = entry?.billable || false;
  entryForm.elements.comments.value = entry?.comments || "";
  $("#entryDialogTitle").textContent = entry ? "Edit work entry" : "New work entry";
  entryDialog.showModal();
}

function openApproval(entry) {
  approvalForm.reset();
  approvalForm.elements.id.value = entry.id;
  $("#approvalDetails").innerHTML = `
    <strong>${escapeHtml(entry.employeeName)} · ${formatDate(entry.date)}</strong>
    <p><b>${escapeHtml(entry.project)}</b><br>${escapeHtml(entry.details)}</p>
    <p>${entry.startTime}–${entry.endTime} · ${entry.totalHours.toFixed(2)} hours · ${escapeHtml(entry.category)}</p>
  `;
  approvalDialog.showModal();
}

function openEmployeeEdit(employee) {
  editEmployeeForm.reset();
  editEmployeeForm.elements.id.value = employee.id;
  editEmployeeForm.elements.employeeId.value = employee.employeeId;
  editEmployeeForm.elements.name.value = employee.name;
  editEmployeeForm.elements.email.value = employee.email;
  editEmployeeForm.elements.department.value = employee.department || "Other";
  editEmployeeForm.elements.manager.value = employee.manager || "";
  editEmployeeForm.elements.role.value = employee.role === "admin" ? "employee" : employee.role;
  editEmployeeForm.elements.role.disabled = employee.role === "admin";
  editEmployeeForm.elements.employeeId.disabled = employee.role === "admin";
  editEmployeeDialog.showModal();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  try {
    const payload = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(formData)),
    });
    state.user = payload.user;
    state.settings = payload.settings;
    showApp();
    navigate("dashboard");
  } catch (error) {
    showToast(error.message, "error");
  }
});

entryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(entryForm));
  const id = values.id;
  delete values.id;
  values.breakHours = Number(values.breakHours || 0);
  values.billable = entryForm.elements.billable.checked;
  try {
    await api(id ? `/api/entries/${id}` : "/api/entries", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(values),
    });
    entryDialog.close();
    showToast(id ? "Work entry updated." : "Work entry submitted.");
    await loadEntries();
  } catch (error) {
    showToast(error.message, "error");
  }
});

employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(employeeForm));
  try {
    await api("/api/employees", { method: "POST", body: JSON.stringify(values) });
    employeeDialog.close();
    employeeForm.reset();
    showToast("Employee account created.");
    await loadEmployees();
  } catch (error) {
    showToast(error.message, "error");
  }
});

editEmployeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(editEmployeeForm));
  const id = values.id;
  delete values.id;
  if (!values.password) delete values.password;
  try {
    await api(`/api/employees/${id}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    });
    editEmployeeDialog.close();
    showToast("Employee details updated.");
    await loadEmployees();
  } catch (error) {
    showToast(error.message, "error");
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = {};
  if (state.pendingProfileImage !== undefined) {
    values.profileImage = state.pendingProfileImage;
  }
  if (values.profileImage === undefined) {
    showToast("Choose or remove a profile image before saving.", "error");
    return;
  }
  try {
    const payload = await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify(values),
    });
    state.user = payload.user;
    state.pendingProfileImage = undefined;
    $("#sidebarUser").textContent = state.user.name;
    $("#welcomeTitle").textContent = `Good ${getGreeting()}, ${state.user.name.split(" ")[0]}`;
    renderSidebarAvatar();
    loadProfile();
    showToast("Profile updated.");
  } catch (error) {
    showToast(error.message, "error");
  }
});

passwordResetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(passwordResetForm));
  if (values.password !== values.confirmPassword) {
    showToast("Passwords do not match.", "error");
    return;
  }
  try {
    await api("/api/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ otp: values.otp, password: values.password }),
    });
    passwordResetDialog.close();
    passwordResetForm.reset();
    showToast("Password reset successfully.");
  } catch (error) {
    showToast(error.message, "error");
  }
});

$("#profileImageInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    state.pendingProfileImage = await resizeProfileImage(file);
    renderProfileImage();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    event.target.value = "";
  }
});

approvalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const values = Object.fromEntries(new FormData(approvalForm));
  try {
    await api(`/api/entries/${values.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        approvalStatus: submitter.value,
        approvalComment: values.approvalComment,
      }),
    });
    approvalDialog.close();
    showToast(`Entry ${submitter.value.toLowerCase()}.`);
    await loadApprovals();
  } catch (error) {
    showToast(error.message, "error");
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.classList.contains("password-toggle")) {
    const input = target.closest(".password-field").querySelector("input");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    target.textContent = showing ? "Show" : "Hide";
    target.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    return;
  }
  if (target.dataset.page) navigate(target.dataset.page);
  if (target.dataset.go) navigate(target.dataset.go);
  if (target.dataset.close) $(`#${target.dataset.close}`).close();
  if (target.id === "quickAddButton" || target.id === "addEntryButton") {
    openEntry();
  }
  if (target.id === "addEmployeeButton") employeeDialog.showModal();
  if (target.id === "applyFilters") loadEntries();
  if (target.id === "applyAttendanceFilters") loadAttendance();
  if (target.id === "removeProfileImage") {
    state.pendingProfileImage = "";
    renderProfileImage();
  }
  if (target.id === "requestPasswordOtp") {
    target.disabled = true;
    try {
      const payload = await api("/api/password-reset/request", {
        method: "POST",
        body: JSON.stringify({}),
      });
      passwordResetForm.reset();
      $("#passwordResetMessage").textContent = payload.message;
      passwordResetDialog.showModal();
      showToast("OTP sent to your registered email.");
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      target.disabled = false;
    }
  }
  if (target.id === "saveAttendanceMapping") {
    try {
      const payload = await api("/api/attendance/mappings", {
        method: "POST",
        body: JSON.stringify({
          punchCode: $("#unmatchedPunchCode").value,
          userId: $("#attendanceEmployee").value,
        }),
      });
      showToast(`${payload.matched} punches linked to ${payload.employee.name}.`);
      await loadAttendance();
    } catch (error) {
      showToast(error.message, "error");
    }
  }
  if (target.id === "menuButton") $(".sidebar").classList.toggle("open");
  if (target.id === "logoutButton") {
    await api("/api/logout", { method: "POST" });
    showLogin();
  }
  if (target.dataset.edit) {
    openEntry(state.entries.find((entry) => entry.id === target.dataset.edit));
  }
  if (target.dataset.delete) {
    if (!confirm("Delete this work entry?")) return;
    try {
      await api(`/api/entries/${target.dataset.delete}`, { method: "DELETE" });
      showToast("Work entry deleted.");
      loadEntries();
    } catch (error) {
      showToast(error.message, "error");
    }
  }
  if (target.dataset.review) {
    openApproval(state.entries.find((entry) => entry.id === target.dataset.review));
  }
  if (target.dataset.access) {
    try {
      await api(`/api/employees/${target.dataset.access}`, {
        method: "PATCH",
        body: JSON.stringify({ active: target.dataset.active !== "true" }),
      });
      showToast("Employee access updated.");
      loadEmployees();
    } catch (error) {
      showToast(error.message, "error");
    }
  }
  if (target.dataset.editEmployee) {
    const employee = state.employees.find((item) => item.id === target.dataset.editEmployee);
    if (employee) openEmployeeEdit(employee);
  }
  if (target.dataset.deleteEmployee) {
    const employeeName = target.dataset.employeeName;
    if (
      !confirm(
        `Permanently delete ${employeeName}? Their timesheets and attendance history will also be deleted.`,
      )
    ) return;
    try {
      await api(`/api/employees/${target.dataset.deleteEmployee}`, { method: "DELETE" });
      showToast(`${employeeName} deleted.`);
      await loadEmployees();
    } catch (error) {
      showToast(error.message, "error");
    }
  }
});

$("#unmatchedPunchCode").addEventListener("change", () => {
  const selectedCode = $("#unmatchedPunchCode").selectedOptions[0];
  if (selectedCode?.dataset.userId) {
    $("#attendanceEmployee").value = selectedCode.dataset.userId;
  }
});

async function boot() {
  const payload = await api("/api/me");
  state.user = payload.user;
  state.settings = payload.settings;
  if (!state.user) return showLogin();
  showApp();
  navigate("dashboard");
}

boot().catch((error) => showToast(error.message, "error"));
