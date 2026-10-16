import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import type { ActionCall } from "@/lib/jev/types";

export function RequestEtransfer({ call }: { call: Extract<ActionCall, { action: "request_etransfer" }> }) {
  const { from_person, from_email, amount } = call.params;
  return (
    <ActionForm
      title="Request Money"
      description="Ask someone to send you money by e-Transfer."
      submitLabel="Send Request"
    >
      <ParamField name="from_person" label="Request from" param={from_person} required />
      <ParamField name="from_email" label="Their email" param={from_email} type="email" />
      <ParamField name="amount" label="Amount (CAD)" param={amount} required type="number" placeholder="0.00" />
    </ActionForm>
  );
}
