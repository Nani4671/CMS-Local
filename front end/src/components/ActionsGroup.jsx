import React from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { StatusToggle } from "./StatusToggle";
import "./ActionsGroup.css";

export const MobileToggleRight = ({ size = 20, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect x="2" y="6" width="20" height="12" rx="6" ry="6" />
    <circle cx="16" cy="12" r="3" />
  </svg>
);

export const MobileToggleLeft = ({ size = 20, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect x="2" y="6" width="20" height="12" rx="6" ry="6" />
    <circle cx="8" cy="12" r="3" />
  </svg>
);

export const ActionsGroup = ({
  rowId,
  onView,
  onEdit,
  onStatus,
  onDelete,
  canView = true,
  canEdit = true,
  canStatus = true,
  canDelete = true,
  statusChecked = false,
  useToggleSwitch = false,
  statusDisabled = false,
  statusIcon,
  statusTitle,
  activeActionState,
  setActiveActionState,
}) => {
  const isRowActive = activeActionState?.rowId === rowId;
  const currentAction = isRowActive ? activeActionState?.action : null;
  const isEnabled = Boolean(statusChecked);

  const DynamicStatusIcon = statusIcon || (isEnabled ? MobileToggleRight : MobileToggleLeft);
  const defaultStatusTitle = isEnabled ? "Disable" : "Enable";
  const defaultStatusAria = isEnabled ? "Disable item" : "Enable item";

  const handleAction = (actionName, handler) => (e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    if (setActiveActionState) {
      setActiveActionState({ rowId, action: actionName });
    }
    if (handler) {
      handler(e);
    }
  };

  return (
    <div className="actions-group">
      {canView && (
        <button
          type="button"
          className={`action-btn view-btn ${currentAction === "view" ? "is-active" : ""}`}
          title="View"
          aria-label="View"
          onClick={handleAction("view", onView)}
        >
          <Eye size={18} />
        </button>
      )}

      {canEdit && (
        <button
          type="button"
          className={`action-btn edit-btn ${currentAction === "edit" ? "is-active" : ""}`}
          title="Edit"
          aria-label="Edit"
          onClick={handleAction("edit", onEdit)}
        >
          <Pencil size={18} />
        </button>
      )}

      {canStatus && (
        useToggleSwitch ? (
          <StatusToggle
            checked={isEnabled}
            onChange={(newVal, e) => handleAction("status", onStatus)(e)}
            disabled={statusDisabled}
            title={statusTitle || (isEnabled ? "Enabled (Click to Disable)" : "Disabled (Click to Enable)")}
          />
        ) : (
          <button
            type="button"
            className={`action-btn status-btn ${isEnabled ? "status-enabled" : "status-disabled"} ${
              currentAction === "status" ? "is-active" : ""
            }`}
            title={statusTitle || defaultStatusTitle}
            aria-label={statusTitle || defaultStatusAria}
            onClick={handleAction("status", onStatus)}
            disabled={statusDisabled}
          >
            <DynamicStatusIcon size={20} />
          </button>
        )
      )}

      {canDelete && (
        <button
          type="button"
          className={`action-btn delete-btn ${currentAction === "delete" ? "is-active" : ""}`}
          title="Delete"
          aria-label="Delete"
          onClick={handleAction("delete", onDelete)}
        >
          <Trash2 size={18} />
        </button>
      )}
    </div>
  );
};

export default ActionsGroup;
