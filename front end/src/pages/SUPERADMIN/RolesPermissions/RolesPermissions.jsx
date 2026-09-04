import React, { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Save, ShieldCheck, Trash2, UsersRound, X } from "lucide-react";
import {
  deleteRole,
  fetchAdmins,
  fetchRoles,
  saveRole,
  saveRoleModulePermission,
} from "../superAdminApi";
import { ActionsGroup } from "../../../components/ActionsGroup";
import { saveRoleModulePermissions } from "../../../utils/rolePermissions";

const PERMISSIONS = ["View", "Create", "Edit", "Delete"];
const ADMIN_ROLE_KEYS = new Set(["admin", "clinicadmin", "superadmin"]);
const ADMIN_MODULES = [
  "Dashboard",
  "Branches",
  "Doctors",
  "Receptionists",
  "Nurses",
  "Lab Technicians",
  "Lab Files",
  "Patients",
  "Appointments",
  "Schedule Settings",
  "Roles & Permissions",
  "User Management",
  "Settings",
  "Reports",
];

const normalizeKey = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const isAdminControlRole = (role = {}) => {
  const roleKey = normalizeKey(role.roleName || role.name);
  const moduleKey = normalizeKey(role.module || role.moduleName);

  return (
    ADMIN_ROLE_KEYS.has(roleKey) ||
    roleKey.includes("admin") ||
    moduleKey.includes("admin")
  );
};

const emptyForm = {
  id: "",
  roleName: "Admin",
  module: "All Modules",
  users: "0",
  status: "Active",
  permissions: ["View"],
};

const normalizePermissionList = (permissions = []) =>
  Array.from(new Set(["View", ...permissions])).filter((permission) =>
    PERMISSIONS.includes(permission)
  );

const normalizeOptionalPermissionList = (permissions = []) =>
  Array.from(new Set(Array.isArray(permissions) ? permissions : [permissions])).filter((permission) =>
    PERMISSIONS.includes(permission)
  );

const emptyModulePermissions = () =>
  ADMIN_MODULES.reduce((matrix, module) => ({ ...matrix, [module]: [] }), {});

const normalizeModulePermissions = (source = {}) => {
  const sourceMap = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  return ADMIN_MODULES.reduce((matrix, module) => {
    const matchedKey = Object.keys(sourceMap).find((key) => normalizeKey(key) === normalizeKey(module));
    return {
      ...matrix,
      [module]: normalizeOptionalPermissionList(matchedKey ? sourceMap[matchedKey] : []),
    };
  }, {});
};

const modulePermissionMapFromRoles = (roleGroup = []) => {
  const moduleRows = roleGroup.filter((role) =>
    ADMIN_MODULES.some((module) => normalizeKey(module) === normalizeKey(role.module))
  );
  const rowsToRead = moduleRows.length ? moduleRows : roleGroup;

  return rowsToRead.reduce((state, role) => {
    const matrix = state.matrix;
    const roleModulePermissions = normalizeModulePermissions(role.modulePermissions || role.raw?.modulePermissions || role.raw?.ModulePermissions || {});
    const hasModuleMap = Object.values(roleModulePermissions).some((permissions) => permissions.length > 0);
    if (hasModuleMap) {
      const nextMatrix = ADMIN_MODULES.reduce(
        (nextMatrix, module) => ({
          ...nextMatrix,
          [module]: normalizeOptionalPermissionList([
            ...(nextMatrix[module] || []),
            ...(roleModulePermissions[module] || []),
          ]),
        }),
        matrix
      );
      return { matrix: nextMatrix, hasModuleMap: true };
    }

    const matchedModule = ADMIN_MODULES.find((module) => normalizeKey(module) === normalizeKey(role.module));
    if (!matchedModule) return state;
    return {
      ...state,
      hasModuleMap: true,
      matrix: {
        ...matrix,
        [matchedModule]: normalizeOptionalPermissionList(role.permissions || []),
      },
    };
  }, { matrix: emptyModulePermissions(), hasModuleMap: false });
};

const getCompleteModulePermissionsFromRoles = (roleGroup = []) => {
  const { matrix, hasModuleMap } = modulePermissionMapFromRoles(roleGroup);
  if (hasModuleMap || !roleGroup.length) return matrix;

  return ADMIN_MODULES.reduce(
    (nextMatrix, module) => ({
      ...nextMatrix,
      [module]: normalizeOptionalPermissionList(
        nextMatrix[module]?.length ? nextMatrix[module] : PERMISSIONS
      ),
    }),
    matrix
  );
};

const getAdminId = (admin = {}) =>
  admin && typeof admin === "object"
    ? String(admin.adminUserId || admin.raw?.adminUserId || admin.raw?.AdminUserId || admin.raw?.adminUserID || admin.raw?.AdminUserID || admin.userId || admin.raw?.userId || admin.raw?.UserId || admin.id || admin.adminId || "").trim()
    : "";

const getAdminHospitalId = (admin = {}) =>
  admin && typeof admin === "object"
    ? String(admin.hospitalId || admin.assignedClinicId || admin.clinicId || admin.raw?.hospitalId || admin.raw?.HospitalId || admin.raw?.clinicId || admin.raw?.ClinicId || "").trim()
    : "";

const getAdminUserId = (admin = {}) =>
  admin && typeof admin === "object"
    ? String(admin.adminUserId || admin.raw?.adminUserId || admin.raw?.AdminUserId || admin.raw?.adminUserID || admin.raw?.AdminUserID || admin.userId || admin.raw?.userId || admin.raw?.UserId || admin.id || admin.adminId || "").trim()
    : "";

const getAdminDisplayName = (admin = {}) =>
  admin && typeof admin === "object"
    ? String(admin.name || admin.fullName || admin.email || `Admin ${getAdminId(admin) || ""}`).trim()
    : "Admin";

const roleMatchesAdmin = (role = {}, admin = {}, index = 0) => {
  const adminId = getAdminId(admin);
  const adminName = getAdminDisplayName(admin);
  const adminEmail = String(admin.email || "").trim();
  const roleName = String(role.roleName || role.name || "").trim();
  const roleKey = normalizeKey(roleName);
  const raw = role.raw || {};
  const ownerId = String(
    raw.adminUserId ||
      raw.AdminUserId ||
      raw.adminUserID ||
      raw.AdminUserID ||
      raw.adminId ||
      raw.AdminId ||
      raw.userId ||
      raw.UserId ||
      raw.assignedAdminId ||
      raw.AssignedAdminId ||
      role.adminUserId ||
      role.adminId ||
      role.userId ||
      ""
  ).trim();

  if (ownerId) return Boolean(adminId && adminId === ownerId);
  if (adminId && (roleKey === normalizeKey(`Admin-${adminId}`) || roleKey.endsWith(normalizeKey(`-${adminId}`)))) return true;
  if (adminName && roleKey.includes(normalizeKey(adminName))) return true;
  if (adminEmail && roleKey.includes(normalizeKey(adminEmail))) return true;

  return index === 0 && roleKey === "admin";
};

function RolesPermissions() {
  const [roles, setRoles] = useState([]);
  const [activeActionState, setActiveActionState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedAdminId, setSelectedAdminId] = useState("");
  const [modulePermissions, setModulePermissions] = useState(emptyModulePermissions);
  const [savedModulePermissionOverrides, setSavedModulePermissionOverrides] = useState({});
  const [admins, setAdmins] = useState([]);

  const activeRoles = useMemo(
    () =>
      roles.filter(
        (role) =>
          isAdminControlRole(role) &&
          String(role.status || "").toLowerCase() !== "deleted"
      ),
    [roles]
  );

  const activeAdmins = useMemo(
    () => admins.filter((admin) => admin && typeof admin === "object" && (getAdminId(admin) || admin.email || admin.name)),
    [admins]
  );

  const loadRoles = async () => {
    setLoading(true);
    setError("");

    try {
      const nextRoles = await fetchRoles();
      const nextAdmins = await fetchAdmins().catch(() => []);
      setRoles(nextRoles);
      setAdmins(nextAdmins);
      setSelectedAdminId((previous) => previous || getAdminId(nextAdmins[0]) || "");
    } catch (loadError) {
      setError(loadError.message || "Unable to load roles and permissions.");
      setRoles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const openAdd = () => {
    setForm(emptyForm);
    setError("");
    setSuccess("");
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setForm(emptyForm);
  };

  const updateForm = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
    setError("");
    setSuccess("");
  };

  const togglePermission = (permission) => {
    setForm((previous) => {
      if (permission === "View") {
        return {
          ...previous,
          permissions: normalizePermissionList(previous.permissions),
        };
      }

      const exists = previous.permissions.includes(permission);
      const permissions = exists
        ? previous.permissions.filter((item) => item !== permission)
        : [...previous.permissions, permission];

      return {
        ...previous,
        permissions: normalizePermissionList(permissions),
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const roleName = form.roleName.trim();
    if (!roleName) {
      setError("Role name is required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      await saveRole({
        ...form,
        name: roleName,
        roleName,
        module: form.module.trim() || "Admin Management",
        targetRole: "Admin",
        appliesTo: "Admin",
        scope: "Admin",
        users: Number(form.users || 0) || 0,
        permissions: normalizePermissionList(form.permissions),
      });
      setSuccess(form.id ? "Role updated successfully." : "Role created successfully.");
      await loadRoles();
      closeForm();
    } catch (saveError) {
      setError(saveError.message || "Unable to save role.");
    } finally {
      setSaving(false);
    }
  };

  const selectedAdmin = useMemo(
    () => activeAdmins.find((admin) => getAdminId(admin) === String(selectedAdminId)) || activeAdmins[0] || null,
    [activeAdmins, selectedAdminId]
  );

  const selectedRoleGroup = useMemo(
    () => selectedAdmin ? activeRoles.filter((role) => roleMatchesAdmin(role, selectedAdmin, activeAdmins.indexOf(selectedAdmin))) : [],
    [activeAdmins, activeRoles, selectedAdmin]
  );
  const selectedAdminPermissionKey = selectedAdmin ? getAdminUserId(selectedAdmin) || getAdminId(selectedAdmin) : "";

  const adminPermissionRows = useMemo(() =>
    activeAdmins.map((admin, index) => {
      const roleRows = activeRoles.filter((role) => roleMatchesAdmin(role, admin, index));
      const firstRole = roleRows[0] || {};
      const modulePermissionMap = getCompleteModulePermissionsFromRoles(roleRows);
      saveRoleModulePermissions(
        {
          id: getAdminUserId(admin) || getAdminId(admin),
          adminUserId: getAdminUserId(admin),
          userId: getAdminUserId(admin) || getAdminId(admin),
          email: admin.email,
          name: getAdminDisplayName(admin),
        },
        "Admin",
        modulePermissionMap
      );
      return {
        ...firstRole,
        key: getAdminId(admin) || admin.email || `admin-${index}`,
        id: firstRole.id || "",
        roleName: "Admin",
        name: "Admin",
        admin,
        roleRows,
        modulePermissions: modulePermissionMap,
      };
    }),
    [activeAdmins, activeRoles]
  );

  const getModulePermissionSummary = (role) =>
    ADMIN_MODULES.map((module) => ({
      module,
      permissions: normalizeOptionalPermissionList(role.modulePermissions?.[module] || []),
    }));

  useEffect(() => {
    const savedOverride = selectedAdminPermissionKey ? savedModulePermissionOverrides[selectedAdminPermissionKey] : null;
    setModulePermissions(savedOverride || getCompleteModulePermissionsFromRoles(selectedRoleGroup));
  }, [selectedAdminPermissionKey, selectedRoleGroup, savedModulePermissionOverrides]);

  const toggleModulePermission = (module, permission) => {
    setModulePermissions((previous) => {
      const currentMap = normalizeModulePermissions(previous);
      const currentPermissions = normalizeOptionalPermissionList(currentMap[module] || []);
      const exists = currentPermissions.includes(permission);
      return {
        ...currentMap,
        [module]: normalizeOptionalPermissionList(
          exists
            ? currentPermissions.filter((item) => item !== permission)
            : [...currentPermissions, permission]
        ),
      };
    });
    setError("");
    setSuccess("");
  };

  const areAllPermissionsSelected = useMemo(() => {
    const map = normalizeModulePermissions(modulePermissions);
    return ADMIN_MODULES.every((module) => {
      const list = normalizeOptionalPermissionList(map[module] || []);
      return PERMISSIONS.every((p) => list.includes(p));
    });
  }, [modulePermissions]);

  const isColumnAllSelected = (permission) => {
    const map = normalizeModulePermissions(modulePermissions);
    return ADMIN_MODULES.every((module) => {
      const list = normalizeOptionalPermissionList(map[module] || []);
      return list.includes(permission);
    });
  };

  const toggleSelectAllModulePermissions = () => {
    setModulePermissions(() => {
      const nextMap = {};
      const shouldSelectAll = !areAllPermissionsSelected;
      ADMIN_MODULES.forEach((module) => {
        nextMap[module] = shouldSelectAll ? [...PERMISSIONS] : [];
      });
      return nextMap;
    });
    setError("");
    setSuccess("");
  };

  const toggleColumnModulePermission = (permission) => {
    setModulePermissions((previous) => {
      const currentMap = normalizeModulePermissions(previous);
      const shouldSelectColumn = !isColumnAllSelected(permission);
      const nextMap = {};
      ADMIN_MODULES.forEach((module) => {
        const currentList = normalizeOptionalPermissionList(currentMap[module] || []);
        if (shouldSelectColumn) {
          nextMap[module] = Array.from(new Set([...currentList, permission]));
        } else {
          nextMap[module] = currentList.filter((p) => p !== permission);
        }
      });
      return nextMap;
    });
    setError("");
    setSuccess("");
  };

  const handleSaveModulePermissions = async () => {
    if (!selectedAdmin) {
      setError("Select an admin before saving permissions.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const normalizedMap = normalizeModulePermissions(modulePermissions);
      const existingRole = selectedRoleGroup.find((role) => normalizeKey(role.module) !== normalizeKey("All Modules")) || selectedRoleGroup[0] || {};
      const adminUserId = getAdminUserId(selectedAdmin);
      const hospitalId = getAdminHospitalId(selectedAdmin);

      if (!hospitalId || !adminUserId) {
        throw new Error("Selected Admin does not have hospital id/admin user id.");
      }
      setSavedModulePermissionOverrides((previous) => ({
        ...previous,
        [adminUserId]: normalizedMap,
      }));
      setModulePermissions(normalizedMap);
      saveRoleModulePermissions(
        {
          id: adminUserId,
          adminUserId,
          userId: adminUserId,
          email: selectedAdmin.email,
          name: getAdminDisplayName(selectedAdmin),
        },
        "Admin",
        normalizedMap
      );

      await Promise.all(
        ADMIN_MODULES.map((module) => {
          const moduleRole = selectedRoleGroup.find((role) => normalizeKey(role.module) === normalizeKey(module));
          const roleId = moduleRole?.id || moduleRole?.roleId || "";
          const permissions = normalizeOptionalPermissionList(normalizedMap[module] || []);
          return saveRoleModulePermission(roleId, {
            hospitalId,
            adminUserId,
            roleName: existingRole.roleName || "Admin",
            module,
            canView: permissions.includes("View"),
            canCreate: permissions.includes("Create"),
            canEdit: permissions.includes("Edit"),
            canDelete: permissions.includes("Delete"),
          });
        })
      );
      setSuccess("Module permissions saved successfully.");
      await loadRoles();
    } catch (saveError) {
      setError(saveError.message || "Unable to save module permissions.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role) => {
    if (!role?.id) {
      setError("This role cannot be deleted because it does not have an id.");
      return;
    }

    const confirmed = window.confirm(`Delete role ${role.roleName || role.name}?`);
    if (!confirmed) return;

    setError("");
    setSuccess("");

    try {
      await deleteRole(role.id);
      setSuccess("Role deleted successfully.");
      await loadRoles();
    } catch (deleteError) {
      setError(deleteError.message || "Unable to delete role.");
    }
  };

  return (
    <div>
      <div className="sa-page-header">
        <div>
          <h1>Roles & Permissions</h1>
          <p>Create roles and assign View, Create, Edit, and Delete permissions.</p>
        </div>
        <div className="sa-page-actions">
          <button className="sa-btn sa-btn-primary" type="button" onClick={openAdd}>
            <Plus size={16} /> Create Role
          </button>
        </div>
      </div>

      {success ? <div className="sa-state">{success}</div> : null}
      {error ? <div className="sa-state sa-state--error">{error}</div> : null}

      {showForm ? (
        <form className="sa-form-card sa-role-form" onSubmit={handleSubmit}>
          <div className="sa-modal-header">
            <div>
              <h3>{form.id ? "Edit Role" : "Create Role"}</h3>
            </div>
            <button className="sa-icon-btn" type="button" onClick={closeForm} disabled={saving} aria-label="Close role form">
              <X size={18} />
            </button>
          </div>

          <div className="sa-form-grid">
            <div className="sa-form-field">
              <label>Role Name</label>
              <input
                value={form.roleName}
                onChange={(event) => updateForm("roleName", event.target.value)}
                autoFocus
              />
            </div>
            <div className="sa-form-field">
              <label>Module</label>
              <input
                value={form.module}
                onChange={(event) => updateForm("module", event.target.value)}
                placeholder="General"
              />
            </div>
            <div className="sa-form-field">
              <label>Status</label>
              <select
                value={form.status}
                onChange={(event) => updateForm("status", event.target.value)}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="sa-form-section">
            <label className="sa-form-field sa-permissions-field">
              <span style={{ fontWeight: 700 }}>Permissions</span>
              <span className="sa-actions" style={{ justifyContent: "flex-end" }}>
                {PERMISSIONS.map((permission) => (
                  <label className="sa-checkbox" key={permission}>
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(permission)}
                      disabled={permission === "View"}
                      onChange={() => togglePermission(permission)}
                    />
                    {permission}
                  </label>
                ))}
              </span>
            </label>
          </div>

          <div className="sa-page-actions sa-form-actions">
            <button className="sa-btn" type="button" onClick={closeForm} disabled={saving}>
              Close
            </button>
            <button className="sa-btn sa-btn-primary" type="submit" disabled={saving}>
              <Check size={16} />
              {saving ? "Saving..." : "Save Role"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="sa-table sa-table--roles">
        <div
          className="sa-table-head"
          style={{ gridTemplateColumns: "44px minmax(130px,.7fr) minmax(120px,.65fr) minmax(170px,.9fr) minmax(230px,1fr) 88px" }}
        >
          <span>S.No.</span>
          <span>Role</span>
          <span>Module</span>
          <span>Assigned Users</span>
          <span>Permissions</span>
          <span>Actions</span>
        </div>

        {loading ? <div className="sa-state">Loading roles...</div> : null}
        {!loading && adminPermissionRows.length === 0 ? (
          <div className="sa-empty">No admin roles found.</div>
        ) : null}

        {adminPermissionRows.map((role, index) => (
          <div
            className="sa-table-row"
            key={role.key || role.id || `${role.roleName}-${index}`}
            style={{ gridTemplateColumns: "44px minmax(130px,.7fr) minmax(120px,.65fr) minmax(170px,.9fr) minmax(230px,1fr) 88px" }}
          >
            <span className="sa-table-cell">{index + 1}</span>
            <span className="sa-table-cell">
              <span className="sa-role-main">
                <span className="sa-role-logo">
                  <ShieldCheck size={24} />
                </span>
                <span>
                  <b>Admin</b>
                  <em>System Role</em>
                </span>
              </span>
            </span>
            <span className="sa-table-cell">
              <span className="sa-role-module">
                <b>{ADMIN_MODULES.length} modules</b>
                <span>Admin sidebar modules</span>
              </span>
            </span>
            <span className="sa-table-cell">
              <span className="sa-role-admin-list">
                <b><UsersRound size={15} /> 1 admin</b>
                <span className="sa-role-admin-names">
                  <span className="sa-role-admin-name">
                    {getAdminDisplayName(role.admin)}
                    {getAdminId(role.admin) ? ` - ID ${getAdminId(role.admin)}` : ""}
                  </span>
                </span>
              </span>
            </span>
            <span className="sa-table-cell">
              <span className="sa-role-permissions">
                {getModulePermissionSummary(role).map(({ module, permissions }) => (
                  <span key={module} title={`${module}: ${permissions.join(", ") || "No permissions"}`}>
                    <Check size={11} />
                    {module}: {permissions.length ? permissions.join(", ") : "None"}
                  </span>
                ))}
              </span>
            </span>
            <span className="sa-actions">
              <ActionsGroup
                rowId={role.id || getAdminId(role.admin) || index}
                activeActionState={activeActionState}
                setActiveActionState={setActiveActionState}
                canView={true}
                canEdit={true}
                canStatus={false}
                canDelete={true}
                onView={() => setSelectedAdminId(getAdminId(role.admin))}
                onEdit={() => setSelectedAdminId(getAdminId(role.admin))}
                onDelete={() => handleDelete(role)}
              />
            </span>
          </div>
        ))}
      </div>

      <div className="sa-form-card sa-permission-card">
        <h3>Assign Permissions</h3>
        <p className="sa-form-subtitle">Admin sidebar module permissions for the selected Admin role.</p>
        <div className="sa-form-grid">
          <div className="sa-form-field">
            <label>Admin Role / Admin ID</label>
            <select
              value={getAdminId(selectedAdmin) || ""}
              onChange={(event) => setSelectedAdminId(event.target.value)}
              disabled={loading || saving || !admins.length}
            >
              {activeAdmins.map((admin, index) => (
                <option value={getAdminId(admin)} key={getAdminId(admin) || admin.email || index}>
                  {getAdminDisplayName(admin)} {getAdminId(admin) ? `- ID ${getAdminId(admin)}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="sa-permission-matrix">
          <div className="sa-permission-head">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span>Module</span>
              <button
                type="button"
                className="sa-btn sa-btn-primary"
                style={{ padding: "3px 10px", fontSize: "11px", height: "26px", fontWeight: 700 }}
                onClick={toggleSelectAllModulePermissions}
                disabled={saving || !selectedAdmin}
                title={areAllPermissionsSelected ? "Uncheck all module permissions" : "Check all module permissions"}
              >
                <Check size={13} />
                {areAllPermissionsSelected ? "Deselect All" : "Select All"}
              </button>
            </div>
            {PERMISSIONS.map((permission) => {
              const checked = isColumnAllSelected(permission);
              return (
                <label key={permission} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={saving || !selectedAdmin}
                    onChange={() => toggleColumnModulePermission(permission)}
                    title={`Check/Uncheck ${permission} for all modules`}
                  />
                  <span>{permission}</span>
                </label>
              );
            })}
          </div>
          {ADMIN_MODULES.map((module) => (
            <div className="sa-permission-row" key={module}>
              <span>{module}</span>
              {PERMISSIONS.map((permission) => (
                <label className="sa-checkbox" key={permission}>
                  <input
                    type="checkbox"
                    checked={normalizeOptionalPermissionList(modulePermissions[module] || []).includes(permission)}
                    disabled={saving || !selectedAdmin}
                    onChange={() => toggleModulePermission(module, permission)}
                  />
                  {permission}
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="sa-page-actions sa-form-actions">
          <button className="sa-btn sa-btn-primary" type="button" onClick={handleSaveModulePermissions} disabled={saving || !selectedAdmin}>
            <Save size={16} />
            {saving ? "Saving..." : "Save Module Permissions"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RolesPermissions;
