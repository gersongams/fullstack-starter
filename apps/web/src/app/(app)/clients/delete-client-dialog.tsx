"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteClientMutation } from "@/lib/api/gen/@tanstack/react-query.gen";
import type { Client } from "@/lib/api/gen/types.gen";
import { describeProblem } from "@/lib/api/problem";

import { invalidateClientLists } from "./queries";

/** Mount it only while open. */
export function DeleteClientDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const remove = useMutation(deleteClientMutation());

  function handleDelete() {
    setError(undefined);
    remove.mutate(
      { path: { id: client.id } },
      {
        onSuccess: () => {
          void invalidateClientLists(queryClient);
          toast.success("Client deleted");
          onClose();
        },
        onError: (problem) => setError(describeProblem(problem)),
      },
    );
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {client.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The client leaves your list and its tax ID becomes available again. This cannot be
            undone from the app.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(event) => {
              // Stay open until the API answers, so a failure is shown here.
              event.preventDefault();
              handleDelete();
            }}
          >
            {remove.isPending ? "Deleting…" : "Delete client"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
