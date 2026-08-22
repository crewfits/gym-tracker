export type ReminderValues = {
  name: string;
  gym_name: string;
  plan_name: string;
  balance?: string;
  due_date?: string;
  expiry_date?: string;
};

export function renderReminderTemplate(template: string, values: ReminderValues): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replaceAll(`{{${key}}}`, value ?? ""), template).trim();
}

export function whatsappNumber(phone: string, defaultCountryCode: string): string {
  const value = phone.trim();
  const digits = value.replace(/\D/g, "");
  const number = value.startsWith("+") || digits.length > 10 ? digits : digits.length === 10 ? `${defaultCountryCode.replace(/\D/g, "")}${digits}` : digits;
  if (number.length < 10 || number.length > 15) throw new Error("Member phone number is not valid for WhatsApp");
  return number;
}
