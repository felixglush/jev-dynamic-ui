import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

export function SetupAutodeposit({ call }: { call: Extract<ActionCall, { action: "setup_autodeposit" }> }) {
  const { deposit_account, email, phone } = call.params;
  return (
    <ActionForm
      title="Turn On Autodeposit"
      description="Money sent to you by e-Transfer goes straight into your account."
      submitLabel="Turn On Autodeposit"
    >
      <ParamField
        name="deposit_account"
        label="Deposit into"
        param={deposit_account}
        required
        options={CATALOG.setup_autodeposit.params.deposit_account.options}
      />
      <ParamField name="email" label="Your email" param={email} type="email" />
      <ParamField name="phone" label="Your mobile number" param={phone} type="tel" />
    </ActionForm>
  );
}
