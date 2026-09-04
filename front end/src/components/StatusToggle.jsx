import React from "react";
import "./StatusToggle.css";

export const StatusToggle = ({
  checked = false,
  onChange,
  disabled = false,
  id,
  title = checked ? "Enabled (Click to Disable)" : "Disabled (Click to Enable)",
  ariaLabel = "Toggle status",
}) => {
  const handleClick = (e) => {
    e.stopPropagation();
    if (disabled) return;
    if (onChange) {
      onChange(!checked, e);
    }
  };

  return (
    <label
      className={`status-toggle ${checked ? "is-on" : "is-off"} ${disabled ? "is-disabled" : ""}`.trim()}
      title={title}
      aria-label={ariaLabel}
      onClick={handleClick}
    >
      <input
        type="checkbox"
        id={id}
        checked={Boolean(checked)}
        onChange={() => {}}
        disabled={disabled}
      />
      <span className="status-toggle-track">
        <span className="status-toggle-thumb" />
      </span>
    </label>
  );
};

export default StatusToggle;
