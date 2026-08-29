import { MessageCircle } from "lucide-react";
import { whatsappClickToChatUrl } from "@/lib/reminders";

type Props = {
  memberCode: string;
  memberName: string;
  passUrl: string;
  phone: string;
  defaultCountryCode: string;
};

export function QrShareActions({ memberCode, memberName, passUrl, phone, defaultCountryCode }: Props) {
  const message = `Hi ${memberName}, here is your ${memberCode} GymDesk QR pass. Open this link to show your QR at the gym: ${passUrl}`;
  let whatsappUrl: string | null = null;
  try {
    whatsappUrl = whatsappClickToChatUrl(phone, defaultCountryCode, message);
  } catch {
    // Older imported members may not yet have a WhatsApp-routable phone number.
  }

  return <div className="qr-share-actions">
    {whatsappUrl ? <a className="button success qr-whatsapp-button" href={whatsappUrl} target="_blank" rel="noreferrer">
      <MessageCircle size={18}/>
      Send QR on WhatsApp
    </a> : <span className="button secondary qr-whatsapp-button" aria-disabled="true"><MessageCircle size={18}/> WhatsApp unavailable</span>}
    <small className="muted">{whatsappUrl ? "Opens a ready-to-send chat with this member." : "Add a valid WhatsApp phone number to the member profile."}</small>
  </div>;
}
