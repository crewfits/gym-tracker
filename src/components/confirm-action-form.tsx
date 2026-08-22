"use client";

export function ConfirmActionForm({
  action,
  memberId,
  message,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  memberId: string;
  message: string;
  children: React.ReactNode;
}) {
  return <form action={action} onSubmit={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>
    <input type="hidden" name="member_id" value={memberId}/>
    {children}
  </form>;
}
