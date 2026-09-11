export type GymRole = "owner" | "receptionist" | "trainer" | "admin";

export type Permission =
  | "attendance.scan"
  | "attendance.view"
  | "exports.attendance"
  | "exports.members"
  | "exports.payments"
  | "members.create"
  | "members.manage"
  | "members.view"
  | "payments.manage"
  | "payments.view"
  | "plans.manage"
  | "reminders.manage"
  | "settings.manage"
  | "staff.manage"
  | "feature_flags.manage"
  | "trainer.assign";

const rolePermissions: Record<GymRole, ReadonlySet<Permission>> = {
  owner: new Set([
    "attendance.scan", "attendance.view", "exports.attendance", "exports.members", "exports.payments",
    "members.create", "members.manage", "members.view", "payments.manage", "payments.view",
    "plans.manage", "reminders.manage", "settings.manage", "staff.manage", "trainer.assign",
  ]),
  receptionist: new Set([
    "attendance.scan", "attendance.view", "members.create", "members.manage", "members.view",
  ]),
  trainer: new Set([
    "attendance.scan", "attendance.view", "members.create", "members.manage", "members.view",
    "payments.manage", "payments.view", "reminders.manage", "trainer.assign",
  ]),
  admin: new Set([
    "attendance.scan", "attendance.view", "exports.attendance", "exports.members", "exports.payments",
    "members.create", "members.manage", "members.view", "payments.manage", "payments.view",
    "plans.manage", "reminders.manage", "settings.manage", "staff.manage", "feature_flags.manage", "trainer.assign",
  ]),
};

export type Viewer = {
  role: GymRole;
  features: Record<string, boolean>;
  adminFeatures: Record<string, boolean>;
};

export function hasPermission(viewer: Pick<Viewer, "role">, permission: Permission): boolean {
  return rolePermissions[viewer.role]?.has(permission) ?? false;
}

export function featureEnabled(viewer: Viewer, key: string): boolean {
  return Boolean(viewer.features[key] || (viewer.role === "admin" && viewer.adminFeatures[key]));
}

export function canAccess(viewer: Viewer, permission: Permission, featureKey?: string): boolean {
  return hasPermission(viewer, permission) && (!featureKey || featureEnabled(viewer, featureKey));
}
