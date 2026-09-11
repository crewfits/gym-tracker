import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type SortOrder = "asc" | "desc";

export function SortableTableHeader({
  label,
  href,
  active,
  order,
}: {
  label: string;
  href: string;
  active: boolean;
  order: SortOrder;
}) {
  const Icon = active ? (order === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return <th aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
    <Link className={`sortable-heading${active ? " active" : ""}`} href={href} scroll={false}>
      <span>{label}</span>
      <Icon size={13} aria-hidden="true"/>
    </Link>
  </th>;
}
