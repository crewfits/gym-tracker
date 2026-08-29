import { describe, expect, it } from "vitest";
import { renderReminderTemplate, whatsappAppUrl, whatsappClickToChatUrl, whatsappNumber } from "./reminders";

describe("manual reminders", () => {
  it("renders the configured message variables", () => {
    expect(renderReminderTemplate("Hi {{name}}, {{balance}} is due on {{due_date}} — {{gym_name}}", { name: "Mira", balance: "₹500.00", due_date: "2026-08-22", gym_name: "CrewFit", plan_name: "Monthly" })).toBe("Hi Mira, ₹500.00 is due on 2026-08-22 — CrewFit");
  });
  it("normalizes local and international WhatsApp numbers", () => {
    expect(whatsappNumber("98765 43210", "91")).toBe("919876543210");
    expect(whatsappNumber("+91 98765 43210", "91")).toBe("919876543210");
  });
  it("rejects numbers WhatsApp cannot route", () => expect(() => whatsappNumber("1234", "91")).toThrow());
  it("creates a direct click-to-chat link with the message encoded once", () => {
    const passUrl = "https://gymdesk.example/p/9NVNG3B4RQ99";
    const message = `Hi Harini, open your GymDesk QR pass: ${passUrl}`;
    const url = whatsappClickToChatUrl("98765 43210", "91", message);

    expect(url).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(message)}`);
    expect(decodeURIComponent(url).split(passUrl)).toHaveLength(2);
  });
  it("creates a mobile app deep link for the same unsaved number", () => {
    const message = "Hi Harini, open your QR pass";
    expect(whatsappAppUrl("9876543210", "91", message)).toBe(
      `whatsapp://send?phone=919876543210&text=${encodeURIComponent(message)}`,
    );
  });
});
