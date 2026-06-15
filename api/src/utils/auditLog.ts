import pool from '../config/database';
import { v4 as uuidv4 } from 'uuid';

export type AuditAction =
  | 'user.register'
  | 'user.login'
  | 'user.logout'
  | 'user.verify_email'
  | 'user.forgot_password'
  | 'user.reset_password'
  | 'event.create'
  | 'event.update'
  | 'event.delete'
  | 'challenge.create'
  | 'challenge.delete'
  | 'submission.delete'
  | 'plan.upgrade'
  | 'plan.cancel'
  | 'credit.purchase'
  | 'affiliate.convert';

export async function logAudit(
  action: AuditAction,
  opts: {
    userId?: string;
    entityType?: string;
    entityId?: string;
    details?: Record<string, any>;
    ip?: string;
  } = {}
): Promise<void> {
  try {
    await pool.execute(
      'INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        uuidv4(),
        opts.userId ?? null,
        action,
        opts.entityType ?? null,
        opts.entityId ?? null,
        opts.details ? JSON.stringify(opts.details) : null,
        opts.ip ?? null,
      ]
    );
  } catch (err) {
    // Logging errors must never crash the app
    console.error('[AuditLog] Failed to write audit entry:', err);
  }
}
