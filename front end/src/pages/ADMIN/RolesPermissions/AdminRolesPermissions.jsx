import React, { useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import { apiUrl } from "../../../config/api";
import {
  removeRoleModulePermissions,
  saveRoleModulePermissions,
} from "../../../utils/rolePermissions";
import { ActionsGroup } from "../../../components/ActionsGroup";
import { useAdminModulePermissions } from "../../../utils/rolePermissions";

const PERMISSIONS = ["View", "Create", "Edit", "Delete"];
const GENERAL_MODULE = "General";
const STAFF_ROLES = ["Doctor", "Receptionist", "Nurse", "LabTechnician"];
const STAFF_ROLE_KEYS = new Set(["doctor", "receptionist", "nurse", "labtechnician"]);
const formatRoleLabel = (role = "") => (normalizeKey(role) === "labtechnician" ? "Lab Technician" : role);
const canonicalStaffRole = (role = "") => {
  const key = normalizeKey(role);
  if (key === "doctor") return "Doctor";
  if (key === "receptionist" || key === "reception") return "Receptionist";
  if (key === "nurse") return "Nurse";
  if (key === "labtechnician" || key === "labtech" || key === "lab" || key === "laboratory") return "LabTechnician";
  return String(role || "").trim();
};

const ROLE_SIDEBAR_MODULES = {
  Doctor: ["Dashboard", "Consultation", "Prescription", "Appointments", "My Schedule"],
  Receptionist: ["Reception Dashboard", "Patients", "Appointments", "Book Appointment", "Billing"],
  Nurse: ["Nurse Dashboard", "Patients", "Medical History", "Appointments", "Book Appointment", "Online Bookings", "Offline Bookings", "Billing"],
  LabTechnician: ["Lab Dashboard", "Patients", "Diagnosis Tests", "Sample Collection", "Create Report", "Reports"],
};

const getRoleModules = (role = "Doctor") =>
  ROLE_SIDEBAR_MODULES[normalizeKey(role) === "labtechnician" ? "LabTechnician" : role] || ROLE_SIDEBAR_MODULES.Doctor;

const getToken = () =>
  localStorage.getItem("token") ||
  localStorage.getItem("adminToken") ||
  localStorage.getItem("receptionistToken") ||
  "";

const parseList = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.users)) return data.users;
  if (Array.isArray(data?.modules)) return data.modules;
  return [];
};

const parseEligibleUsers = (data) => {
  const directList = parseList(data);
  if (directList.length) return directList;

  const source = data?.data && typeof data.data === "object" ? data.data : data;
  return [
    ...(Array.isArray(source?.doctors) ? source.doctors.map((user) => ({ role: "Doctor", ...user })) : []),
    ...(Array.isArray(source?.Doctors) ? source.Doctors.map((user) => ({ role: "Doctor", ...user })) : []),
    ...(Array.isArray(source?.receptionists) ? source.receptionists.map((user) => ({ role: "Receptionist", ...user })) : []),
    ...(Array.isArray(source?.Receptionists) ? source.Receptionists.map((user) => ({ role: "Receptionist", ...user })) : []),
    ...(Array.isArray(source?.nurses) ? source.nurses.map((user) => ({ role: "Nurse", ...user })) : []),
    ...(Array.isArray(source?.Nurses) ? source.Nurses.map((user) => ({ role: "Nurse", ...user })) : []),
    ...(Array.isArray(source?.labTechnicians) ? source.labTechnicians.map((user) => ({ role: "LabTechnician", ...user })) : []),
    ...(Array.isArray(source?.LabTechnicians) ? source.LabTechnicians.map((user) => ({ role: "LabTechnician", ...user })) : []),
    ...(Array.isArray(source?.labtechnicians) ? source.labtechnicians.map((user) => ({ role: "LabTechnician", ...user })) : []),
    ...(Array.isArray(source?.Staff) ? source.Staff.map((user) => user) : []),
    ...(Array.isArray(source?.staff) ? source.staff.map((user) => user) : []),
  ];
};

const requestJson = async (path, options = {}) => {
  const token = getToken();
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "ngrok-skip-browser-warning": "true",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const validationMessage =
      data?.errors && typeof data.errors === "object"
        ? Object.values(data.errors).flat().filter(Boolean).join(" ")
        : "";
    throw new Error(
      data?.message ||
        validationMessage ||
        data?.title ||
        (typeof data === "string" ? data : "") ||
        `Request failed with status ${response.status}`
    );
  }

  return data;
};

const normalizeKey = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const normalizePermissionList = (permissions = []) =>
  Array.from(
    new Set([
      ...(Array.isArray(permissions) ? permissions : [permissions]).flatMap((permission) => {
        if (typeof permission === "string") return permission.split(/[,|;/]+/);
        const dto = permission?.dto || permission?.Dto;
        const dtoPermissions = Array.isArray(dto?.permissions)
          ? dto.permissions
          : Array.isArray(dto?.permissionNames)
            ? dto.permissionNames
            : [];
        const flagPermissions = [
          permission?.canView || permission?.CanView || dto?.canView || dto?.CanView ? "View" : "",
          permission?.canCreate || permission?.CanCreate || dto?.canCreate || dto?.CanCreate ? "Create" : "",
          permission?.canEdit || permission?.CanEdit || dto?.canEdit || dto?.CanEdit ? "Edit" : "",
          permission?.canDelete || permission?.CanDelete || dto?.canDelete || dto?.CanDelete ? "Delete" : "",
        ].filter(Boolean);
        if (dtoPermissions.length || flagPermissions.length) {
          return [...dtoPermissions, ...flagPermissions];
        }
        return getValue(
          permission,
          ["dto", "Dto", "name", "Name", "permission", "Permission", "permissionName", "PermissionName"],
          ""
        );
      }),
    ])
  ).filter((permission) => PERMISSIONS.includes(permission));

const normalizeModuleName = (module, index) => {
  const value =
    typeof module === "string"
      ? module
      : getValue(module, ["module", "Module", "name", "Name", "moduleName", "ModuleName"], "");
  const name = String(value || "").trim();
  return name || `Module ${index + 1}`;
};

const emptyModulePermissionsForRole = (role = "Doctor") =>
  getRoleModules(role).reduce((matrix, module) => ({ ...matrix, [module]: [] }), {});

const normalizeModulePermissionMap = (source = {}, role = "Doctor") => {
  const modules = getRoleModules(role);
  const sourceMap = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  return modules.reduce((matrix, module) => ({
    ...matrix,
    [module]: normalizePermissionList(sourceMap[module] || []),
  }), {});
};

const mergeModulePermissionMaps = (base = {}, next = {}, role = "Doctor") => {
  const modules = getRoleModules(role);
  return modules.reduce((map, module) => ({
    ...map,
    [module]: normalizePermissionList([
      ...(Array.isArray(base[module]) ? base[module] : []),
      ...(Array.isArray(next[module]) ? next[module] : []),
    ]),
  }), {});
};

const getSelectedPermissionModules = (modulePermissions = {}, role = "Doctor") => {
  const seenModules = new Set();
  return getRoleModules(role)
    .map((module) => ({
      module: String(module || "").trim(),
      permissions: normalizePermissionList(modulePermissions[module]),
    }))
    .filter((item) => {
      const moduleKey = normalizeKey(item.module);
      if (!moduleKey || seenModules.has(moduleKey) || !item.permissions.length) return false;
      seenModules.add(moduleKey);
      return true;
    });
};

const getPermissionModulesFromAssignment = (assignment = {}, role = "Doctor") => {
  const modules = getRoleModules(role);
  const map = emptyModulePermissionsForRole(role);
  const flatModule = normalizeModuleName(
    assignment.module ||
      assignment.Module ||
      assignment.moduleName ||
      assignment.ModuleName ||
      assignment.name ||
      assignment.Name,
    0
  );
  const matchedFlatModule = modules.find((item) => normalizeKey(item) === normalizeKey(flatModule));
  const flatPermissions = normalizePermissionList([assignment]);
  if (matchedFlatModule && flatPermissions.length) {
    map[matchedFlatModule] = flatPermissions;
  }

  const directModulePermissions =
    assignment.modulePermissions ||
    assignment.ModulePermissions ||
    assignment.raw?.modulePermissions ||
    assignment.raw?.ModulePermissions;
  if (directModulePermissions && typeof directModulePermissions === "object" && !Array.isArray(directModulePermissions)) {
    Object.entries(directModulePermissions).forEach(([module, permissions]) => {
      const matchedModule = modules.find((item) => normalizeKey(item) === normalizeKey(module));
      if (matchedModule) map[matchedModule] = normalizePermissionList(permissions);
    });
  }
  const permissionModules = [
    ...(Array.isArray(assignment.permissionModules) ? assignment.permissionModules : []),
    ...(Array.isArray(assignment.PermissionModules) ? assignment.PermissionModules : []),
    ...(Array.isArray(assignment.rolePermissions) ? assignment.rolePermissions : []),
    ...(Array.isArray(assignment.RolePermissions) ? assignment.RolePermissions : []),
    ...(Array.isArray(assignment.selectedModules) ? assignment.selectedModules : []),
    ...(Array.isArray(assignment.SelectedModules) ? assignment.SelectedModules : []),
    ...(Array.isArray(assignment.raw?.permissionModules) ? assignment.raw.permissionModules : []),
    ...(Array.isArray(assignment.raw?.PermissionModules) ? assignment.raw.PermissionModules : []),
    ...(Array.isArray(assignment.raw?.rolePermissions) ? assignment.raw.rolePermissions : []),
    ...(Array.isArray(assignment.raw?.RolePermissions) ? assignment.raw.RolePermissions : []),
    ...(Array.isArray(assignment.raw?.selectedModules) ? assignment.raw.selectedModules : []),
    ...(Array.isArray(assignment.raw?.SelectedModules) ? assignment.raw.SelectedModules : []),
  ];
  permissionModules.forEach((permissionModule) => {
    const module = normalizeModuleName(permissionModule, 0);
    const matchedModule = modules.find((item) => normalizeKey(item) === normalizeKey(module));
    if (!matchedModule) return;
    map[matchedModule] = normalizePermissionList(
      permissionModule.permissions ||
        permissionModule.Permissions ||
        permissionModule.permissionNames ||
        permissionModule.PermissionNames ||
        []
    );
  });
  const rows = Array.isArray(assignment.permissions) ? assignment.permissions : [];
  rows.forEach((permission) => {
    if (typeof permission === "string") return;
    const dto = permission?.dto || permission?.Dto || {};
    const module = normalizeModuleName(permission?.moduleName || permission?.ModuleName || permission?.module || permission?.Module || dto?.moduleName || dto?.ModuleName || dto?.module || dto?.Module, 0);
    const matchedModule = modules.find((item) => normalizeKey(item) === normalizeKey(module));
    if (!matchedModule) return;
    map[matchedModule] = normalizePermissionList([permission]);
  });
  return map;
};

const assignmentHasSavedModules = (assignment = {}) =>
  Object.values(getPermissionModulesFromAssignment(assignment, assignment.role || "Doctor")).some(
    (permissions) => permissions.length
  );

function getValue(record = {}, keys = [], fallback = "") {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return fallback;
}

const normalizeUser = (user = {}) => {
  const role = canonicalStaffRole(getValue(user, ["role", "Role", "roleName", "RoleName", "type", "Type"], ""));
  const id = String(
    getValue(user, [
      "userId",
      "UserId",
      "id",
      "Id",
      "doctorId",
      "DoctorId",
      "receptionistId",
      "ReceptionistId",
      "nurseId",
      "NurseId",
      "labTechnicianId",
      "LabTechnicianId",
      "labId",
      "LabId",
    ])
  ).trim();

  return {
    id,
    name: String(getValue(user, ["name", "Name", "fullName", "FullName", "userName", "UserName"], "")).trim(),
    email: String(getValue(user, ["email", "Email", "emailAddress", "EmailAddress"], "")).trim(),
    role,
    module: GENERAL_MODULE,
    permissions: normalizePermissionList(
      Array.isArray(user.permissions)
        ? user.permissions
        : [
            user.canView || user.CanView ? "View" : "",
            user.canCreate || user.CanCreate ? "Create" : "",
            user.canEdit || user.CanEdit ? "Edit" : "",
            user.canDelete || user.CanDelete ? "Delete" : "",
          ].filter(Boolean)
    ),
    permissionModules: user.permissionModules || user.PermissionModules || [],
    modulePermissions: user.modulePermissions || user.ModulePermissions || {},
    raw: user,
  };
};

const emptyForm = {
  userId: "",
  role: "Doctor",
  module: GENERAL_MODULE,
  permissions: [],
  modulePermissions: emptyModulePermissionsForRole("Doctor"),
};

const emptyRoleMatrix = {
  Doctor: emptyModulePermissionsForRole("Doctor"),
  Receptionist: emptyModulePermissionsForRole("Receptionist"),
  Nurse: emptyModulePermissionsForRole("Nurse"),
  LabTechnician: emptyModulePermissionsForRole("LabTechnician"),
};

const buildPermissionPayload = (form) => {
  const modulePermissions = normalizeModulePermissionMap(form.modulePermissions, form.role);
  const selectedModules = getSelectedPermissionModules(modulePermissions, form.role);
  return {
    permissions: selectedModules.map(({ module, permissions }) => {
      const hasModulePermission = (permission) => permissions.includes(permission);
      return {
        module,
        canView: hasModulePermission("View"),
        canCreate: hasModulePermission("Create"),
        canEdit: hasModulePermission("Edit"),
        canDelete: hasModulePermission("Delete"),
      };
    }),
  };
};

const saveUserPermissions = async (userId, form) => {
  const path = `user-permissions/users/${encodeURIComponent(userId)}`;
  return requestJson(path, {
    method: "PUT",
    body: JSON.stringify(buildPermissionPayload(form)),
  });
};

function AdminRolesPermissions() {
  const { canCreate, canEdit, canDelete } = useAdminModulePermissions("Roles & Permissions");
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activeActionState, setActiveActionState] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [roleMatrix, setRoleMatrix] = useState(emptyRoleMatrix);
  const [savingRole, setSavingRole] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const eligibleUsers = useMemo(
    () => users.filter((user) => STAFF_ROLE_KEYS.has(normalizeKey(user.role))),
    [users]
  );

  const selectedUser = useMemo(
    () => eligibleUsers.find((user) => String(user.id) === String(form.userId)),
    [eligibleUsers, form.userId]
  );

  const formModulePermissions = useMemo(
    () => normalizeModulePermissionMap(form.modulePermissions, form.role),
    [form.modulePermissions, form.role]
  );

  const loadData = async () => {
    setLoading(true);
    setError("");

    try {
      const [userResult, labTechnicianResult] = await Promise.allSettled([
        requestJson("user-permissions/eligible-users"),
        requestJson("Staff/lab-technicians"),
      ]);

      if (userResult.status !== "fulfilled") {
        throw userResult.reason;
      }

      const eligibleRows = parseEligibleUsers(userResult.value);
      const labTechnicianRows =
        labTechnicianResult.status === "fulfilled"
          ? parseList(labTechnicianResult.value).map((user) => ({
              ...user,
              role: getValue(user, ["role", "Role", "roleName", "RoleName"], "LabTechnician"),
            }))
          : [];
      const userById = new Map();
      const userByIdentity = new Map();
      const getIdentityKey = (user) => {
        const roleKey = normalizeKey(user.role);
        const emailKey = normalizeKey(user.email);
        return roleKey && emailKey ? `${roleKey}:${emailKey}` : "";
      };
      const addUser = (user, { preferExistingIdentity = false } = {}) => {
        if (!user.id) return;
        const identityKey = getIdentityKey(user);
        const existingByIdentity = identityKey ? userByIdentity.get(identityKey) : null;
        const existingById = userById.get(String(user.id));
        const existing = existingByIdentity || existingById;
        const merged = existing
          ? preferExistingIdentity && existingByIdentity
            ? { ...user, ...existing }
            : { ...existing, ...user }
          : user;
        if (existing?.id && String(existing.id) !== String(merged.id)) {
          userById.delete(String(existing.id));
        }
        userById.set(String(merged.id), merged);
        if (identityKey) userByIdentity.set(identityKey, merged);
      };

      eligibleRows.map(normalizeUser).forEach((user) => addUser(user));
      labTechnicianRows.map(normalizeUser).forEach((user) => addUser(user, { preferExistingIdentity: true }));
      const baseUsers = Array.from(userById.values());
      const permissionResults = await Promise.allSettled(
        baseUsers.map((user) => requestJson(`user-permissions/users/${encodeURIComponent(user.id)}`))
      );
      const nextUsers = baseUsers.map((user, index) => {
        const permissionRecord =
          permissionResults[index]?.status === "fulfilled"
            ? permissionResults[index].value?.data || permissionResults[index].value
            : null;
        const backendPermissions = getPermissionModulesFromAssignment(user, user.role || "Doctor");
        const directPermissions = permissionRecord
          ? getPermissionModulesFromAssignment({ ...user, ...permissionRecord, raw: permissionRecord }, user.role || permissionRecord.role || "Doctor")
          : {};
        const mergedPermissions = mergeModulePermissionMaps(backendPermissions, directPermissions, user.role || "Doctor");
        const hasMergedPermissions = Object.values(mergedPermissions).some((permissions) => permissions.length);
        return hasMergedPermissions
          ? {
              ...user,
              ...(permissionRecord && typeof permissionRecord === "object" ? { raw: permissionRecord } : {}),
              module: `${Object.values(mergedPermissions).filter((permissions) => permissions.length).length} modules`,
              modulePermissions: mergedPermissions,
            }
          : user;
      });
      setUsers(nextUsers);

      const detailedAssignments = nextUsers;
      detailedAssignments
        .filter((assignment) => Object.values(assignment.modulePermissions || {}).some((permissions) => permissions.length) || assignmentHasSavedModules(assignment))
        .forEach((assignment) => {
          saveRoleModulePermissions(
            assignment,
            assignment.role || "Doctor",
            Object.values(assignment.modulePermissions || {}).some((permissions) => permissions.length)
              ? assignment.modulePermissions
              : getPermissionModulesFromAssignment(assignment, assignment.role || "Doctor")
          );
        });

      setAssignments(detailedAssignments);
      const nextRoleMatrix = STAFF_ROLES.reduce(
        (matrix, role) => ({
          ...matrix,
          [role]: emptyModulePermissionsForRole(role),
        }),
        {}
      );
      nextUsers.forEach((user) => {
        const role = STAFF_ROLES.find((item) => normalizeKey(item) === normalizeKey(user.role));
        if (!role) return;
        const savedPermissions = Object.values(user.modulePermissions || {}).some((permissions) => permissions.length)
          ? user.modulePermissions
          : getPermissionModulesFromAssignment(user, role);
        nextRoleMatrix[role] = mergeModulePermissionMaps(nextRoleMatrix[role], savedPermissions, role);
      });
      setRoleMatrix(nextRoleMatrix);
    } catch (loadError) {
      setUsers([]);
      setAssignments([]);
      setError(loadError.message || "Unable to load roles and permissions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const updateForm = (field, value) => {
    const nextSelectedRole =
      field === "userId"
        ? eligibleUsers.find((user) => String(user.id) === String(value))?.role
        : field === "role"
          ? value
          : "";
    setForm((previous) => ({
      ...previous,
      [field]: value,
      ...(field === "userId"
        ? {
            role: nextSelectedRole || previous.role,
            modulePermissions: emptyModulePermissionsForRole(nextSelectedRole || previous.role),
          }
        : {}),
      ...(field === "role"
        ? {
            modulePermissions: emptyModulePermissionsForRole(value),
          }
        : {}),
    }));
    setError("");
    setSuccess("");
  };

  const openAdd = () => {
    if (!canCreate) {
      setError("You do not have permission to create roles.");
      return;
    }
    const firstUser = eligibleUsers[0];
    setForm({
      ...emptyForm,
      userId: firstUser?.id || "",
      role: firstUser?.role || "Doctor",
      module: GENERAL_MODULE,
      permissions: [],
      modulePermissions: emptyModulePermissionsForRole(firstUser?.role || "Doctor"),
    });
    setError("");
    setSuccess("");
    setShowForm(true);
  };

  const openEdit = (assignment) => {
    if (!canEdit) {
      setError("You do not have permission to edit roles.");
      return;
    }
    setForm({
      userId: assignment.id,
      role: assignment.role || "Doctor",
      module: GENERAL_MODULE,
      permissions: normalizePermissionList(assignment.permissions),
      modulePermissions: getPermissionModulesFromAssignment(assignment, assignment.role || "Doctor"),
    });
    setError("");
    setSuccess("");
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;
    setShowForm(false);
    setForm(emptyForm);
  };

  const togglePermission = (module, permission) => {
    if (!canEdit && !canCreate) return;
    setForm((previous) => {
      const currentMap = normalizeModulePermissionMap(previous.modulePermissions, previous.role);
      const currentPermissions = normalizePermissionList(currentMap[module] || []);
      const exists = currentPermissions.includes(permission);
      const nextPermissions = normalizePermissionList(
        exists
          ? currentPermissions.filter((item) => item !== permission)
          : [...currentPermissions, permission]
      );
      return {
        ...previous,
        modulePermissions: {
          ...currentMap,
          [module]: nextPermissions,
        },
      };
    });
  };

  const toggleRolePermission = (role, module, permission) => {
    if (savingRole || !canEdit) return;

    setRoleMatrix((previous) => {
      const currentMap = normalizeModulePermissionMap(previous[role], role);
      const currentPermissions = normalizePermissionList(currentMap[module] || []);
      const exists = currentPermissions.includes(permission);
      return {
        ...previous,
        [role]: {
          ...currentMap,
          [module]: normalizePermissionList(
            exists
              ? currentPermissions.filter((item) => item !== permission)
              : [...currentPermissions, permission]
          ),
        },
      };
    });
    setError("");
    setSuccess("");
  };

  const areAllStaffPermissionsSelected = useMemo(() => {
    return STAFF_ROLES.every((role) => {
      const roleMap = normalizeModulePermissionMap(roleMatrix[role], role);
      const modules = getRoleModules(role);
      return modules.every((module) => {
        const list = normalizePermissionList(roleMap[module] || []);
        return PERMISSIONS.every((p) => list.includes(p));
      });
    });
  }, [roleMatrix]);

  const isColumnStaffAllSelected = (permission) => {
    return STAFF_ROLES.every((role) => {
      const roleMap = normalizeModulePermissionMap(roleMatrix[role], role);
      const modules = getRoleModules(role);
      return modules.every((module) => {
        const list = normalizePermissionList(roleMap[module] || []);
        return list.includes(permission);
      });
    });
  };

  const toggleSelectAllStaffPermissions = () => {
    setRoleMatrix(() => {
      const nextMatrix = {};
      const shouldSelectAll = !areAllStaffPermissionsSelected;
      STAFF_ROLES.forEach((role) => {
        const modules = getRoleModules(role);
        nextMatrix[role] = {};
        modules.forEach((module) => {
          nextMatrix[role][module] = shouldSelectAll ? [...PERMISSIONS] : [];
        });
      });
      return nextMatrix;
    });
    setError("");
    setSuccess("");
  };

  const toggleColumnStaffPermission = (permission) => {
    setRoleMatrix((previous) => {
      const shouldSelectColumn = !isColumnStaffAllSelected(permission);
      const nextMatrix = {};
      STAFF_ROLES.forEach((role) => {
        const currentMap = normalizeModulePermissionMap(previous[role], role);
        const modules = getRoleModules(role);
        nextMatrix[role] = {};
        modules.forEach((module) => {
          const currentList = normalizePermissionList(currentMap[module] || []);
          if (shouldSelectColumn) {
            nextMatrix[role][module] = Array.from(new Set([...currentList, permission]));
          } else {
            nextMatrix[role][module] = currentList.filter((p) => p !== permission);
          }
        });
      });
      return nextMatrix;
    });
    setError("");
    setSuccess("");
  };

  const isFormColumnAllSelected = (permission) => {
    const map = formModulePermissions;
    const modules = getRoleModules(form.role);
    return modules.every((module) => {
      const list = normalizePermissionList(map[module] || []);
      return list.includes(permission);
    });
  };

  const isFormAllPermissionsSelected = useMemo(() => {
    const map = formModulePermissions;
    const modules = getRoleModules(form.role);
    return modules.every((module) => {
      const list = normalizePermissionList(map[module] || []);
      return PERMISSIONS.every((p) => list.includes(p));
    });
  }, [formModulePermissions, form.role]);

  const toggleFormSelectAll = () => {
    setForm((previous) => {
      const modules = getRoleModules(previous.role);
      const shouldSelectAll = !isFormAllPermissionsSelected;
      const nextMap = {};
      modules.forEach((module) => {
        nextMap[module] = shouldSelectAll ? [...PERMISSIONS] : [];
      });
      return {
        ...previous,
        modulePermissions: nextMap,
      };
    });
  };

  const toggleFormColumnPermission = (permission) => {
    setForm((previous) => {
      const currentMap = normalizeModulePermissionMap(previous.modulePermissions, previous.role);
      const modules = getRoleModules(previous.role);
      const shouldSelectColumn = !isFormColumnAllSelected(permission);
      const nextMap = {};
      modules.forEach((module) => {
        const currentList = normalizePermissionList(currentMap[module] || []);
        if (shouldSelectColumn) {
          nextMap[module] = Array.from(new Set([...currentList, permission]));
        } else {
          nextMap[module] = currentList.filter((p) => p !== permission);
        }
      });
      return {
        ...previous,
        modulePermissions: nextMap,
      };
    });
  };

  const handleSaveRolePermissions = async (role) => {
    if (!canEdit) {
      setError("You do not have permission to edit role permissions.");
      return;
    }
    const roleUsers = eligibleUsers.filter((user) => normalizeKey(user.role) === normalizeKey(role));

    if (!roleUsers.length) {
      setError(`No ${formatRoleLabel(role).toLowerCase()} users found.`);
      return;
    }

    setSavingRole(role);
    setError("");
    setSuccess("");

    try {
      const modulePermissions = normalizeModulePermissionMap(roleMatrix[role], role);
      const hasAnyPermission = Object.values(modulePermissions).some((permissions) => normalizePermissionList(permissions).length);
      if (!hasAnyPermission) {
        setError(`Select at least one permission for ${formatRoleLabel(role)}.`);
        return;
      }
      const saveResults = await Promise.all(
        roleUsers.map((user) =>
          saveUserPermissions(user.id, {
            ...emptyForm,
            userId: user.id,
            role,
            module: GENERAL_MODULE,
            permissions: [],
            modulePermissions,
          })
        )
      );
      void saveResults;
      roleUsers.forEach((user) => saveRoleModulePermissions(user, role, modulePermissions));
      setSuccess(`${formatRoleLabel(role)} permissions assigned successfully.`);
      await loadData();
    } catch (saveError) {
      setError(saveError.message || `Unable to assign ${role.toLowerCase()} permissions.`);
    } finally {
      setSavingRole("");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const isEditing = assignments.some((item) => String(item.id) === String(form.userId));
    if (isEditing ? !canEdit : !canCreate) {
      setError(`You do not have permission to ${isEditing ? "edit" : "create"} roles.`);
      return;
    }

    if (!form.userId) {
      setError("Select a staff member.");
      return;
    }

    const selectedPermissions = normalizeModulePermissionMap(form.modulePermissions, form.role);
    const hasAnyPermission = Object.values(selectedPermissions).some((permissions) => normalizePermissionList(permissions).length);
    if (!hasAnyPermission) {
      setError("Select at least one module permission.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const saveResult = await saveUserPermissions(form.userId, form);
      void saveResult;
      saveRoleModulePermissions(selectedUser, form.role, selectedPermissions);
      setSuccess("Permissions saved successfully.");
      await loadData();
      closeForm();
    } catch (saveError) {
      setError(saveError.message || "Unable to save permissions.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (assignment) => {
    if (!canDelete) {
      setError("You do not have permission to delete role permissions.");
      return;
    }
    if (!assignment?.id) {
      setError("User id is missing.");
      return;
    }

    if (!window.confirm(`Remove permissions for ${assignment.name || assignment.email || "this user"}?`)) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      await requestJson(`user-permissions/users/${encodeURIComponent(assignment.id)}`, {
        method: "DELETE",
      });
      removeRoleModulePermissions(assignment);
      setSuccess("Permissions removed successfully.");
      await loadData();
    } catch (deleteError) {
      setError(deleteError.message || "Unable to remove permissions.");
    }
  };

  return (
    <div className="admin-roles-page">
      <div className="sa-page-header">
        <div>
          <h1>Roles & Permissions</h1>
          <p>Create roles for doctors, receptionists, nurses, and lab technicians, then assign View, Create, Edit, and Delete permissions.</p>
        </div>
        <div className="sa-page-actions">
          <button className="sa-btn sa-btn-primary" type="button" onClick={openAdd} disabled={loading || !eligibleUsers.length || !canCreate}>
            <Plus size={16} /> Create Role
          </button>
          <button className="sa-btn" type="button" onClick={loadData} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {success ? <div className="sa-state">{success}</div> : null}
      {error ? <div className="sa-state sa-state--error">{error}</div> : null}

      {showForm ? (
        <form className="sa-form-card sa-role-form" onSubmit={handleSubmit}>
          <div className="sa-modal-header">
            <div>
              <h3>{assignments.some((item) => String(item.id) === String(form.userId)) ? "Edit Role" : "Create Role"}</h3>
              <p className="sa-form-subtitle">Select a staff member and assign screen-level permissions from that role sidebar.</p>
            </div>
            <button className="sa-icon-btn" type="button" onClick={closeForm} disabled={saving} aria-label="Close role form">
              <X size={18} />
            </button>
          </div>

          <div className="sa-form-grid">
            <div className="sa-form-field">
              <label>Staff</label>
              <select value={form.userId} onChange={(event) => updateForm("userId", event.target.value)}>
                <option value="">Select staff</option>
                {eligibleUsers.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.name || user.email || user.id} - {formatRoleLabel(user.role || "Staff")}
                  </option>
                ))}
              </select>
            </div>

            <div className="sa-form-field">
              <label>Role</label>
              <select value={form.role} onChange={(event) => updateForm("role", event.target.value)}>
                {STAFF_ROLES.map((role) => (
                  <option value={role} key={role}>
                    {formatRoleLabel(role)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <h3>Module Permissions</h3>
            <p className="sa-form-subtitle">Only screens with View permission will appear in the staff sidebar.</p>
            <div className="sa-permission-matrix">
              <div className="sa-permission-head">
                <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <span>Module</span>
                  <button
                    type="button"
                    className="sa-btn sa-btn-primary"
                    style={{ padding: "3px 10px", fontSize: "11px", height: "26px", fontWeight: 700 }}
                    onClick={toggleFormSelectAll}
                    disabled={!(canCreate || canEdit)}
                    title={isFormAllPermissionsSelected ? "Uncheck all module permissions" : "Check all module permissions"}
                  >
                    <Check size={13} />
                    {isFormAllPermissionsSelected ? "Deselect All" : "Select All"}
                  </button>
                </div>
                {PERMISSIONS.map((permission) => {
                  const checked = isFormColumnAllSelected(permission);
                  return (
                    <label key={permission} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!(canCreate || canEdit)}
                        onChange={() => toggleFormColumnPermission(permission)}
                        title={`Check/Uncheck ${permission} for all modules`}
                      />
                      <span>{permission}</span>
                    </label>
                  );
                })}
              </div>
              {getRoleModules(form.role).map((module) => {
                const permissions = normalizePermissionList(formModulePermissions[module]);
                return (
                  <div className="sa-permission-row" key={module}>
                    <span>{module}</span>
                    {PERMISSIONS.map((permission) => (
                      <label className="sa-checkbox" key={permission}>
                        <input
                          type="checkbox"
                          checked={permissions.includes(permission)}
                          disabled={!(canCreate || canEdit)}
                          onChange={() => togglePermission(module, permission)}
                        />
                        {permission}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="sa-page-actions sa-form-actions">
            <button className="sa-btn" type="button" onClick={closeForm} disabled={saving}>
              Close
            </button>
            <button className="sa-btn sa-btn-primary" type="submit" disabled={saving || (assignments.some((item) => String(item.id) === String(form.userId)) ? !canEdit : !canCreate)}>
              <Check size={16} />
              {saving ? "Saving..." : "Save Role"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="sa-table">
        <div
          className="sa-table-head"
          style={{ gridTemplateColumns: "70px minmax(140px,.7fr) minmax(150px,.8fr) minmax(190px,1fr) minmax(220px,1fr) 120px" }}
        >
          <span>S.No.</span>
          <span>Role</span>
          <span>Module</span>
          <span>Assigned Staff</span>
          <span>Permissions</span>
          <span>Actions</span>
        </div>

        {loading ? <div className="sa-state">Loading roles...</div> : null}
        {!loading && assignments.length === 0 ? <div className="sa-empty">No staff permissions found.</div> : null}

        {assignments.map((assignment, index) => (
          <div
            className="sa-table-row"
            key={assignment.id || `${assignment.email}-${index}`}
            style={{ gridTemplateColumns: "70px minmax(140px,.7fr) minmax(150px,.8fr) minmax(190px,1fr) minmax(220px,1fr) 120px" }}
          >
            <span className="sa-table-cell">{index + 1}</span>
            <span className="sa-table-cell">
              <b>{formatRoleLabel(assignment.role || "-")}</b>
            </span>
            <span className="sa-table-cell">
              {Object.values(getPermissionModulesFromAssignment(assignment, assignment.role)).some((permissions) => permissions.length)
                ? `${Object.values(getPermissionModulesFromAssignment(assignment, assignment.role)).filter((permissions) => permissions.length).length} modules`
                : assignment.module || "-"}
            </span>
            <span className="sa-table-cell">
              <span className="sa-role-admin-list">
                <b>{assignment.name || assignment.email || "-"}</b>
                <span className="sa-role-admin-names">{assignment.email || assignment.id}</span>
              </span>
            </span>
            <span className="sa-table-cell">
              {Object.entries(getPermissionModulesFromAssignment(assignment, assignment.role))
                .filter(([, permissions]) => permissions.length)
                .map(([module, permissions]) => `${module}: ${normalizePermissionList(permissions).join(", ")}`)
                .join(" | ") || normalizePermissionList(assignment.permissions).join(", ") || "-"}
            </span>
            <span className="sa-actions">
              <ActionsGroup
                rowId={assignment.id || `${assignment.email}-${index}`}
                activeActionState={activeActionState}
                setActiveActionState={setActiveActionState}
                canView={true}
                canEdit={canEdit}
                canStatus={false}
                canDelete={canDelete}
                onView={() => openEdit(assignment)}
                onEdit={() => openEdit(assignment)}
                onDelete={() => handleDelete(assignment)}
              />
            </span>
          </div>
        ))}
      </div>

      <div className="sa-form-card sa-permission-card">
        <h3>Assign Permissions</h3>
        <p className="sa-form-subtitle">Assign default permissions by role across every module from that role sidebar.</p>
        <div className="sa-permission-matrix sa-permission-matrix--assign">
          <div className="sa-permission-head">
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span>Role / Module</span>
              <button
                type="button"
                className="sa-btn sa-btn-primary"
                style={{ padding: "3px 10px", fontSize: "11px", height: "26px", fontWeight: 700 }}
                onClick={toggleSelectAllStaffPermissions}
                disabled={Boolean(savingRole) || loading || !canEdit}
                title={areAllStaffPermissionsSelected ? "Uncheck all staff permissions" : "Check all staff permissions"}
              >
                <Check size={13} />
                {areAllStaffPermissionsSelected ? "Deselect All" : "Select All"}
              </button>
            </div>
            {PERMISSIONS.map((permission) => {
              const checked = isColumnStaffAllSelected(permission);
              return (
                <label key={permission} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={Boolean(savingRole) || !canEdit}
                    onChange={() => toggleColumnStaffPermission(permission)}
                    title={`Check/Uncheck ${permission} for all staff roles`}
                  />
                  <span>{permission}</span>
                </label>
              );
            })}
            <span>Actions</span>
          </div>
          {STAFF_ROLES.map((role) => {
            const rolePermissions = normalizeModulePermissionMap(roleMatrix[role], role);

            return (
              <React.Fragment key={role}>
                {getRoleModules(role).map((module, index) => {
                  const permissions = normalizePermissionList(rolePermissions[module]);
                  return (
                    <div className="sa-permission-row" key={`${role}-${module}`}>
                      <span>
                        {index === 0 ? <ShieldCheck size={15} /> : null}
                        {index === 0 ? formatRoleLabel(role) : ""}
                        <small style={{ display: "block", color: "#64748b", marginTop: index === 0 ? 4 : 0 }}>{module}</small>
                      </span>
                      {PERMISSIONS.map((permission) => (
                        <label className="sa-checkbox" key={permission}>
                          <input
                            type="checkbox"
                            checked={permissions.includes(permission)}
                            disabled={Boolean(savingRole) || !canEdit}
                            onChange={() => toggleRolePermission(role, module, permission)}
                          />
                          {permission}
                        </label>
                      ))}
                      {index === 0 ? (
                        <button
                          className="sa-btn sa-btn-primary"
                          type="button"
                          onClick={() => handleSaveRolePermissions(role)}
                          disabled={Boolean(savingRole) || loading || !canEdit}
                        >
                          <Check size={16} />
                          {savingRole === role ? "Saving..." : "Assign"}
                        </button>
                      ) : <span />}
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default AdminRolesPermissions;

