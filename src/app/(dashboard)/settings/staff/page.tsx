import Link from "next/link";
import { ShieldCheck, ToggleLeft, UserPlus } from "lucide-react";
import { createStaffUser, updateFeatureFlag, updateStaffUser } from "@/app/actions/staff";
import { Feedback } from "@/components/feedback";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { roleLabel } from "@/lib/staff-handlers";

type StaffRow = { id: string; role: "owner" | "receptionist" | "trainer" | "admin"; status: "active" | "disabled"; display_name: string; phone: string | null; created_at: string };
type FlagRow = { key: string; enabled: boolean; admin_enabled: boolean; config_json: Record<string, unknown> };

const featureLabels: Record<string, string> = {
  staff_roles: "Staff roles",
  trainer_assignment: "Trainer assignment",
  csv_exports: "CSV exports",
};

const featureDescriptions: Record<string, string> = {
  staff_roles: "Staff login model and staff access limits.",
  trainer_assignment: "Trainer dropdowns on member activation, enrollment, and renewal.",
  csv_exports: "CSV downloads for roles that are allowed to export.",
};

export default async function StaffSettingsPage({ searchParams }: PageProps<"/settings/staff">) {
  const [params, { supabase, gym, viewer }] = await Promise.all([searchParams, requirePermission("staff.manage")]);
  const showFeatureFlags = canAccess(viewer, "feature_flags.manage");
  const showInternalAdmins = showFeatureFlags;
  const staffQuery = supabase.from("gym_users").select("id,role,status,display_name,phone,created_at").eq("gym_id", gym.id).order("role").order("display_name");
  const [{ data: staff }, { data: flags }] = await Promise.all([
    showInternalAdmins ? staffQuery : staffQuery.neq("role", "admin"),
    showFeatureFlags ? supabase.from("gym_feature_flags").select("key,enabled,admin_enabled,config_json").eq("gym_id", gym.id).order("key") : Promise.resolve({ data: [] }),
  ]);
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  return <>
    <div className="page-head">
      <div><p className="eyebrow">Access control</p><h1>{showFeatureFlags ? "Staff and feature flags" : "Staff access"}</h1><p className="muted">{showFeatureFlags ? "Create staff logins, disable access, and preview feature-gated UI before enabling it for the gym." : "Create staff logins and disable staff access for this gym."}</p></div>
      <Link className="button secondary" href="/settings">Back to settings</Link>
    </div>
    <Feedback success={success} error={error} warning={success?.includes("password setup email") ? "The staff member must use the link in the email to choose a password before signing in. The link expires according to the Supabase Auth email-link settings." : undefined}/>

    <div className="staff-settings-grid">
      <section className="card form settings-card">
        <div className="settings-section-head"><span><UserPlus size={18}/></span><div><h2>Create staff login</h2><p className="muted">A password setup email is sent immediately. Owner-facing roles are receptionist and trainer; Admin is for internal FitKiro access.</p></div></div>
        <form action={createStaffUser} className="staff-create-form">
          <div className="form-grid">
            <div className="field"><label>Email</label><input type="email" name="email" required placeholder="staff@example.com"/></div>
            <div className="field"><label>Name</label><input name="display_name" required placeholder="Staff name"/></div>
            <div className="field"><label>Phone</label><input name="phone" placeholder="Optional"/></div>
            <div className="field"><label>Role</label><select name="role" defaultValue="trainer"><option value="trainer">Trainer</option><option value="receptionist">Receptionist</option>{showInternalAdmins && <option value="admin">Admin</option>}</select></div>
          </div>
          <SubmitButton className="button" pendingLabel="Creating staff...">Create staff login</SubmitButton>
        </form>
      </section>

      {showFeatureFlags && <section className="card form settings-card">
        <div className="settings-section-head"><span><ToggleLeft size={18}/></span><div><h2>Feature flags</h2><p className="muted">Gym enabled controls live access. Admin preview lets internal admins test a feature before rollout.</p></div></div>
        <div className="feature-flag-list table-wrap">
          <div className="feature-flag-table-head"><span>Feature</span><span>Gym enabled</span><span>Admin preview</span><span>Action</span></div>
          {((flags ?? []) as FlagRow[]).map((flag) => <form action={updateFeatureFlag} className="feature-flag-row" key={flag.key}>
            <input type="hidden" name="key" value={flag.key}/>
            <div><strong>{featureLabels[flag.key] ?? flag.key.replaceAll("_", " ")}</strong><span className="muted">{featureDescriptions[flag.key] ?? "Feature access for this gym."}</span>{Object.keys(flag.config_json ?? {}).length > 0 && <small className="muted">{configSummary(flag.config_json)}</small>}</div>
            <label className="toggle-label"><span className="toggle"><input name="enabled" type="checkbox" defaultChecked={flag.enabled} aria-label={`${featureLabels[flag.key] ?? flag.key} gym enabled`}/><span/></span></label>
            <label className="toggle-label"><span className="toggle"><input name="admin_enabled" type="checkbox" defaultChecked={flag.admin_enabled} aria-label={`${featureLabels[flag.key] ?? flag.key} admin preview`}/><span/></span></label>
            <SubmitButton className="button secondary small" pendingLabel="Saving...">Save</SubmitButton>
          </form>)}
        </div>
      </section>}
    </div>

    <section className="card settings-card staff-list-card">
      <div className="settings-section-head"><span><ShieldCheck size={18}/></span><div><h2>Staff access</h2><p className="muted">Owner rows are protected. Trainers appear in trainer assignment dropdowns only when active.</p></div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Phone</th><th>Actions</th></tr></thead>
          <tbody>{((staff ?? []) as StaffRow[]).map((person) => <tr key={person.id}>
            <td><strong>{person.display_name || "Owner"}</strong></td>
            <td><span className={`badge ${person.role === "owner" ? "active" : person.role === "admin" ? "upcoming" : ""}`}>{roleLabel(person.role)}</span></td>
            <td><span className={`badge ${person.status === "active" ? "paid" : "expired"}`}>{person.status}</span></td>
            <td>{person.phone || "-"}</td>
            <td>{person.role === "owner" ? <span className="muted">Protected</span> : <form action={updateStaffUser} className="staff-row-form">
              <input type="hidden" name="id" value={person.id}/>
              <input name="display_name" defaultValue={person.display_name} aria-label="Display name" required/>
              <input name="phone" defaultValue={person.phone ?? ""} aria-label="Phone"/>
              <select name="role" defaultValue={person.role} aria-label="Role"><option value="trainer">Trainer</option><option value="receptionist">Receptionist</option>{showInternalAdmins && <option value="admin">Admin</option>}</select>
              <select name="status" defaultValue={person.status} aria-label="Status"><option value="active">Active</option><option value="disabled">Disabled</option></select>
              <SubmitButton className="button secondary small" pendingLabel="Saving...">Save</SubmitButton>
            </form>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </>;
}

function configSummary(config: Record<string, unknown>) {
  const entries = Object.entries(config).map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${String(value)}`);
  return entries.join(" · ");
}
