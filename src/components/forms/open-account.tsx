import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

export function OpenAccount({ call }: { call: Extract<ActionCall, { action: "open_account" }> }) {
  const { account_type, initial_deposit, from_account } = call.params;
  return (
    <ActionForm title="Open a New Account" description="Tell us what you’d like to open." submitLabel="Open Account">
      <ParamField
        name="account_type"
        label="Account type"
        param={account_type}
        required
        options={CATALOG.open_account.params.account_type.options}
      />
      <ParamField
        name="initial_deposit"
        label="Opening deposit (CAD)"
        param={initial_deposit}
        type="number"
        placeholder="0.00"
      />
      <ParamField
        name="from_account"
        label="Fund from"
        param={from_account}
        options={CATALOG.open_account.params.from_account.options}
      />
    </ActionForm>
  );
}
