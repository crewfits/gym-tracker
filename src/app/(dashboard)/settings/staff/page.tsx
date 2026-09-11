import Link from "next/link";
import { ShieldCheck, ToggleLeft, UserPlus } from "lucide-react";
import { createStaffUser, updateFeatureFlag, updateStaffUser } from "@/app/actions/staff";
import { Feedback } from "@/components/feedback";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";

type StaffRow = { id: string; user_id: string; role: "owner" | "receptionist" | "trainer" | "admin"; status: "active" | "disabled"; display_name: string; phone: string | null; created_at: string };
type FlagRow = { key: string; enabled: boolean; admin_enabled: boolean; config_json: Record<string, unknown> };

const featureLabels: Record<string, string> = {
  staff_roles: "Staff roles",
  trainer_assignment: "Trainer assignment",
  csv_exports: "CSV exports",
};

export default async function StaffSettingsPage({ searchParams }: PageProps<"/settings/staff">) {
  const [params, { supabase, gym, viewer }] = await Promise.all([searchParams, requirePermission("staff.manage")]);
  const showFeatureFlags = canAccess(viewer, "feature_flags.manage");
  const [{ data: staff }, { data: flags }] = await Promise.all([
    supabase.from("gym_users").select("id,user_id,role,status,display_name,phone,created_at").eq("gym_id", gym.id).order("role").order("display_name"),
    showFeatureFlags ? supabase.from("gym_feature_flags").select("key,enabled,admin_enabled,config_json").eq("gym_id", gym.id).order("key") : Promise.resolve({ data: [] }),
  ]);
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  return <>
    <div className="page-head">
      <div><p className="eyebrow">Access control</p><h1>{showFeatureFlags ? "Staff and feature flags" : "Staff access"}</h1><p className="muted">{showFeatureFlags ? "Create staff logins, disable access, and preview feature-gated UI before enabling it for the gym." : "Create staff logins and disable staff access for this gym."}</p></div>
      <Link className="button secondary" href="/settings">Back to settings</Link>
    </div>
    <Feedback success={success} error={error}/>
    {success?.includes("Temporary password:") && <div className="alert warning">Share the temporary password securely and ask the staff user to change it after first sign-in.</div>}

    <div className="staff-settings-grid">
      <section className="card form settings-card">
        <div className="settings-section-head"><span><UserPlus size={18}/></span><div><h2>Create staff login</h2><p className="muted">Owner-facing roles are receptionist and trainer. Admin is for internal FitKiro access.</p></div></div>
        <form action={createStaffUser} className="staff-create-form">
          <div className="form-grid">
            <div className="field"><label>Email</label><input type="email" name="email" required placeholder="staff@example.com"/></div>
            <div className="field"><label>Name</label><input name="display_name" required placeholder="Staff name"/></div>
            <div className="field"><label>Phone</label><input name="phone" placeholder="Optional"/></div>
            <div className="field"><label>Role</label><select name="role" defaultValue="trainer"><option value="trainer">Trainer</option><option value="receptionist">Receptionist</option><option value="admin">Admin</option></select></div>
          </div>
          <SubmitButton className="button" pendingLabel="Creating staff...">Create staff login</SubmitButton>
        </form>
      </section>

      {showFeatureFlags && <section className="card form settings-card">
        <div className="settings-section-head"><span><ToggleLeft size={18}/></span><div><h2>Feature flags</h2><p className="muted">Enabled is visible to permitted gym roles. Admin preview is visible only to admin users.</p></div></div>
        <div className="feature-flag-list">
          {((flags ?? []) as FlagRow[]).map((flag) => <form action={updateFeatureFlag} className="feature-flag-row" key={flag.key}>
            <input type="hidden" name="key" value={flag.key}/>
            <div><strong>{featureLabels[flag.key] ?? flag.key.replaceAll("_", " ")}</strong>{Object.keys(flag.config_json ?? {}).length > 0 && <small className="muted">{JSON.stringify(flag.config_json)}</small>}</div>
            <label className="toggle-label">Enabled <span className="toggle"><input name="enabled" type="checkbox" defaultChecked={flag.enabled}/><span/></span></label>
            <label className="toggle-label">Admin <span className="toggle"><input name="admin_enabled" type="checkbox" defaultChecked={flag.admin_enabled}/><span/></span></label>
            <SubmitButton className="button secondary small" pendingLabel="Saving...">Save</SubmitButton>
          </form>)}
        </div>
      </section>}
    </div>

    <section className="card settings-card staff-list-card">
      <div className="settings-section-head"><span><ShieldCheck size={18}/></span><div><h2>Staff access</h2><p className="muted">Owner rows are protected. Trainers appear in trainer assignment dropdowns only when active.</p></div></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Phone</th><th>User ID</th><th>Actions</th></tr></thead>
          <tbody>{((staff ?? []) as StaffRow[]).map((person) => <tr key={person.id}>
            <td><strong>{person.display_name || "Owner"}</strong></td>
            <td><span className={`badge ${person.role === "owner" ? "active" : person.role === "admin" ? "upcoming" : ""}`}>{person.role}</span></td>
            <td><span className={`badge ${person.status === "active" ? "paid" : "expired"}`}>{person.status}</span></td>
            <td>{person.phone || "-"}</td>
            <td><code>{person.user_id}</code></td>
            <td>{person.role === "owner" ? <span className="muted">Protected</span> : <form action={updateStaffUser} className="staff-row-form">
              <input type="hidden" name="id" value={person.id}/>
              <input name="display_name" defaultValue={person.display_name} aria-label="Display name" required/>
              <input name="phone" defaultValue={person.phone ?? ""} aria-label="Phone"/>
              <select name="role" defaultValue={person.role} aria-label="Role"><option value="trainer">Trainer</option><option value="receptionist">Receptionist</option><option value="admin">Admin</option></select>
              <select name="status" defaultValue={person.status} aria-label="Status"><option value="active">Active</option><option value="disabled">Disabled</option></select>
              <SubmitButton className="button secondary small" pendingLabel="Saving...">Save</SubmitButton>
            </form>}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </>;
}
