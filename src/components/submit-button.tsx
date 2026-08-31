"use client";

import { useFormStatus } from "react-dom";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel?: string;
};

export function SubmitButton({ children, disabled, pendingLabel = "Saving…", ...props }: Props) {
  const { pending } = useFormStatus();

  return <button {...props} type={props.type ?? "submit"} disabled={disabled || pending} aria-busy={pending}>
    {pending ? pendingLabel : children}
  </button>;
}
