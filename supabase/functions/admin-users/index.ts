import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function response(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAdminRole(role?: string) {
  return role === "super_admin" || role === "admin";
}

function canSetRole(callerRole: string, role: string) {
  if (callerRole === "super_admin") return ["employee", "manager", "admin"].includes(role);
  return ["employee", "manager"].includes(role);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authorization = request.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) return response(401, { error: "Authentication required." });

    const { data: caller } = await adminClient
      .from("profiles")
      .select("id, role, active")
      .eq("id", user.id)
      .single();

    if (!caller?.active || !isAdminRole(caller.role)) {
      return response(403, { error: "Only admins can manage employees." });
    }

    const body = await request.json();
    const action = String(body.action || "");

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email || password.length < 4 || !String(body.employeeId || "").trim()) {
        return response(400, { error: "Employee ID, email, and password are required." });
      }

      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          employee_id: String(body.employeeId).trim(),
          name: String(body.name || "").trim(),
          department: String(body.department || "Other"),
          manager: String(body.manager || "").trim(),
        },
      });
      if (error) throw error;

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .update({
          employee_id: String(body.employeeId).trim(),
          name: String(body.name || "").trim(),
          email,
          department: String(body.department || "Other"),
          manager: String(body.manager || "").trim(),
          role: canSetRole(caller.role, body.role) ? body.role : "employee",
          active: true,
        })
        .eq("id", data.user.id)
        .select()
        .single();
      if (profileError) throw profileError;
      return response(201, { employee: profile });
    }

    const userId = String(body.userId || "");
    if (!userId) return response(400, { error: "Employee user ID is required." });

    if (action === "update") {
      const authUpdates: Record<string, string> = {};
      if (body.email) authUpdates.email = String(body.email).trim().toLowerCase();
      if (body.password) authUpdates.password = String(body.password);
      if (Object.keys(authUpdates).length) {
        const { error } = await adminClient.auth.admin.updateUserById(userId, authUpdates);
        if (error) throw error;
      }

      const updates: Record<string, unknown> = {};
      for (const [source, target] of [
        ["employeeId", "employee_id"],
        ["name", "name"],
        ["email", "email"],
        ["department", "department"],
        ["manager", "manager"],
        ["active", "active"],
      ]) {
        if (body[source] !== undefined) updates[target] = body[source];
      }
      const { data: currentProfile } = await adminClient
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      if (currentProfile && !isAdminRole(caller.role)) {
        return response(403, { error: "Only admins can manage employees." });
      }
      if (currentProfile?.role === "super_admin") {
        return response(403, { error: "The super admin account cannot be changed here." });
      }
      if (currentProfile?.role === "admin" && caller.role !== "super_admin") {
        return response(403, { error: "Only the super admin can manage administrator accounts." });
      }

      if (body.role !== undefined && canSetRole(caller.role, body.role)) {
        updates.role = body.role;
      }

      const { data: profile, error } = await adminClient
        .from("profiles")
        .update(updates)
        .eq("id", userId)
        .select()
        .single();
      if (error) throw error;
      return response(200, { employee: profile });
    }

    if (action === "delete") {
      if (userId === user.id) return response(400, { error: "You cannot delete your own account." });
      const { data: profile } = await adminClient
        .from("profiles")
        .select("role, active")
        .eq("id", userId)
        .single();
      if (profile?.role === "super_admin") return response(400, { error: "The super admin account cannot be deleted." });
      if (profile?.role === "admin" && caller.role !== "super_admin") {
        return response(403, { error: "Only the super admin can delete administrator accounts." });
      }
      if (isAdminRole(profile?.role)) return response(400, { error: "Administrator accounts cannot be deleted." });
      if (profile?.active) return response(400, { error: "Deactivate the employee before deleting." });

      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) throw error;
      return response(200, { ok: true });
    }

    return response(400, { error: "Unsupported employee action." });
  } catch (error) {
    return response(400, { error: error instanceof Error ? error.message : "Employee request failed." });
  }
});
