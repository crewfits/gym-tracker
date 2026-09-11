import { CameraScanner } from "@/components/camera-scanner";
import { requirePermission } from "@/lib/auth";

export default async function ScannerPage() {
  await requirePermission("attendance.scan");
  return <CameraScanner/>;
}
