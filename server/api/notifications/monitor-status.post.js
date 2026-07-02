import { createError } from "h3";
import { serverSupabaseServiceRole } from "#supabase/server";

export default defineEventHandler(async (event) => {
  try {
    // IMPORTANT: this endpoint is called server-to-server (e.g. from the
    // GitHub Actions scraper workflow via a plain curl POST), not from a
    // logged-in browser session. serverSupabaseClient() authenticates as
    // the current user via cookies and falls back to the anon role when
    // there is none -- which gets blocked by RLS on `students` and other
    // tables. serverSupabaseServiceRole() bypasses RLS the same way the
    // Python scripts do via SUPABASE_ROLE_KEY.
    const client = serverSupabaseServiceRole(event);

    // Get all students with their current status
    const { data: currentStudents, error: studentsError } = await client
      .from("students")
      .select(
        "id, first_name, email, status, cohort_id, program_id, previous_status",
      );

    if (studentsError) throw studentsError;

    // Get students whose status changed to "At Risk" or "Monitor"
    const statusChanges = [];

    for (const student of currentStudents) {
      const previousStatus = student.previous_status;
      const currentStatus = student.status;

      // Check if status changed to At Risk or Monitor
      if (previousStatus !== currentStatus) {
        if (currentStatus === "At Risk" || currentStatus === "Monitor") {
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

          // Update previous_status to current status
          await client
            .from("students")
            .update({ previous_status: currentStatus })
            .eq("id", student.id);
        }
      }
    }

    // If there are status changes, trigger notifications
    if (statusChanges.length > 0) {
      // Get notification settings
      const { data: settings } = await client
        .from("notification_settings")
        .select("*")
        .single();

      if (settings) {
        // Log status changes
        await client.from("status_change_log").insert(
          statusChanges.map((change) => ({
            student_id: change.student_id,
            previous_status: change.previous_status,
            new_status: change.current_status,
            changed_at: change.changed_at,
          })),
        );

        // Send notifications based on settings
        const notifications = [];

        if (settings.email_enabled && settings.email_recipients?.length > 0) {
          if (
            (settings.notify_on_at_risk &&
              statusChanges.some((c) => c.current_status === "At Risk")) ||
            (settings.notify_on_monitor &&
              statusChanges.some((c) => c.current_status === "Monitor"))
          ) {
            notifications.push(
              $fetch("/api/notifications/send-email", {
                method: "POST",
                body: {
                  recipients: settings.email_recipients,
                  changes: statusChanges,
                },
              }),
            );
          }
        }

        if (settings.slack_enabled && settings.slack_webhook_url) {
          if (
            (settings.notify_on_at_risk &&
              statusChanges.some((c) => c.current_status === "At Risk")) ||
            (settings.notify_on_monitor &&
              statusChanges.some((c) => c.current_status === "Monitor"))
          ) {
            notifications.push(
              $fetch("/api/notifications/send-slack", {
                method: "POST",
                body: {
                  webhook_url: settings.slack_webhook_url,
                  changes: statusChanges,
                },
              }),
            );
          }
        }

        // Wait for all notifications to be sent
        if (notifications.length > 0) {
          await Promise.allSettled(notifications);
        }
      }
    }

    return {
      success: true,
      changes_detected: statusChanges.length,
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

// import { createError } from 'h3'
// import { serverSupabaseClient } from '#supabase/server'

// export default defineEventHandler(async (event) => {
//     try {
//         const client = await serverSupabaseClient(event)

//         // Get all students with their current status
//         const { data: currentStudents, error: studentsError } = await client
//             .from('students')
//             .select('id, first_name, email, status, cohort_id, program_id, previous_status')

//         if (studentsError) throw studentsError

//         // Get students whose status changed to "At Risk" or "Monitor"
//         const statusChanges = []

//         for (const student of currentStudents) {
//             const previousStatus = student.previous_status
//             const currentStatus = student.status

//             // Check if status changed to At Risk or Monitor
//             if (previousStatus !== currentStatus) {
//                 if (currentStatus === 'At Risk' || currentStatus === 'Monitor') {
//                     statusChanges.push({
//                         student_id: student.id,
//                         first_name: student.first_name,
//                         email: student.email,
//                         cohort_id: student.cohort_id,
//                         program_id: student.program_id,
//                         previous_status: previousStatus,
//                         current_status: currentStatus,
//                         changed_at: new Date().toISOString()
//                     })

//                     // Update previous_status to current status
//                     await client
//                         .from('students')
//                         .update({ previous_status: currentStatus })
//                         .eq('id', student.id)
//                 }
//             }
//         }

//         // If there are status changes, trigger notifications
//         if (statusChanges.length > 0) {
//             // Get notification settings
//             const { data: settings } = await client
//                 .from('notification_settings')
//                 .select('*')
//                 .single()

//             if (settings) {
//                 // Log status changes
//                 await client
//                     .from('status_change_log')
//                     .insert(statusChanges.map(change => ({
//                         student_id: change.student_id,
//                         previous_status: change.previous_status,
//                         new_status: change.current_status,
//                         changed_at: change.changed_at
//                     })))

//                 // Send notifications based on settings
//                 const notifications = []

//                 if (settings.email_enabled && settings.email_recipients?.length > 0) {
//                     if ((settings.notify_on_at_risk && statusChanges.some(c => c.current_status === 'At Risk')) ||
//                         (settings.notify_on_monitor && statusChanges.some(c => c.current_status === 'Monitor'))) {
//                         notifications.push(
//                             $fetch('/api/notifications/send-email', {
//                                 method: 'POST',
//                                 body: {
//                                     recipients: settings.email_recipients,
//                                     changes: statusChanges
//                                 }
//                             })
//                         )
//                     }
//                 }

//                 if (settings.slack_enabled && settings.slack_webhook_url) {
//                     if ((settings.notify_on_at_risk && statusChanges.some(c => c.current_status === 'At Risk')) ||
//                         (settings.notify_on_monitor && statusChanges.some(c => c.current_status === 'Monitor'))) {
//                         notifications.push(
//                             $fetch('/api/notifications/send-slack', {
//                                 method: 'POST',
//                                 body: {
//                                     webhook_url: settings.slack_webhook_url,
//                                     changes: statusChanges
//                                 }
//                             })
//                         )
//                     }
//                 }

//                 // Wait for all notifications to be sent
//                 if (notifications.length > 0) {
//                     await Promise.allSettled(notifications)
//                 }
//             }
//         }

//         return {
//             success: true,
//             changes_detected: statusChanges.length,
//             changes: statusChanges
//         }

//     } catch (err) {
//         console.error('Status monitoring error:', err)
//         throw createError({
//             statusCode: 500,
//             statusMessage: err?.message || 'Failed to monitor status changes'
//         })
//     }
// })
