import { AuditLogs } from '../models/raw.js';
import { nextId } from '../utils/id.js';

export async function audit(req, { module, action, recordType = null, recordId = null, description = '', oldValues = null, newValues = null, employeeId = null }) {
  try {
    await AuditLogs.create({
      id: await nextId('audit_logs'), company_id: req.auth?.user?.company_id || 1,
      user_id: req.auth?.user?.id || null, employee_id: employeeId,
      module, action, record_type: recordType, record_id: recordId,
      description, old_values: oldValues, new_values: newValues,
      ip_address: req.ip, user_agent: req.get('user-agent') || '', request_url: req.originalUrl,
      created_at: new Date()
    });
  } catch (error) { console.error('Audit error:', error.message); }
}
