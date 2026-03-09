interface TopBarAction {
  label: string;
  onClick?: () => void;
}

interface TopBarProps {
  title: string;
  subtitle: string;
  query: string;
  searchPlaceholder: string;
  actions: TopBarAction[];
  onQueryChange: (value: string) => void;
}

export function TopBar({
  title,
  subtitle,
  query,
  searchPlaceholder,
  actions,
  onQueryChange
}: TopBarProps) {
  return (
    <header className="topbar">
      <div>
        <h2>{title}</h2>
        <div className="muted">{subtitle}</div>
      </div>

      <div className="toolbar">
        <label className="search">
          <input
            aria-label="search"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={searchPlaceholder}
            type="search"
            value={query}
          />
        </label>
        {actions.map((action) => (
          <button
            className="button"
            key={action.label}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
    </header>
  );
}

