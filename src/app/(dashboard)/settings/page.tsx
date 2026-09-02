import { Building2, MessageCircle, ReceiptText } from "lucide-react";
import { updateSettings } from "@/app/actions/core";
import { Feedback } from "@/components/feedback";
import { SubmitButton } from "@/components/submit-button";
import { requireGym } from "@/lib/auth";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams;
  const { gym } = await requireGym();
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;

  return <>
    <div className="page-head">
      <div>
        <p className="eyebrow">Configuration</p>
        <h1>Gym settings</h1>
        <p className="muted">Keep business details, receipts, timezone, and WhatsApp reminders aligned.</p>
      </div>
    </div>
    <Feedback success={success} error={error}/>

    <form action={updateSettings} className="settings-page-form">
      <div className="settings-top-grid">
        <section className="card form settings-card settings-business-card">
          <div className="settings-section-head">
            <span><Building2 size={18}/></span>
            <div><h2>Business profile</h2><p className="muted">Used across receipts and owner screens.</p></div>
          </div>
          <div className="field"><label>Gym name</label><input name="name" defaultValue={gym.name} required/></div>
          <div className="form-grid">
            <div className="field"><label>Phone</label><input name="phone" defaultValue={gym.phone ?? ""}/></div>
            <div className="field"><label>Email</label><input type="email" name="email" defaultValue={gym.email ?? ""}/></div>
          </div>
          <div className="field"><label>Address</label><textarea name="address" defaultValue={gym.address ?? ""} rows={3}/></div>
        </section>

        <section className="card form settings-card settings-receipt-card">
          <div className="settings-section-head">
            <span><ReceiptText size={18}/></span>
            <div><h2>Receipt setup</h2><p className="muted">Financial labels and local dates.</p></div>
          </div>
          <div className="field"><label>GSTIN</label><input name="gstin" defaultValue={gym.gstin ?? ""}/></div>
          <div className="field"><label>Receipt prefix</label><input name="receipt_prefix" defaultValue={gym.receipt_prefix} maxLength={8}/></div>
          <div className="field"><label>Timezone</label><select name="timezone" defaultValue={gym.timezone}><option value="Asia/Kolkata">Asia/Kolkata</option><option value="Asia/Dubai">Asia/Dubai</option><option value="Europe/London">Europe/London</option><option value="America/New_York">America/New_York</option></select></div>
        </section>
      </div>

      <section className="card form settings-card settings-whatsapp-card">
        <div className="settings-whatsapp-head">
          <div className="settings-section-head">
            <span><MessageCircle size={18}/></span>
            <div><h2>WhatsApp reminders</h2><p className="muted">Manual chats open WhatsApp. Automation submits the approved Meta Utility template only for opted-in members.</p></div>
          </div>
          <div className="automation-setting">
            <div><strong>Automatic payment reminders</strong><p className="muted">Send on the charge follow-up date after consent.</p></div>
            <label className="toggle"><input type="checkbox" name="automatic_payment_whatsapp_enabled" defaultChecked={Boolean(gym.automatic_payment_whatsapp_enabled)}/><span/></label>
          </div>
        </div>

        <div className="settings-template-grid">
          <div className="field"><label>Approved Meta template name</label><input name="whatsapp_payment_template_name" defaultValue={gym.whatsapp_payment_template_name ?? "fitkiro_payment_follow_up"} pattern="[a-z0-9_]+" required/><small>Must exactly match the approved Utility template.</small></div>
          <div className="field"><label>Template language code</label><input name="whatsapp_template_language" defaultValue={gym.whatsapp_template_language ?? "en"} required/><small>For example: en or en_US.</small></div>
        </div>

        <div className="settings-message-grid">
          <div className="field"><label>Outstanding payment message</label><textarea name="payment_reminder_template" rows={5} defaultValue={gym.payment_reminder_template}/><small>Variables: {"{{name}}"}, {"{{balance}}"}, {"{{due_date}}"}, {"{{plan_name}}"}, {"{{gym_name}}"}.</small></div>
          <div className="field"><label>Membership renewal message</label><textarea name="renewal_reminder_template" rows={5} defaultValue={gym.renewal_reminder_template}/><small>Variables: {"{{name}}"}, {"{{expiry_date}}"}, {"{{plan_name}}"}, {"{{gym_name}}"}.</small></div>
        </div>
      </section>

      <div className="settings-save"><SubmitButton className="button" pendingLabel="Saving settings...">Save settings</SubmitButton></div>
    </form>
  </>;
}
