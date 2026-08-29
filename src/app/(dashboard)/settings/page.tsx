import { requireGym } from "@/lib/auth";
import { updateSettings } from "@/app/actions/core";
import { Feedback } from "@/components/feedback";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const params = await searchParams;
  const { gym } = await requireGym();
  return <>
    <div className="page-head"><div><p className="eyebrow">Configuration</p><h1>Gym settings</h1><p className="muted">Business details, receipts, timezone, and reminder delivery.</p></div></div>
    <Feedback success={params.success} error={params.error}/>
    <form action={updateSettings} className="grid-2">
      <section className="card form">
        <h2>Business profile</h2>
        <div className="field"><label>Gym name</label><input name="name" defaultValue={gym.name} required/></div>
        <div className="form-grid"><div className="field"><label>Phone</label><input name="phone" defaultValue={gym.phone ?? ""}/></div><div className="field"><label>Email</label><input type="email" name="email" defaultValue={gym.email ?? ""}/></div></div>
        <div className="field"><label>Address</label><textarea name="address" defaultValue={gym.address ?? ""} rows={3}/></div>
        <div className="form-grid"><div className="field"><label>GSTIN</label><input name="gstin" defaultValue={gym.gstin ?? ""}/></div><div className="field"><label>Receipt prefix</label><input name="receipt_prefix" defaultValue={gym.receipt_prefix} maxLength={8}/></div></div>
        <div className="field"><label>Timezone</label><select name="timezone" defaultValue={gym.timezone}><option value="Asia/Kolkata">Asia/Kolkata</option><option value="Asia/Dubai">Asia/Dubai</option><option value="Europe/London">Europe/London</option><option value="America/New_York">America/New_York</option></select></div>
      </section>
      <section className="card form">
        <h2>WhatsApp reminders</h2>
        <p className="muted">Manual reminders open a prefilled chat. Automated payment reminders use Meta WhatsApp Cloud API and require member consent.</p>
        <div className="field"><label>Outstanding payment message</label><textarea name="payment_reminder_template" rows={7} defaultValue={gym.payment_reminder_template}/><small>Variables: {"{{name}}"}, {"{{balance}}"}, {"{{due_date}}"}, {"{{plan_name}}"}, {"{{gym_name}}"}.</small></div>
        <div className="field"><label>Membership renewal message</label><textarea name="renewal_reminder_template" rows={7} defaultValue={gym.renewal_reminder_template}/><small>Variables: {"{{name}}"}, {"{{expiry_date}}"}, {"{{plan_name}}"}, {"{{gym_name}}"}.</small></div>
        <div className="automation-setting"><div><strong>Automatic WhatsApp payment reminders</strong><p className="muted">Submit one approved Utility template on the follow-up date for members who have opted in.</p></div><label className="toggle"><input type="checkbox" name="automatic_payment_whatsapp_enabled" defaultChecked={Boolean(gym.automatic_payment_whatsapp_enabled)}/><span/></label></div>
        <div className="form-grid"><div className="field"><label>Approved Meta template name</label><input name="whatsapp_payment_template_name" defaultValue={gym.whatsapp_payment_template_name ?? "gymdesk_payment_follow_up"} pattern="[a-z0-9_]+" required/><small>Must exactly match the approved Utility template.</small></div><div className="field"><label>Template language code</label><input name="whatsapp_template_language" defaultValue={gym.whatsapp_template_language ?? "en"} required/><small>For example: en or en_US.</small></div></div>
        <button className="button">Save all settings</button>
      </section>
    </form>
  </>;
}
