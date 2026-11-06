import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function NameDialog({
  trigger,
  title,
  description,
  initialName = "",
  submitLabel,
  maxLength,
  onSubmit,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  initialName?: string;
  submitLabel: string;
  maxLength: number;
  onSubmit: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(initialName);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              onSubmit(name);
              setOpen(false);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "Could not save.");
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            maxLength={maxLength}
            onChange={(event) => setName(event.target.value)}
            aria-label="Name"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "name-dialog-error" : undefined}
            autoFocus
          />
          {error && (
            <p id="name-dialog-error" role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
