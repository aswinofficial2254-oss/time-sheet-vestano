import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const allowedSerial = Deno.env.get("ATTENDANCE_DEVICE_SERIAL") || "";
const timezoneOffset = Deno.env.get("ATTENDANCE_TIMEZONE_OFFSET") || "+05:30";
const supabase = createClient(supabaseUrl, serviceRoleKey);

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function deviceTimestamp(value: string) {
  return new Date(`${value.trim().replace(" ", "T")}${timezoneOffset}`).toISOString();
}

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);
    const serialNumber = url.searchParams.get("SN") || "";
    if (!serialNumber) return text("Missing device serial number", 400);
    if (allowedSerial && serialNumber !== allowedSerial) return text("Unknown device", 403);

    const forwarded = request.headers.get("x-forwarded-for") || "";
    await supabase.from("attendance_devices").upsert({
      serial_number: serialNumber,
      model: url.searchParams.get("DeviceType") || "K90 Pro",
      ip_address: forwarded.split(",")[0].trim(),
      last_seen: new Date().toISOString(),
    });

    const pathname = url.pathname.toLowerCase();
    if (request.method === "GET" && pathname.endsWith("/iclock/cdata")) {
      return text(
        [
          `GET OPTION FROM: ${serialNumber}`,
          "ATTLOGStamp=0",
          "OPERLOGStamp=0",
          "ATTPHOTOStamp=0",
          "ErrorDelay=60",
          "Delay=10",
          "TransTimes=00:00;14:05",
          "TransInterval=1",
          "TransFlag=1111000000",
          "Realtime=1",
          "Encrypt=0",
        ].join("\n"),
      );
    }

    if (request.method === "POST" && pathname.endsWith("/iclock/cdata")) {
      const table = (url.searchParams.get("table") || "ATTLOG").toUpperCase();
      const rawBody = await request.text();
      let added = 0;

      if (table === "ATTLOG") {
        const lines = rawBody.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
          const [punchCode, timestamp, status = "", verifyMode = ""] = line.split("\t");
          if (!punchCode || !timestamp) continue;

          const { data: mapping } = await supabase
            .from("attendance_mappings")
            .select("user_id")
            .eq("punch_code", punchCode)
            .maybeSingle();

          let profile = null;
          if (mapping?.user_id) {
            const result = await supabase
              .from("profiles")
              .select("id, employee_id, name")
              .eq("id", mapping.user_id)
              .maybeSingle();
            profile = result.data;
          }

          const { error } = await supabase.from("attendance_records").upsert(
            {
              user_id: profile?.id || null,
              employee_id: profile?.employee_id || null,
              employee_name: profile?.name || "Unmatched",
              punch_code: punchCode,
              punched_at: deviceTimestamp(timestamp),
              serial_number: serialNumber,
              status,
              verify_mode: verifyMode,
              raw: line,
            },
            { onConflict: "serial_number,punch_code,punched_at", ignoreDuplicates: true },
          );
          if (!error) added += 1;
        }
      }

      await supabase
        .from("app_settings")
        .update({ attendance_last_sync: new Date().toISOString() })
        .eq("id", true);
      return text(`OK: ${added}`);
    }

    if (request.method === "GET" && pathname.endsWith("/iclock/getrequest")) {
      return text("OK");
    }

    if (request.method === "POST" && pathname.endsWith("/iclock/devicecmd")) {
      await request.text();
      return text("OK");
    }

    return text("Not Found", 404);
  } catch (error) {
    return text(error instanceof Error ? error.message : "Attendance request failed.", 500);
  }
});
