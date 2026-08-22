import { AccessMessage } from "@/components/access-message";

export default function AccessDisabledPage() {
  return <AccessMessage title="Owner access is disabled" message="This gym account is currently inactive. Contact the GymDesk deployment team if access should be restored."/>;
}
