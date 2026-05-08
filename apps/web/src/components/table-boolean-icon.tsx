type TableBooleanIconProps = {
  label: string;
  value: boolean;
};

export function TableBooleanIcon({ label, value }: TableBooleanIconProps) {
  const status = value ? "Yes" : "No";

  return (
    <span
      aria-label={`${label}: ${status}`}
      className={`table-boolean-icon ${value ? "positive" : "negative"}`}
      role="img"
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16">
        {value ? (
          <path d="M3.5 8.2 6.6 11.3 12.6 4.7" />
        ) : (
          <path d="m4.5 4.5 7 7m0-7-7 7" />
        )}
      </svg>
    </span>
  );
}
