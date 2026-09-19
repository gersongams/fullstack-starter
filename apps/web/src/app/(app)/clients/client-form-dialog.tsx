"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createClientMutation,
  updateClientMutation,
} from "@/lib/api/gen/@tanstack/react-query.gen";
import type { Client } from "@/lib/api/gen/types.gen";
import { createIdempotencyKeys } from "@/lib/api/idempotency";
import { mapProblemToForm } from "@/lib/api/problem";

import { invalidateClientLists } from "./queries";
import {
  CLIENT_FIELDS,
  EMPTY_CLIENT,
  clientSchema,
  toBody,
  toValues,
  type ClientValues,
} from "./schema";

/** Create when `client` is undefined, edit otherwise. Mount it only while open. */
export function ClientFormDialog({ client, onClose }: { client?: Client; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string>();
  const create = useMutation(createClientMutation());
  const update = useMutation(updateClientMutation());
  const pending = create.isPending || update.isPending;
  // A double submit or a retry after a lost response must not add a second client.
  const [keyFor] = useState(createIdempotencyKeys);

  const form = useForm<ClientValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: client ? toValues(client) : EMPTY_CLIENT,
  });

  function handleError(error: unknown) {
    const problem = mapProblemToForm(error, { fields: CLIENT_FIELDS, conflictField: "tax_id" });
    for (const name of CLIENT_FIELDS) {
      const message = problem.fieldErrors[name];
      if (message) form.setError(name, { type: "server", message });
    }
    setFormError(problem.formError);
  }

  function handleSuccess(message: string) {
    void invalidateClientLists(queryClient);
    toast.success(message);
    onClose();
  }

  function submit(values: ClientValues) {
    setFormError(undefined);
    const body = toBody(values);
    if (client) {
      update.mutate(
        { path: { id: client.id }, body },
        { onSuccess: () => handleSuccess("Changes saved"), onError: handleError },
      );
    } else {
      create.mutate(
        { body, headers: { "Idempotency-Key": keyFor(body) } },
        { onSuccess: () => handleSuccess("Client added"), onError: handleError },
      );
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{client ? "Edit client" : "Add a client"}</DialogTitle>
          <DialogDescription>
            {client
              ? "Saving replaces every field below."
              : "Only the name is required. The rest can be filled in later."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(submit)} noValidate>
          <FieldGroup>
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="client-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="client-name"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="client-email">Email</FieldLabel>
                  <Input
                    {...field}
                    id="client-email"
                    type="email"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            <Controller
              name="tax_id"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="client-tax-id">Tax ID</FieldLabel>
                  <Input
                    {...field}
                    id="client-tax-id"
                    autoComplete="off"
                    className="tabular-nums"
                    aria-invalid={fieldState.invalid}
                    aria-describedby={fieldState.invalid ? undefined : "client-tax-id-hint"}
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription id="client-tax-id-hint">
                      Each of your clients needs a different one.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />

            <Controller
              name="notes"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="client-notes">Notes</FieldLabel>
                  <Textarea
                    {...field}
                    id="client-notes"
                    rows={3}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : client ? "Save changes" : "Add client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
