import Image from "next/image";
import QRCode from "qrcode";

export async function QrCode({ value, label }: { value: string; label: string }) {
  const png = await QRCode.toDataURL(value, {
    type: "image/png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 360,
    color: { dark: "#10271c", light: "#ffffff" },
  });

  return <Image src={png} alt={label} width={360} height={360} unoptimized style={{ width: "100%", height: "auto" }}/>;
}

export async function qrPngDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    type: "image/png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 720,
    color: { dark: "#10271c", light: "#ffffff" },
  });
}
