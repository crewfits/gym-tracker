"use client";

type Props = {
  dataUrl: string;
  filename: string;
};

export function DownloadQrButton({ dataUrl, filename }: Props) {
  function download() {
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = filename;
    anchor.click();
  }

  return <button className="button" type="button" onClick={download}>Download QR</button>;
}
