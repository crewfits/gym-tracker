"use client";

import { RotateCcw } from "lucide-react";
import { useFormStatus } from "react-dom";
import type { AttendanceDirection } from "@/lib/types";
import { attendanceLabel } from "@/lib/domain";

function CorrectionButtons({ replacementDirection }: { replacementDirection: AttendanceDirection }) {
  const { pending } = useFormStatus();

  return <div className="reverse-actions">
    <button className="button danger small" name="replacement_direction" value="" type="submit" disabled={pending}>
      <RotateCcw size={14}/> {pending ? "Saving…" : "Undo only"}
    </button>
    <button className="button secondary small" name="replacement_direction" value={replacementDirection} type="submit" disabled={pending}>
      {pending ? "Saving…" : `Undo + new ${attendanceLabel(replacementDirection)}`}
    </button>
  </div>;
}

export function AttendanceCorrectionForm({
  action,
  eventId,
  requestId,
  returnPath,
  direction,
  replacementDirection,
}: {
  action: (data: FormData) => Promise<void>;
  eventId: string;
  requestId: string;
  returnPath: string;
  direction: AttendanceDirection;
  replacementDirection: AttendanceDirection;
}) {
  return <details className="reverse-disclosure attendance-correction">
    <summary>Undo</summary>
    <form className="reverse-form" action={action} onSubmit={(event) => {
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const replacement = submitter instanceof HTMLButtonElement ? submitter.value : "";
      const message = replacement
        ? `Undo this ${attendanceLabel(direction)} and record a new ${attendanceLabel(replacement as AttendanceDirection)}? The original remains in the audit history.`
        : `Undo this ${attendanceLabel(direction)}? The original remains in the audit history.`;
      if (!window.confirm(message)) event.preventDefault();
    }}>
      <input type="hidden" name="event_id" value={eventId}/>
      <input type="hidden" name="request_id" value={requestId}/>
      <input type="hidden" name="return_path" value={returnPath}/>
      <label htmlFor={`attendance-reason-${eventId}`}>Reason</label>
      <input id={`attendance-reason-${eventId}`} className="search" name="reason" minLength={3} maxLength={240} required placeholder="For example, accidental scan"/>
      <small className="muted">Only this member&apos;s latest event can be undone.</small>
      <CorrectionButtons replacementDirection={replacementDirection}/>
      <button className="button secondary small" type="button" onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}>Cancel</button>
    </form>
  </details>;
}
