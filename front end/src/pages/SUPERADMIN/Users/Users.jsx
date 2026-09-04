import React, { useEffect, useMemo, useState } from "react";
import { Eye, Pencil, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import Header from "../../../components/superadmin/Header";
import DataTable from "../../../components/superadmin/DataTable";
import SearchFilter from "../../../components/superadmin/SearchFilter";
import { ActionsGroup } from "../../../components/ActionsGroup";
import {
  deleteUser,
  fetchUser,
  fetchUsers,
  saveUser,
  updateUserStatus,
} from "../superAdminApi";
import {
  onlyAlpha,
  onlyIndianMobileValue,
  validateAlpha,
  validateMobile,
  validateGmail,
} from "../../../utils/validation";
import { formatTitleCase } from "../../../utils/format";
import { validateUniqueMobileNumber } from "../../../utils/mobileUniqueness";

const emptyUser = {
  name: "",
  email: "",
  clinic: "",
  hospitalId: "",
  clinicId: "",
  type: "Patient",
  role: "Patient",
  status: "Active",
  phone: "",
  mobileNumber: "",
  password: "",
};

const normalizeRoleText = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const isAdminRoleUser = (user = {}) => {
  const role = normalizeRoleText(user.role || user.type || user.raw?.role || user.raw?.roleName);
  return role === "admin";
};

const FIELD_LABELS = {
  name: "Name",
  email: "Email",
  mobileNumber: "Mobile number",
  password: "Password",
};

function Users() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [users, setUsers] = useState([]);
  const [activeActionState, setActiveActionState] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState("");
  const [form, setForm] = useState(emptyUser);
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const loadUsers = async () => {
    setLoading(true);
    setError("");

    try {
      setUsers(await fetchUsers());
    } catch (requestError) {
      setError(requestError.message || "Unable to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const openUserDetails = async (user) => {
    setSelectedUser(user);
    setShowForm(false);
    setEditingUserId("");
    setError("");

    try {
      setSelectedUser({ ...user, ...(await fetchUser(user.id)) });
    } catch {
      setSelectedUser(user);
    }
  };

  const openEditForm = async (user) => {
    if (!isAdminRoleUser(user)) {
      setError("Actions are available only for Admin users.");
      return;
    }

    setEditingUserId(user.id);
    setSelectedUser(null);
    setForm({ ...emptyUser, ...user });
    setFieldErrors({});
    setShowForm(true);
    setError("");

    try {
      setForm({ ...emptyUser, ...(await fetchUser(user.id)) });
    } catch {
      setForm({ ...emptyUser, ...user });
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingUserId("");
    setForm(emptyUser);
    setFieldErrors({});
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    let nextValue = value;

    if (name === "name") {
      nextValue = formatTitleCase(onlyAlpha(value));
    }

    if (["phone", "mobileNumber"].includes(name)) {
      nextValue = onlyIndianMobileValue(value);
    }

    setForm((current) => ({
      ...current,
      [name]: nextValue,
      ...(name === "mobileNumber" ? { phone: nextValue } : {}),
    }));
    setFieldErrors((current) => ({ ...current, [name]: "" }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nameError = validateAlpha(form.name, "Name");
    const emailRequiredError = !form.email.trim()
      ? "Email is required."
      : "";
    const passwordRequiredError = !editingUserId && !form.password
      ? "Password is required."
      : "";
    const emailError = emailRequiredError || validateGmail(form.email, "Email");
    const mobileError = form.mobileNumber
      ? validateMobile(form.mobileNumber, "Mobile number")
      : "";

    const nextFieldErrors = {
      ...(nameError ? { name: nameError } : {}),
      ...(emailError ? { email: emailError } : {}),
      ...(mobileError ? { mobileNumber: mobileError } : {}),
      ...(passwordRequiredError ? { password: passwordRequiredError } : {}),
    };

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      const invalidFields = Object.keys(nextFieldErrors).map(
        (field) => FIELD_LABELS[field] || field
      );
      setError(
        invalidFields.length === 1
          ? `Please correct the ${invalidFields[0]} field.`
          : `Please correct the following fields: ${invalidFields.join(", ")}.`
      );
      return;
    }

    setFieldErrors({});

    setSaving(true);
    setError("");

    try {
      const duplicateMobileMessage = await validateUniqueMobileNumber(
        form.mobileNumber || form.phone,
        {
          current: editingUserId ? { id: editingUserId, source: "users" } : {},
          localRecords: users,
          localSource: "users",
        }
      );
      if (duplicateMobileMessage) {
        setFieldErrors({ mobileNumber: duplicateMobileMessage });
        setError(duplicateMobileMessage);
        setSaving(false);
        return;
      }

      await saveUser(form, editingUserId || undefined);
      closeForm();
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message || "Unable to save user.");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const selectedStatus = String(status || "").trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch = [user.name, user.email, user.clinic, user.type]
        .some((value) => String(value).toLowerCase().includes(query));
      const matchesStatus =
        selectedStatus === "all" ||
        String(user.status || "").trim().toLowerCase() === selectedStatus;
      return matchesSearch && matchesStatus;
    });
  }, [search, status, users]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [search, status, rows.length]);

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage]);

  const toggleStatus = async (user) => {
    if (!isAdminRoleUser(user)) {
      setError("Actions are available only for Admin users.");
      return;
    }

    const currentStatus = String(user.status || "").trim().toLowerCase();
    const nextStatus = currentStatus === "active" ? "Inactive" : "Active";
    setError("");

    try {
      await updateUserStatus(user.id, nextStatus);
      setUsers((currentUsers) =>
        currentUsers.map((currentUser) =>
          String(currentUser.id) === String(user.id)
            ? { ...currentUser, status: nextStatus }
            : currentUser
        )
      );
      if (selectedUser?.id === user.id) {
        setSelectedUser((current) =>
          current ? { ...current, status: nextStatus } : current
        );
      }
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message || "Unable to update user status.");
    }
  };

  const handleDelete = async (user) => {
    if (!isAdminRoleUser(user)) {
      setError("Actions are available only for Admin users.");
      return;
    }

    const confirmed = window.confirm(`Delete ${formatTitleCase(user.name) || "this user"}?`);
    if (!confirmed) return;

    setError("");

    try {
      await deleteUser(user.id);
      if (selectedUser?.id === user.id) setSelectedUser(null);
      if (editingUserId === user.id) closeForm();
      setUsers((currentUsers) =>
        currentUsers
          .filter((currentUser) => String(currentUser.id) !== String(user.id))
          .map((currentUser) => ({
            ...currentUser,
            status: String(currentUser.status || "").trim(),
          }))
      );
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message || "Unable to delete user.");
    }
  };

  const columns = [
    {
      key: "serial",
      label: "S.No.",
      width: "minmax(52px, 0.25fr)",
      render: (_user, index) => index + 1,
    },
    {
      key: "name",
      label: "Name",
      width: "minmax(120px, 0.8fr)",
      render: (user) => formatTitleCase(user.name) || "-",
    },
    {
      key: "email",
      label: "Email",
      width: "minmax(220px, 1fr)",
      cellClassName: "sa-table-cell--nowrap",
      render: (user) => (
        <span title={user.email || ""} className="sa-table-text-overflow">
          {user.email || "-"}
        </span>
      ),
    },
    { key: "clinic", label: "Clinic", width: "minmax(130px, 0.8fr)" },
    { key: "role", label: "Role", width: "minmax(90px, 0.6fr)" },
    {
      key: "status",
      label: "Status",
      width: "minmax(90px, 0.6fr)",
      render: (user) => (
        <span className={`sa-badge ${user.status === "Active" ? "is-active" : "is-danger"}`}>
          {user.status}
        </span>
      ),
    },
    {
      key: "lastActive",
      label: "Last Active",
      width: "minmax(168px, 1fr)",
      cellClassName: "sa-table-cell--nowrap sa-table-cell--last-active",
      render: (user) => {
        const lastActive = user.lastActive || user.lastSeen || user.lastActiveAt || user.updatedAt || user.createdAt || "Never Logged In";
        return (
          <span title={lastActive} className="sa-table-text-overflow">
            {lastActive}
          </span>
        );
      },
    },
    {
      key: "actions",
      label: "Actions",
      width: "minmax(210px, auto)",
      cellClassName: "sa-table-cell--actions",
      render: (user) => {
        const canUseRowActions = isAdminRoleUser(user);
        const isActive = String(user.status || "").trim().toLowerCase() === "active";
        const enableActions = canUseRowActions && isActive;

        return (
          <ActionsGroup
            rowId={user.id}
            activeActionState={activeActionState}
            setActiveActionState={setActiveActionState}
            canView={true}
            canEdit={enableActions}
            canStatus={canUseRowActions}
            canDelete={enableActions}
            statusChecked={isActive}
            statusTitle={isActive ? "Deactivate user" : "Activate user"}
            onView={() => openUserDetails(user)}
            onEdit={() => openEditForm(user)}
            onStatus={() => toggleStatus(user)}
            onDelete={() => handleDelete(user)}
          />
        );
      },
    },
  ];

  return (
    <>
      <Header
        title="User Management"
        subtitle={`${rows.length} ${rows.length === 1 ? "User" : "Users"} Found`}
      />

      <SearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Search users by name, email, clinic, or type..."
        filters={["All", "Active", "Inactive"]}
        selectedFilter={status}
        onFilterChange={setStatus}
      />

      <DataTable
        className="sa-table--users"
        columns={columns}
        rows={pagedRows}
        loading={loading}
        error={!showForm ? error : ""}
        rowIndexOffset={(currentPage - 1) * pageSize}
        emptyMessage="No users match your filters."
      />

      <div className="sa-table-footer">
        <div className="sa-table-summary">
          Showing {pagedRows.length} of {rows.length} users
        </div>
        <div className="sa-pagination">
          <button type="button" className="sa-btn" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
            First
          </button>
          <button type="button" className="sa-btn" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1}>
            Prev
          </button>
          <span className="sa-pagination-label">Page {currentPage} of {pageCount}</span>
          <button type="button" className="sa-btn" onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))} disabled={currentPage === pageCount}>
            Next
          </button>
          <button type="button" className="sa-btn" onClick={() => setCurrentPage(pageCount)} disabled={currentPage === pageCount}>
            Last
          </button>
        </div>
      </div>

      {showForm ? (
        <div className="sa-modal-backdrop" role="presentation" onMouseDown={closeForm}>
          <div
            className="sa-modal sa-modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sa-user-form-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <form className="sa-form-card sa-modal-card" onSubmit={handleSubmit} noValidate>
              <div className="sa-modal-header">
                <div>
                  <h3 id="sa-user-form-title">{editingUserId ? "Edit User" : "Create User"}</h3>
                  <p>Manage user profile, access type, and status.</p>
                </div>
                <button type="button" className="sa-icon-btn" onClick={closeForm} title="Close">
                  <X size={16} />
                </button>
              </div>
              {error ? <div className="sa-state sa-state--error">{error}</div> : null}
              <div className="sa-form-grid">
                <div className="sa-form-field">
                  <label>Name</label>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    required
                    className={fieldErrors.name ? "is-invalid" : ""}
                  />
                  {fieldErrors.name ? (
                    <span className="sa-field-error">{fieldErrors.name}</span>
                  ) : null}
                </div>
                <div className="sa-form-field">
                  <label>Email</label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    required
                    className={fieldErrors.email ? "is-invalid" : ""}
                  />
                  {fieldErrors.email ? (
                    <span className="sa-field-error">{fieldErrors.email}</span>
                  ) : null}
                </div>
                <div className="sa-form-field">
                  <label>Clinic</label>
                  <input name="clinic" value={form.clinic} onChange={handleChange} />
                </div>
                <div className="sa-form-field">
                  <label>Hospital ID</label>
                  <input
                    name="hospitalId"
                    type="number"
                    value={form.hospitalId}
                    onChange={handleChange}
                  />
                </div>
                <div className="sa-form-field">
                  <label>Clinic ID</label>
                  <input
                    name="clinicId"
                    type="number"
                    value={form.clinicId}
                    onChange={handleChange}
                  />
                </div>
                <div className="sa-form-field">
                  <label>Type</label>
                  <select
                    name="type"
                    value={form.type}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        type: event.target.value,
                        role: event.target.value,
                      }))
                    }
                  >
                    <option>Patient</option>
                    <option>Doctor</option>
                    <option>Admin</option>
                    <option>Receptionist</option>
                  </select>
                </div>
                <div className="sa-form-field">
                  <label>Role</label>
                  <input name="role" value={form.role} onChange={handleChange} />
                </div>
                <div className="sa-form-field">
                  <label>Status</label>
                  <select name="status" value={form.status} onChange={handleChange}>
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </div>
                <div className="sa-form-field">
                  <label>Mobile Number</label>
                  <input name="mobileNumber" value={form.mobileNumber} onChange={handleChange} />
                </div>
                <div className="sa-form-field">
                  <label>Password</label>
                  <input
                    name="password"
                    type="password"
                    value={form.password}
                    onChange={handleChange}
                    autoComplete="new-password"
                    required={!editingUserId}
                    className={fieldErrors.password ? "is-invalid" : ""}
                  />
                  {fieldErrors.password ? (
                    <span className="sa-field-error">{fieldErrors.password}</span>
                  ) : null}
                </div>
              </div>
              <div className="sa-page-actions" style={{ marginTop: 14 }}>
                <button type="button" className="sa-btn" onClick={closeForm}>Close</button>
                <button
                  className="sa-btn sa-btn-primary"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {selectedUser ? (
        <div className="sa-modal-backdrop" role="presentation" onMouseDown={() => setSelectedUser(null)}>
          <div
            className="sa-modal sa-modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sa-user-details-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sa-form-card sa-modal-card">
              <div className="sa-modal-header">
                <div>
                  <h3 id="sa-user-details-title">User Details</h3>
                  <p>{selectedUser.id || "Selected user"}</p>
                </div>
                <button className="sa-icon-btn" onClick={() => setSelectedUser(null)} title="Close">
                  <X size={16} />
                </button>
              </div>
              <div className="sa-form-grid">
                {[
                  "name",
                  "email",
                  "clinic",
                  "hospitalId",
                  "clinicId",
                  "type",
                  "role",
                  "status",
                  "mobileNumber",
                  "lastActive",
                ].map((key) => (
                  <div className="sa-form-field" key={key}>
                    <label>{key.replace(/^\w/, (letter) => letter.toUpperCase())}</label>
                    <input value={key === "name" ? formatTitleCase(selectedUser[key]) : selectedUser[key] || ""} readOnly />
                  </div>
                ))}
              </div>
              <div className="sa-page-actions" style={{ marginTop: 14 }}>
                <button className="sa-btn" onClick={() => setSelectedUser(null)}>Close</button>
                <button
                  className="sa-btn sa-btn-primary"
                  onClick={() => openEditForm(selectedUser)}
                  disabled={!isAdminRoleUser(selectedUser)}
                >
                  Edit User
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default Users;
