import Link from "next/link";

export function Pagination({ page, pages, total, label, hrefForPage, pageSize }: { page: number; pages: number; total: number; label: string; hrefForPage: (page: number) => string; pageSize: number }) {
  const numbers = pageNumbers(page, pages);
  return <div className="pagination">
    <span className="muted">{total ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total}` : `0 ${label}`}</span>
    <div className="pagination-controls">
      {page > 1 && <Link className="button secondary small" href={hrefForPage(page - 1)}>Previous</Link>}
      {numbers.map((item, index) => item === "..." ? <span className="pagination-ellipsis" key={`${item}-${index}`}>...</span> : <Link className={`button secondary small page-number ${item === page ? "active" : ""}`} href={hrefForPage(item)} key={item} aria-current={item === page ? "page" : undefined}>{item}</Link>)}
      {page < pages && <Link className="button secondary small" href={hrefForPage(page + 1)}>Next</Link>}
    </div>
  </div>;
}

function pageNumbers(page: number, pages: number) {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const set = new Set([1, pages, page - 1, page, page + 1].filter((item) => item >= 1 && item <= pages));
  const sorted = [...set].sort((left, right) => left - right);
  return sorted.flatMap((item, index) => index > 0 && item - sorted[index - 1] > 1 ? ["..." as const, item] : [item]);
}
