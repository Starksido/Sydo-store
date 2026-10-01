/** A rating as five stars, read out as "4 out of 5 stars". `rating` may be a decimal (an average). */
export function Stars({ rating, className = "" }: { rating: number; className?: string }) {
  const full = Math.round(rating);
  return (
    <span className={`tracking-widest ${className}`} role="img" aria-label={`${rating} out of 5 stars`}>
      <span aria-hidden="true">
        {"★".repeat(full)}
        <span className="text-disabled">{"★".repeat(5 - full)}</span>
      </span>
    </span>
  );
}
