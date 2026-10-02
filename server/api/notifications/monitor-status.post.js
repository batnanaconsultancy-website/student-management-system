// server/api/notifications/monitor-status.post.js
//
// Monitors student status changes and creates in-app admin notifications
// for configured status changes.
//
// This endpoint is called server-to-server (for example, by GitHub Actions),
// so it uses the Supabase service-role client.
//
// Important:
// previous_status is updated only after the status-change processing has
// completed successfully. This prevents a failed notification from being
// permanently lost.

import { createError } from "h3";
import { serverSupabaseServiceRole } from "#supabase/server";

export default defineEventHandler(async (event) => {
  try {
    // ------------------------------------------------------------
    // 1. Use service role
    // ------------------------------------------------------------
    //
    // This endpoint is called server-to-server and does not have a
    // browser authentication session. The service-role client also
    // allows us to create admin_notifications regardless of the
    // authenticated-user RLS policies.

    const client = serverSupabaseServiceRole(event);

    // ------------------------------------------------------------
    // 2. Get notification settings
    // ------------------------------------------------------------

    const { data: settings, error: settingsError } = await client
      .from("notification_settings")
      .select("*")
      .single();

    if (settingsError) {
      throw new Error(
        `Failed to load notification settings: ${settingsError.message}`,
      );
    }

    // ------------------------------------------------------------
    // 3. Get all students and their current/previous status
    // ------------------------------------------------------------

    const { data: currentStudents, error: studentsError } = await client
      .from("students")
      .select(
        "id, first_name, email, status, cohort_id, program_id, previous_status",
      );

    if (studentsError) {
      throw new Error(`Failed to load students: ${studentsError.message}`);
    }

    // ------------------------------------------------------------
    // 4. Identify actual status changes
    // ------------------------------------------------------------

    const statusChanges = [];

    for (const student of currentStudents || []) {
      const previousStatus = student.previous_status;
      const currentStatus = student.status;

      if (previousStatus !== currentStatus) {
        statusChanges.push({
          student_id: student.id,
          first_name: student.first_name,
          email: student.email,
          cohort_id: student.cohort_id,
          program_id: student.program_id,
          previous_status: previousStatus,
          current_status: currentStatus,
          changed_at: new Date().toISOString(),
        });
      }
    }

    // Nothing changed.
    if (statusChanges.length === 0) {
      return {
        success: true,
        changes_detected: 0,
        changes: [],
      };
    }

    // ------------------------------------------------------------
    // 5. Determine which changes should generate notifications
    // ------------------------------------------------------------

    const notifiableChanges = statusChanges.filter(
      (change) =>
        (settings?.notify_on_at_risk && change.current_status === "At Risk") ||
        (settings?.notify_on_monitor && change.current_status === "Monitor"),
    );

    // ------------------------------------------------------------
    // 6. Write status-change audit records
    // ------------------------------------------------------------

    const { error: statusLogError } = await client
      .from("status_change_log")
      .insert(
        statusChanges.map((change) => ({
          student_id: change.student_id,
          previous_status: change.previous_status,
          new_status: change.current_status,
          changed_at: change.changed_at,
        })),
      );

    if (statusLogError) {
      throw new Error(
        `Failed to write status change log: ${statusLogError.message}`,
      );
    }

    // ------------------------------------------------------------
    // 7. Create admin notifications
    // ------------------------------------------------------------

    if (notifiableChanges.length > 0) {
      const { data: admins, error: adminsError } = await client
        .from("admin")
        .select("email");

      if (adminsError) {
        throw new Error(
          `Failed to load admins for status notifications: ${adminsError.message}`,
        );
      }

      if (admins && admins.length > 0) {
        const notificationRows = admins.flatMap((admin) =>
          notifiableChanges.map((change) => ({
            admin_email: admin.email,
            type: "status_change",
            title: `${change.first_name || "A student"} moved to ${change.current_status}`,
            body: `Status changed from ${change.previous_status || "Unknown"} to ${change.current_status}.`,
            entity_type: "student",
            entity_id: change.student_id,
            is_read: false,
          })),
        );

        const { error: notificationError } = await client
          .from("admin_notifications")
          .insert(notificationRows);

        if (notificationError) {
          throw new Error(
            `Failed to create admin status notifications: ${notificationError.message}`,
          );
        }
      }
    }

    // ------------------------------------------------------------
    // 8. Update previous_status
    // ------------------------------------------------------------
    //
    // Only update previous_status after the status-change log and
    // notification processing have succeeded.
    //
    // We update it for every actual status change, not only At Risk
    // and Monitor. This keeps previous_status synchronized with the
    // actual student status.

    for (const change of statusChanges) {
      const { error: updateError } = await client
        .from("students")
        .update({
          previous_status: change.current_status,
        })
        .eq("id", change.student_id);

      if (updateError) {
        throw new Error(
          `Failed to update previous_status for student ${change.student_id}: ${updateError.message}`,
        );
      }
    }

    // ------------------------------------------------------------
    // 9. Return result
    // ------------------------------------------------------------

    return {
      success: true,
      changes_detected: statusChanges.length,
      notifications_created: notifiableChanges.length,
      changes: statusChanges,
    };
  } catch (err) {
    console.error("Status monitoring error:", err);

    throw createError({
      statusCode: 500,
      statusMessage: err?.message || "Failed to monitor status changes",
    });
  }
});
