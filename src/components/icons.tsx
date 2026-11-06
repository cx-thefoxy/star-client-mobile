import type { ReactNode } from "react";

/**
 * Star Client's own icon set. Every glyph is drawn on a 24x24 grid with round caps/joins and a soft
 * fill layer that only appears on the active item, so the set looks different from stock outline packs.
 * Props are call-compatible with the old icon library: size, strokeWidth, className, aria-*.
 */
export type IconProps = {
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
  /** Adds the soft fill under the outline (used for the current page in the sidebar). */
  active?: boolean;
};
export type IconType = (props: IconProps) => JSX.Element;

/** `line` = the outline (stroked), `tone` = the soft translucent fill under it, `dots` = solid small dots. */
function make(line: ReactNode, tone?: ReactNode, dots?: ReactNode): IconType {
  return function Icon({ size = 24, strokeWidth = 1.6, className, active, ...rest }: IconProps) {
    const label = rest["aria-label"];
    return (
      <svg
        viewBox="0 0 24 24" width={typeof size === "number" ? `${size / 16}rem` : size} height={typeof size === "number" ? `${size / 16}rem` : size} className={className}
        role={label ? "img" : undefined} focusable="false" {...rest}
      >
        {tone && active && <g fill="currentColor" fillOpacity={0.24} stroke="none">{tone}</g>}
        <g fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{line}</g>
        {dots && <g fill="currentColor" stroke="none">{dots}</g>}
      </svg>
    );
  };
}

const CUBE_TOP = "M12 3.2l7.8 4.4-7.8 4.4-7.8-4.4z";

// ---- navigation
export const Play = make(<path d="M8.2 5.9v12.2a1 1 0 0 0 1.5.9l9.6-6.1a1 1 0 0 0 0-1.7L9.7 5a1 1 0 0 0-1.5.9z" />, <path d="M8.2 5.9v12.2a1 1 0 0 0 1.5.9l9.6-6.1a1 1 0 0 0 0-1.7L9.7 5a1 1 0 0 0-1.5.9z" />);
export const Box = make(<><path d={CUBE_TOP} /><path d="M4.2 7.6v8.8L12 20.8l7.8-4.4V7.6M12 12v8.8" /></>, <path d={CUBE_TOP} />);
export const Package = make(
  <><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><path d="M17 3l4 4-4 4-4-4z" /></>,
  <path d="M17 3l4 4-4 4-4-4z" />,
);
export const SquareTerminal = make(
  <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.6" /><path d="M5.7 5.7l3.8 3.8M14.5 9.5l3.8-3.8M14.5 14.5l3.8 3.8M5.7 18.3l3.8-3.8" /></>,
  <circle cx="12" cy="12" r="9" />,
);
export const Menu = make(<path d="M4 7h16M4 12h11M4 17h16" />);
export const Settings = make(
  <><path d="M4 8h9M17.5 8H20M4 16h2.5M11 16h9" /><circle cx="15.2" cy="8" r="2.2" /><circle cx="8.8" cy="16" r="2.2" /></>,
  <><circle cx="15.2" cy="8" r="2.2" /><circle cx="8.8" cy="16" r="2.2" /></>,
);
export const Settings2 = make(<><rect x="3" y="7" width="18" height="10" rx="5" /><circle cx="16" cy="12" r="2.4" /></>, <rect x="3" y="7" width="18" height="10" rx="5" />);
export const Globe = make(
  <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.4 3.9 5.4 3.9 9s-1.3 6.6-3.9 9c-2.6-2.4-3.9-5.4-3.9-9S9.4 5.4 12 3z" /></>,
  <circle cx="12" cy="12" r="9" />,
);
export const Banknote = make(
  <><rect x="4" y="10" width="16" height="10.5" rx="2" /><rect x="3" y="6.5" width="18" height="3.5" rx="1.3" /><path d="M12 6.5v14M12 6.5C10.4 3.2 6.6 3.5 7.4 5.4c.5 1.1 4.6 1.1 4.6 1.1zM12 6.5c1.6-3.3 5.4-3 4.6-1.1-.5 1.1-4.6 1.1-4.6 1.1z" /></>,
  <rect x="4" y="10" width="16" height="10.5" rx="2" />,
);
export const UserRound = make(<><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.9 3.1-6.4 7-6.4s7 2.5 7 6.4" /></>, <circle cx="12" cy="8" r="3.6" />);
export const Users = make(
  <><circle cx="9" cy="8.6" r="3" /><path d="M3 19.6c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9.6" r="2.4" /><path d="M16.6 14.3c2.7.1 4.4 1.9 4.4 4.7" /></>,
  <circle cx="9" cy="8.6" r="3" />,
);

// ---- actions & status
export const ChevronLeft = make(<path d="M15 6l-6 6 6 6" />);
export const ChevronRight = make(<path d="M9 6l6 6-6 6" />);
export const Check = make(<path d="M5 12.6l4.5 4.4L19 7.6" />);
export const ChevronUp = make(<path d="M6 15l6-6 6 6" />);
export const ChevronDown = make(<path d="M6 9l6 6 6-6" />);
export const Plus = make(<path d="M12 5v14M5 12h14" />);
export const Minus = make(<path d="M6 12h12" />);
export const X = make(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const Square = make(<rect x="6" y="6" width="12" height="12" rx="2.6" />);
export const Copy = make(
  <><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="3" /><path d="M15.5 8.5V6.6A2.6 2.6 0 0 0 12.9 4H6.6A2.6 2.6 0 0 0 4 6.6v6.3a2.6 2.6 0 0 0 2.6 2.6h1.9" /></>,
  <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="3" />,
);
export const Download = make(<path d="M12 4v11M7.5 10.6L12 15l4.5-4.4M5 19.5h14" />);
export const Import = make(<path d="M12 3.5v11M8 10.6l4 4 4-4M4.5 15v2.5A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5V15" />);
export const Loader2 = make(<path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8" />);
export const RotateCw = make(<path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4.6h-4.6" />);
export const RefreshCw = make(<path d="M4.5 10.5a8 8 0 0 1 14-3.5l1.5 1.6M20 4.4v4.2h-4.2M19.5 13.5a8 8 0 0 1-14 3.5L4 15.4M4 19.6v-4.2h4.2" />);
export const Search = make(<><circle cx="10.8" cy="10.8" r="6.3" /><path d="M15.6 15.6l4.6 4.6" /></>, <circle cx="10.8" cy="10.8" r="6.3" />);
export const Shuffle = make(<path d="M4 7h3.4c2 0 3.2 1 4.4 3.2s2.5 3.8 4.6 3.8H20M4 17h3.4c2 0 3.2-1 4.2-2.8M13.2 8.8C14 7.8 15 7 16.6 7H20M17.4 4.4L20 7l-2.6 2.6M17.4 14.4L20 17l-2.6 2.6" />);
export const Pencil = make(<><path d="M4.2 19.8l.9-4.2L16.6 4.1a2.1 2.1 0 0 1 3 0l.3.3a2.1 2.1 0 0 1 0 3L8.4 18.9z" /><path d="M14.6 6.1l3.3 3.3" /></>, <path d="M4.2 19.8l.9-4.2L16.6 4.1a2.1 2.1 0 0 1 3 0l.3.3a2.1 2.1 0 0 1 0 3L8.4 18.9z" />);
export const Trash2 = make(<path d="M4.5 7h15M9.5 7V5.2c0-.9.7-1.7 1.7-1.7h1.6c1 0 1.7.8 1.7 1.7V7M6.6 7l.8 11.6a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.4 7M10 11v6M14 11v6" />);
export const MoreHorizontal = make(null, null, <><circle cx="5.5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="18.5" cy="12" r="1.5" /></>);
export const Info = make(<><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5" /></>, <circle cx="12" cy="12" r="9" />, <circle cx="12" cy="7.9" r="1.1" />);
export const AlertCircle = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7.4v5.4" /></>, <circle cx="12" cy="12" r="9" />, <circle cx="12" cy="16.3" r="1.1" />);
export const AlertTriangle = make(
  <><path d="M10.6 4.7L3.5 17.3A1.6 1.6 0 0 0 4.9 19.7h14.2a1.6 1.6 0 0 0 1.4-2.4L13.4 4.7a1.6 1.6 0 0 0-2.8 0z" /><path d="M12 9.6v4" /></>,
  <path d="M10.6 4.7L3.5 17.3A1.6 1.6 0 0 0 4.9 19.7h14.2a1.6 1.6 0 0 0 1.4-2.4L13.4 4.7a1.6 1.6 0 0 0-2.8 0z" />,
  <circle cx="12" cy="16.4" r="1.1" />,
);
export const Clock3 = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.3 2" /></>, <circle cx="12" cy="12" r="9" />);

// ---- content
export const Star = make(<path d="M12 3.3l2.5 5.4 5.9.7-4.4 4 1.2 5.8L12 16.2 6.8 19.2 8 13.4l-4.4-4 5.9-.7z" />, null, <path d="M12 3.3l2.5 5.4 5.9.7-4.4 4 1.2 5.8L12 16.2 6.8 19.2 8 13.4l-4.4-4 5.9-.7z" />);
export const Heart = make(<path d="M12 20s-7.5-4.5-7.5-10.2a4.3 4.3 0 0 1 7.5-2.7 4.3 4.3 0 0 1 7.5 2.7C19.5 15.5 12 20 12 20z" />, <path d="M12 20s-7.5-4.5-7.5-10.2a4.3 4.3 0 0 1 7.5-2.7 4.3 4.3 0 0 1 7.5 2.7C19.5 15.5 12 20 12 20z" />);
export const Sparkles = make(
  <><path d="M10 4.5l1.8 4.9 4.9 1.8-4.9 1.8L10 18l-1.8-5-4.9-1.8 4.9-1.8z" /><path d="M18.5 3.5v3.2M16.9 5.1h3.2M18.5 16.3v3.2M16.9 17.9h3.2" /></>,
  <path d="M10 4.5l1.8 4.9 4.9 1.8-4.9 1.8L10 18l-1.8-5-4.9-1.8 4.9-1.8z" />,
);
export const Layers = make(<><path d="M12 3.6l8.4 4.3-8.4 4.3-8.4-4.3z" /><path d="M3.6 12.1l8.4 4.3 8.4-4.3M3.6 16.2l8.4 4.2 8.4-4.2" /></>, <path d="M12 3.6l8.4 4.3-8.4 4.3-8.4-4.3z" />);
export const LayoutGrid = make(
  <><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>,
  <rect x="3.5" y="3.5" width="7" height="7" rx="2" />,
);
export const List = make(<path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20" />, null, <><circle cx="4.8" cy="6.5" r="1.2" /><circle cx="4.8" cy="12" r="1.2" /><circle cx="4.8" cy="17.5" r="1.2" /></>);
export const Image = make(
  <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M4 17l5-5 3.5 3.5 2.5-2.5 5 5" /></>,
  <rect x="3.5" y="4.5" width="17" height="15" rx="3" />,
  <circle cx="15.8" cy="9.2" r="1.5" />,
);
export const FileText = make(
  <><path d="M14 3H8a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8z" /><path d="M14 3v3.6A1.4 1.4 0 0 0 15.4 8H19M9 13h6M9 16.8h4" /></>,
  <path d="M14 3H8a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V8z" />,
);
export const Archive = make(
  <><rect x="3.5" y="4" width="17" height="4.6" rx="1.6" /><path d="M5 8.6V17a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 17V8.6M10 12.4h4" /></>,
  <rect x="3.5" y="4" width="17" height="4.6" rx="1.6" />,
);
export const FolderOpen = make(
  <><path d="M3.5 10V6.6A2.6 2.6 0 0 1 6.1 4h3c.7 0 1.3.3 1.8.8L12 6h5.9a2.6 2.6 0 0 1 2.6 2.6V10" /><path d="M3.3 11.3A1.5 1.5 0 0 1 4.8 10h14.9a1.5 1.5 0 0 1 1.5 1.8l-1.4 6.1a2.6 2.6 0 0 1-2.5 2H6A2.6 2.6 0 0 1 3.5 17.5z" /></>,
  <path d="M3.3 11.3A1.5 1.5 0 0 1 4.8 10h14.9a1.5 1.5 0 0 1 1.5 1.8l-1.4 6.1a2.6 2.6 0 0 1-2.5 2H6A2.6 2.6 0 0 1 3.5 17.5z" />,
);
export const FolderCog = make(
  <><path d="M3.5 17.5V6.6A2.6 2.6 0 0 1 6.1 4h3c.7 0 1.3.3 1.8.8L12 6h5.9a2.6 2.6 0 0 1 2.6 2.6v2" /><path d="M3.5 17.5A2.5 2.5 0 0 0 6 20h4.5" /><circle cx="17" cy="16.5" r="2.3" /><path d="M17 12.6v1.6M17 18.8v1.6M13.6 14.5l1.4.8M19 17.7l1.4.8M13.6 18.5l1.4-.8M19 15.3l1.4-.8" /></>,
);
export const Gamepad2 = make(
  <><path d="M7.2 7.5h9.6a4 4 0 0 1 3.9 3.1l.9 4a2.7 2.7 0 0 1-4.7 2.3L15 15.2H9l-1.9 1.7a2.7 2.7 0 0 1-4.7-2.3l.9-4a4 4 0 0 1 3.9-3.1z" /><path d="M8 10.4v3.2M6.4 12h3.2" /></>,
  <path d="M7.2 7.5h9.6a4 4 0 0 1 3.9 3.1l.9 4a2.7 2.7 0 0 1-4.7 2.3L15 15.2H9l-1.9 1.7a2.7 2.7 0 0 1-4.7-2.3l.9-4a4 4 0 0 1 3.9-3.1z" />,
  <><circle cx="15.6" cy="10.9" r=".9" /><circle cx="17.6" cy="13" r=".9" /></>,
);
export const Terminal = make(<><rect x="3" y="4.5" width="18" height="15" rx="3.2" /><path d="M7.5 9.5l3 2.5-3 2.5M13 15h3.5" /></>, <rect x="3" y="4.5" width="18" height="15" rx="3.2" />);
export const Puzzle = make(
  <path d="M9.4 4.8a2.1 2.1 0 0 1 4.2 0V6.3H18a1.5 1.5 0 0 1 1.5 1.5v3.4h-1.5a2.1 2.1 0 1 0 0 4.2h1.5v3.1A1.5 1.5 0 0 1 18 19.9h-3.4v-1.5a2.1 2.1 0 1 0-4.2 0v1.5H6a1.5 1.5 0 0 1-1.5-1.5v-3.1H6a2.1 2.1 0 1 0 0-4.2H4.5V7.8A1.5 1.5 0 0 1 6 6.3h3.4z" />,
  <path d="M9.4 6.3H6A1.5 1.5 0 0 0 4.5 7.8v3.4H6a2.1 2.1 0 1 1 0 4.2H4.5v3a1.5 1.5 0 0 0 1.5 1.5h4.4v-1.5a2.1 2.1 0 1 1 4.2 0v1.5H18a1.5 1.5 0 0 0 1.5-1.5v-3.1H18a2.1 2.1 0 1 1 0-4.2h1.5V7.8A1.5 1.5 0 0 0 18 6.3h-4.4z" />,
);
export const Paintbrush = make(
  <><path d="M20 4l-8.4 8.4" /><path d="M11.3 12.7c-2.5-.5-4.5 1-4.5 3.2 0 1.4-.8 2.3-2 2.8 3.6 1.3 7.7.3 8.2-3.1.2-1.2-.3-2.3-1.7-2.9z" /></>,
  <path d="M11.3 12.7c-2.5-.5-4.5 1-4.5 3.2 0 1.4-.8 2.3-2 2.8 3.6 1.3 7.7.3 8.2-3.1.2-1.2-.3-2.3-1.7-2.9z" />,
);
export const Brush = make(
  <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.9 2-1.8 0-1-.8-1.5-.8-2.4 0-.9.7-1.5 1.7-1.5H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.7 16.7 3.5 12 3.5z" />,
  <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.9 2-1.8 0-1-.8-1.5-.8-2.4 0-.9.7-1.5 1.7-1.5H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.7 16.7 3.5 12 3.5z" />,
  <><circle cx="7.6" cy="11" r="1.1" /><circle cx="10.8" cy="7.4" r="1.1" /><circle cx="15.4" cy="7.8" r="1.1" /></>,
);
export const Wrench = make(
  <path d="M14.8 4.4a4.6 4.6 0 0 0-4.3 6L4.3 16.6a2.1 2.1 0 0 0 3 3l6.2-6.2a4.6 4.6 0 0 0 6-4.3l-2.9 2.8-2.6-.5-.5-2.6 2.8-2.9a4.6 4.6 0 0 0-1.5-.5z" />,
);

// ---- settings tabs (plain geometric glyphs)
export const TabSliders = make(<><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" /></>);
export const TabContrast = make(<><circle cx="12" cy="12" r="8.2" /></>, undefined, <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" />);
export const TabMonitor = make(<><rect x="3.5" y="4.5" width="17" height="11.5" rx="2" /><path d="M9 20h6M12 16v4" /></>);
export const TabTerminal = make(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M7.5 10l3 2.5-3 2.5M13 15.2h3.5" /></>);
