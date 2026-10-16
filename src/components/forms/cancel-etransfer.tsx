import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import type { ActionCall } from "@/lib/jev/types";

export function CancelEtransfer({ call }: { call: Extract<ActionCall, { action: "cancel_etransfer" }> }) {
  const { recipient, amount } = call.params;
  return (
    <ActionForm
      title="Cancel an e-Transfer"
      description="Only transfers that haven’t been accepted yet can be cancelled."
      submitLabel="Cancel Transfer"
    >
      <ParamField name="recipient" label="Sent to" param={recipient} required />
      <ParamField name="amount" label="Amount (CAD)" param={amount} type="number" placeholder="0.00" />
    </ActionForm>
  );
}
