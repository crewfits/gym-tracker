export default function DashboardLoading() {
  return (
    <div className="loading-page" aria-label="Loading page">
      <div className="loading-head">
        <span className="skeleton-line short" />
        <span className="skeleton-line title" />
      </div>
      <div className="loading-grid">
        <div className="card loading-card">
          <span className="skeleton-line medium" />
          <span className="skeleton-block tall" />
          <span className="skeleton-line" />
          <span className="skeleton-line medium" />
        </div>
        <div className="card loading-card">
          <span className="skeleton-line medium" />
          <span className="skeleton-block" />
          <span className="skeleton-line" />
        </div>
      </div>
    </div>
  );
}
