import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import type { ActionCall } from "@/lib/jev/types";

export function AddPayee({ call }: { call: Extract<ActionCall, { action: "add_payee" }> }) {
  const { biller, account_number } = call.params;
  return (
    <ActionForm title="Add a Payee" description="Save a company so you can pay its bills." submitLabel="Save Payee">
      <ParamField name="biller" label="Company" param={biller} required />
      <ParamField name="account_number" label="Your account number with them" param={account_number} required />
    </ActionForm>
  );
}
