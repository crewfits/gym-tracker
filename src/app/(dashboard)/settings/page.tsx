import Link from "next/link";
import { Building2, ReceiptText } from "lucide-react";
import { updateSettings } from "@/app/actions/core";
import { Feedback } from "@/components/feedback";
import { SubmitButton } from "@/components/submit-button";
import { requirePermission } from "@/lib/auth";
import { normalizeCurrencyCode, supportedCurrencies } from "@/lib/domain";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams;
  const { gym } = await requirePermission("settings.manage");
  const success = typeof params.success === "string" ? params.success : undefined;
  const error = typeof params.error === "string" ? params.error : undefined;
  const currencyCode = normalizeCurrencyCode(gym.currency_code);

  return <>
    <div className="page-head">
      <div>
        <p className="eyebrow">Configuration</p>
        <h1>Gym settings</h1>
        <p className="muted">Keep business details, receipts, and timezone aligned.</p>
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
          <div className="field"><label>Currency</label><select name="currency_code" defaultValue={currencyCode}>{supportedCurrencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.label}</option>)}</select></div>
          <div className="field"><label>Timezone</label><select name="timezone" defaultValue={gym.timezone}><option value="Asia/Kolkata">Asia/Kolkata</option><option value="Asia/Dubai">Asia/Dubai</option><option value="Europe/London">Europe/London</option><option value="America/New_York">America/New_York</option></select></div>
        </section>
      </div>

      <div className="settings-save"><SubmitButton className="button" pendingLabel="Saving settings...">Save settings</SubmitButton></div>
    </form>
    <div className="settings-save"><Link className="button secondary" href="/settings/staff">Manage staff and feature flags</Link></div>
  </>;
}
