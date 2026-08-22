import { AccessMessage } from "@/components/access-message";

export default function AccessNotConfiguredPage() {
  return <AccessMessage title="This account is not configured yet" message="The sign-in is valid, but no gym has been assigned to it. Contact the GymDesk deployment team to complete provisioning."/>;
}
