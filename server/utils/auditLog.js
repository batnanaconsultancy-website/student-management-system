// server/utils/auditLog.js
// Call this from any admin server route to record the action.
// Usage:
//   await writeAuditLog(client, user.email, 'import_students', 'student', null,
//     { inserted: 5, skipped: 1 }, event)

export async function writeAuditLog(supabase, adminEmail, action, entityType = null, entityId = null, details = {}, event = null) {
  try {
    const ip = event
      ? (getRequestHeader(event, 'x-forwarded-for') || getRequestHeader(event, 'x-real-ip') || 'unknown')
      : 'unknown'

    await supabase.from('audit_log').insert({
      admin_email: adminEmail,
      action,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      details,
      ip_address: ip.split(',')[0].trim()
    })
  } catch (err) {
    // Audit log failure should never break the main action
    console.error('[audit_log] Failed to write audit entry:', err)
  }
}
