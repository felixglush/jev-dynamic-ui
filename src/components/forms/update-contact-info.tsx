"use client";

import { useState } from "react";

import { ActionForm } from "./action-form";
import { ParamField } from "./param-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATALOG } from "@/lib/jev/catalog";
import type { ActionCall } from "@/lib/jev/types";

export function UpdateContactInfo({ call }: { call: Extract<ActionCall, { action: "update_contact_info" }> }) {
  const { contact_type, new_email, new_phone } = call.params;
  // Only the field being changed is shown, so the form has to know which one is chosen.
  const [type, setType] = useState(contact_type.value ?? "");

  return (
    <ActionForm
      title="Update Your Contact Info"
      description="Change the details we have on file for you."
      submitLabel="Save Changes"
    >
      <ParamField
        name="contact_type"
        label="What to change"
        param={contact_type}
        required
        options={CATALOG.update_contact_info.params.contact_type.options}
        onSelect={setType}
      />
      {type === "email" && <ParamField name="new_email" label="New email" param={new_email} required type="email" />}
      {type === "phone" && <ParamField name="new_phone" label="New mobile number" param={new_phone} required type="tel" />}
      {type === "address" && (
        // Addresses can't be picked out of the message the way an email can, so the customer types it.
        <div className="grid gap-1.5">
          <Label htmlFor="new-address">New mailing address</Label>
          <Input id="new-address" name="new_address" required autoComplete="street-address" />
        </div>
      )}
    </ActionForm>
  );
}
