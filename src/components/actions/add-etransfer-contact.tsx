import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import type { ActionCall } from "@/lib/jev/types";

export function AddEtransferContact({ call }: { call: Extract<ActionCall, { action: "add_etransfer_contact" }> }) {
  const { name, email, phone } = call.params;
  return (
    <ActionForm
      title="Add an e-Transfer contact"
      description="Save someone so you can send them money later."
      submitLabel="Save contact"
    >
      <ParamField name="name" label="Name" param={name} required />
      <ParamField name="email" label="Email" param={email} type="email" />
      <ParamField name="phone" label="Mobile number" param={phone} type="tel" />
    </ActionForm>
  );
}
