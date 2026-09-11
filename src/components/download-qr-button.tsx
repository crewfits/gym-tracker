"use client";

type Props = {
  dataUrl: string;
  filename: string;
  label?: string;
};

export function DownloadQrButton({ dataUrl, filename, label = "Download QR" }: Props) {
  function download() {
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = filename;
    anchor.click();
  }

  return <button className="button" type="button" onClick={download}>{label}</button>;
}
