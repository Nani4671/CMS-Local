import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Eye, Pencil, Plus, RefreshCw, Search, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { ActionsGroup } from "../../components/ActionsGroup";
import "../RECEPTIONISTS/Receptionists.css";
import "./LabTechnicians.css";
import { apiUrl } from "../../config/api";
import { useToast } from "../../components/ToastProvider";
import {
  buildBranchOptions,
  fetchBranchesForHospital,
  getApiHeaders,
  getStoredHospitalId,
  recordBelongsToClinicScope,
} from "../../utils/branchApi";
import { getClinicDisplayName } from "../../utils/clinicDisplay";
import { useAdminModulePermissions } from "../../utils/rolePermissions";
import { onlyAlpha, onlyIndianMobileValue, validateAlpha, validateGmail, validateMobile, validateSelected, validateStrongPassword } from "../../utils/validation";

const STAFF_URL = apiUrl("Staff");
const STAFF_LAB_TECHNICIANS_URL = apiUrl("Staff/lab-technicians");
const STAFF_TOGGLE_STATUS_URL = (id) => apiUrl(`Staff/${encodeURIComponent(id)}/toggle-status`);

const parseList = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.staff)) return data.staff;
  if (Array.isArray(data?.labTechnicians)) return data.labTechnicians;
  return [];
};

const readFirst = (record = {}, keys = [], fallback = "") => {
  for (const key of keys) {
    const value = String(key).split(".").reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), record);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
};

const getLabTechId = (tech) => readFirst(tech, ["id", "Id", "labId", "LabId", "labTechnicianId", "LabTechnicianId", "userId"]);
const getLabTechName = (tech) => readFirst(tech, ["name", "Name", "labName", "LabName", "labTechnicianName", "fullName"], "-");
const getLabTechEmail = (tech) => readFirst(tech, ["email", "Email", "emailAddress", "labEmail"], "-");
const getLabTechPhone = (tech) => readFirst(tech, ["phone", "Phone", "phoneNumber", "mobile", "labPhone"], "-");
const getLabTechBranchId = (tech) => readFirst(tech, ["branchId", "BranchId", "branch.id", "branch.branchId"]);
const getLabTechBranchName = (tech, branchNameById) =>
  readFirst(tech, ["branchName", "BranchName", "branch.name", "branch.branchName"], branchNameById[String(getLabTechBranchId(tech) || "")] || "-");
const getLabTechStatus = (tech) => {
  const active = readFirst(tech, ["isActive", "IsActive", "active", "Active"], "");
  if (typeof active === "boolean") return active ? "Active" : "Inactive";
  return readFirst(tech, ["status", "Status"], "Active");
};

const normalizeRole = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");

const getStaffRole = (record = {}) =>
  normalizeRole(
    readFirst(record, [
      "role",
      "Role",
      "roleName",
      "RoleName",
      "type",
      "Type",
      "staffRole",
      "StaffRole",
      "userRole",
      "UserRole",
    ])
  );

const hasRoleMetadata = (record = {}) => Boolean(getStaffRole(record));
const isLabTechnicianRecord = (record = {}) => ["labtechnician", "labtech", "lab"].includes(getStaffRole(record));

const getErrorMessage = async (response, fallback) => {
  const text = await response.text().catch(() => "");
  if (!text) return fallback;
  try {
    const data = JSON.parse(text);
    const validation = data?.errors && typeof data.errors === "object"
      ? Object.entries(data.errors)
          .flatMap(([key, values]) =>
            (Array.isArray(values) ? values : [values]).map((value) => `${key}: ${value}`)
          )
          .join(" ")
      : "";
    return data?.message || validation || data?.title || text;
  } catch {
    return text;
  }
};

const emptyForm = { name: "", email: "", phone: "", password: "", branchId: "", isActive: true };

const buildStaffFormData = (payload = {}) => {
  const body = new FormData();
  body.append("Name", payload.Name || "");
  body.append("Email", payload.Email || "");
  body.append("Phone", payload.Phone || "");
  body.append("Role", payload.Role || "LabTechnician");
  if (payload.Password) body.append("Password", payload.Password);
  body.append("IsActive", String(payload.IsActive ?? true));
  body.append("BranchId", String(payload.BranchId || ""));
  body.append("Image", new Blob([]), "");
  return body;
};

function LabTechnicians() {
  const toast = useToast();
  const { canCreate, canEdit, canDelete } = useAdminModulePermissions("Lab Technicians");
  const hospitalId = getStoredHospitalId() || localStorage.getItem("clinicId") || "";
  const clinicName = getClinicDisplayName({ hospitalName: localStorage.getItem("hospitalName"), clinicName: localStorage.getItem("clinicName") }, "Clinic");
  const [technicians, setTechnicians] = useState([]);
  const [activeActionState, setActiveActionState] = useState(null);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTech, setEditingTech] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});

  const branchNameById = useMemo(() => branches.reduce((lookup, branch) => ({ ...lookup, [String(branch.id)]: branch.name }), {}), [branches]);
  const scopedBranchIds = useMemo(() => branches.map((branch) => branch.id), [branches]);

  const fetchTechnicians = useCallback(async () => {
    const response = await fetch(STAFF_LAB_TECHNICIANS_URL, { headers: getApiHeaders() });
    if (!response.ok) {
      throw new Error(await getErrorMessage(response, "Unable to load lab technicians."));
    }
    const list = parseList(await response.json().catch(() => null));
    return list.filter((tech) => !hasRoleMetadata(tech) || isLabTechnicianRecord(tech));
  }, [hospitalId]);

  const loadTechnicians = useCallback(async () => {
    setLoading(true);
    try {
      setTechnicians(await fetchTechnicians());
    } catch (error) {
      toast.error(error.message || "Unable to load lab technicians.");
    } finally {
      setLoading(false);
    }
  }, [fetchTechnicians, toast]);

  useEffect(() => {
    loadTechnicians();
    setLoadingBranches(true);
    const loadBranches = async () => {
      try {
        const scopedBranches = await fetchBranchesForHospital(hospitalId, clinicName);
        let options = buildBranchOptions(scopedBranches);
        if (!options.length) {
          options = buildBranchOptions(await fetchBranchesForHospital(""));
        }
        setBranches(options);
      } catch {
        try {
          setBranches(buildBranchOptions(await fetchBranchesForHospital("")));
        } catch {
          setBranches([]);
        }
      } finally {
        setLoadingBranches(false);
      }
    };
    loadBranches();
  }, [hospitalId, clinicName, loadTechnicians]);

  const filteredTechnicians = useMemo(() => {
    const scopedTechnicians = technicians.filter((tech) =>
      recordBelongsToClinicScope(tech, {
        hospitalId,
        clinicName,
        branchIds: scopedBranchIds,
      })
    );
    const term = search.trim().toLowerCase();
    if (!term) return scopedTechnicians;
    return scopedTechnicians.filter((tech) => [getLabTechName(tech), getLabTechEmail(tech), getLabTechPhone(tech), getLabTechBranchName(tech, branchNameById)].join(" ").toLowerCase().includes(term));
  }, [branchNameById, search, technicians, hospitalId, clinicName, scopedBranchIds]);

  const updateField = (field, value) => {
    const nextValue = field === "name" ? onlyAlpha(value) : field === "phone" ? onlyIndianMobileValue(value) : value;
    setForm((current) => ({ ...current, [field]: nextValue }));
    setFieldErrors((current) => ({ ...current, [field]: "", form: "" }));
  };

  const validateForm = () => {
    const errors = {
      name: validateAlpha(form.name, "Name"),
      email: validateGmail(form.email, "Email"),
      phone: validateMobile(form.phone, "Phone"),
      password: editingTech ? "" : validateStrongPassword(form.password, "Password"),
      branchId: validateSelected(form.branchId, "a branch"),
    };
    Object.keys(errors).forEach((key) => !errors[key] && delete errors[key]);
    if (!hospitalId) errors.form = "Clinic not found. Please login again.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const openModal = (tech = null) => {
    if (tech ? !canEdit : !canCreate) {
      toast.error(`You do not have permission to ${tech ? "edit" : "create"} lab technicians.`);
      return;
    }
    setEditingTech(tech);
    setForm(tech ? {
      name: getLabTechName(tech),
      email: getLabTechEmail(tech),
      phone: getLabTechPhone(tech),
      password: "",
      branchId: String(getLabTechBranchId(tech) || ""),
      isActive: !String(getLabTechStatus(tech)).toLowerCase().includes("inactive"),
    } : emptyForm);
    setFieldErrors({});
    setModalOpen(true);
  };

  const closeModal = () => {
    if (!saving) setModalOpen(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (editingTech ? !canEdit : !canCreate) {
      toast.error(`You do not have permission to ${editingTech ? "edit" : "create"} lab technicians.`);
      return;
    }
    if (!validateForm()) return;
    setSaving(true);
    try {
      const payload = {
        Name: form.name.trim(),
        Email: form.email.trim(),
        Phone: form.phone.trim(),
        Password: form.password || undefined,
        Role: "LabTechnician",
        BranchId: Number(form.branchId) || form.branchId,
        IsActive: Boolean(form.isActive),
      };
      const id = getLabTechId(editingTech || {});
      const response = await fetch(id ? `${STAFF_URL}/${encodeURIComponent(id)}` : STAFF_URL, {
        method: id ? "PUT" : "POST",
        headers: getApiHeaders(),
        body: buildStaffFormData(payload),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response, id ? "Unable to update lab technician." : "Unable to create lab technician."));
      toast.success(id ? "Lab technician updated successfully." : "Lab technician created successfully.");
      setModalOpen(false);
      await loadTechnicians();
    } catch (error) {
      setFieldErrors({ form: error.message || "Unable to save lab technician." });
      toast.error(error.message || "Unable to save lab technician.");
    } finally {
      setSaving(false);
    }
  };

  const toggleTechnicianStatus = async (tech) => {
    if (!canEdit) {
      toast.error("You do not have permission to edit lab technicians.");
      return;
    }
    const id = getLabTechId(tech);
    if (!id) return;
    try {
      const response = await fetch(STAFF_TOGGLE_STATUS_URL(id), {
        method: "PATCH",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(await getErrorMessage(response, "Unable to update lab technician status."));
      const updated = await response.json().catch(() => null);
      setTechnicians((previous) =>
        previous.map((item) =>
          String(getLabTechId(item)) === String(id)
            ? { ...item, ...(updated || {}), isActive: updated?.isActive ?? !item.isActive }
            : item
        )
      );
      toast.success("Lab technician status updated successfully.");
    } catch (error) {
      toast.error(error.message || "Unable to update lab technician status.");
    }
  };

  const deleteTechnician = async (tech) => {
    if (!canDelete) {
      toast.error("You do not have permission to delete lab technicians.");
      return;
    }
    const id = getLabTechId(tech);
    if (!id || !window.confirm(`Delete lab technician ${getLabTechName(tech)}?`)) return;
    try {
      const response = await fetch(`${STAFF_URL}/${encodeURIComponent(id)}`, { method: "DELETE", headers: getApiHeaders() });
      if (!response.ok) throw new Error(await getErrorMessage(response, "Unable to delete lab technician."));
      setTechnicians((previous) => previous.filter((item) => String(getLabTechId(item)) !== String(id)));
      toast.success("Lab technician deleted successfully.");
    } catch (error) {
      toast.error(error.message || "Unable to delete lab technician.");
    }
  };

  return (
    <div className="receptionists-page">
      <div className="receptionists-header">
        <div>
          <h2>Lab Technicians</h2>
          <p>{loading ? "Loading lab technicians..." : `${filteredTechnicians.length} lab technicians registered for ${clinicName}`}</p>
        </div>
        <div className="receptionists-header-actions">
          <button type="button" className="receptionists-icon-button" onClick={loadTechnicians} disabled={loading} title="Refresh lab technicians"><RefreshCw size={16} /></button>
          <button type="button" className="receptionists-primary-button" onClick={() => openModal()} disabled={!canCreate}><Plus size={16} /> Add Lab Technician</button>
        </div>
      </div>
      <div className="receptionists-toolbar">
        <label className="receptionists-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lab technicians..." /></label>
      </div>
      <div className="receptionists-table">
        <div className="receptionists-thead">
          <span>S.No.</span>
          <span>Name</span>
          <span>Branch</span>
          <span>Email</span>
          <span>Phone</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        {!loading && filteredTechnicians.length === 0 ? (
          <div className="receptionists-empty">No lab technicians found.</div>
        ) : null}
        {filteredTechnicians.map((tech, index) => {
          const name = getLabTechName(tech);
          const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "LT";
          const status = getLabTechStatus(tech);
          return (
            <div className="receptionists-row" key={getLabTechId(tech) || `${name}-${index}`}>
              <span>{index + 1}</span>
              <div className="receptionists-name-cell">
                <span className="receptionists-avatar"><span>{initials}</span></span>
                <span>
                  <b>{name}</b>
                </span>
              </div>
              <span className="receptionists-cell">{getLabTechBranchName(tech, branchNameById)}</span>
              <span className="receptionists-cell receptionists-email">{getLabTechEmail(tech)}</span>
              <span className="receptionists-cell">{getLabTechPhone(tech)}</span>
              <span className="receptionists-cell receptionists-status-cell">
                <span className={`receptionists-status ${String(status).toLowerCase().includes("inactive") ? "receptionists-status-inactive" : "receptionists-status-active"}`}>
                  {status}
                </span>
              </span>
              <div className="receptionists-actions">
                <ActionsGroup
                  rowId={getLabTechId(tech)}
                  activeActionState={activeActionState}
                  setActiveActionState={setActiveActionState}
                  canView={true}
                  canEdit={canEdit}
                  canStatus={canEdit}
                  canDelete={canDelete}
                  statusChecked={!String(status).toLowerCase().includes("inactive")}
                  statusTitle={String(status).toLowerCase().includes("inactive") ? "Activate lab technician" : "Deactivate lab technician"}
                  onView={() => window.alert(`Lab Technician: ${name || "-"}\nBranch: ${getLabTechBranchName(tech, branchNameById) || "-"}\nEmail: ${getLabTechEmail(tech) || "-"}\nPhone: ${getLabTechPhone(tech) || "-"}\nStatus: ${status || "-"}`)}
                  onEdit={() => openModal(tech)}
                  onStatus={() => toggleTechnicianStatus(tech)}
                  onDelete={() => deleteTechnician(tech)}
                />
              </div>
            </div>
          );
        })}
      </div>
      {modalOpen ? (
        <div className="receptionists-modal-overlay" onClick={closeModal}>
          <div className="receptionists-modal" onClick={(event) => event.stopPropagation()}>
            <div className="receptionists-modal-header">
              <div className="receptionists-modal-title"><div className="receptionists-modal-icon"><Plus size={20} /></div><div><h3>{editingTech ? "Edit Lab Technician" : "Add Lab Technician"}</h3><p>{clinicName}</p></div></div>
              <button type="button" className="receptionists-modal-close" onClick={closeModal} disabled={saving} aria-label="Close lab technician form"><X size={20} /></button>
            </div>
            <form className="receptionists-form" onSubmit={handleSubmit} noValidate>
              <div className="receptionists-field"><label htmlFor="lab-name">Name</label><input id="lab-name" value={form.name} onChange={(event) => updateField("name", event.target.value)} className={fieldErrors.name ? "is-invalid" : ""} disabled={saving} autoFocus />{fieldErrors.name ? <span className="receptionists-field-error">{fieldErrors.name}</span> : null}</div>
              <div className="receptionists-field"><label htmlFor="lab-email">Email</label><input id="lab-email" type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} className={fieldErrors.email ? "is-invalid" : ""} disabled={saving} />{fieldErrors.email ? <span className="receptionists-field-error">{fieldErrors.email}</span> : null}</div>
              <div className="receptionists-field"><label htmlFor="lab-phone">Phone</label><input id="lab-phone" value={form.phone} onChange={(event) => updateField("phone", event.target.value)} inputMode="numeric" maxLength={10} className={fieldErrors.phone ? "is-invalid" : ""} disabled={saving} />{fieldErrors.phone ? <span className="receptionists-field-error">{fieldErrors.phone}</span> : null}</div>
              <div className="receptionists-field"><label htmlFor="lab-password">Password</label><input id="lab-password" type="password" value={form.password} onChange={(event) => updateField("password", event.target.value)} className={fieldErrors.password ? "is-invalid" : ""} disabled={saving} />{fieldErrors.password ? <span className="receptionists-field-error">{fieldErrors.password}</span> : null}</div>
              <div className="receptionists-field"><label htmlFor="lab-branch">Branch</label><select id="lab-branch" value={form.branchId} onChange={(event) => updateField("branchId", event.target.value)} className={fieldErrors.branchId ? "is-invalid" : ""} disabled={loadingBranches || saving}><option value="">{loadingBranches ? "Loading branches..." : "Select branch"}</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>{fieldErrors.branchId ? <span className="receptionists-field-error">{fieldErrors.branchId}</span> : null}</div>
              <div className="receptionists-field"><label htmlFor="lab-is-active">Is Active</label><select id="lab-is-active" value={form.isActive ? "Active" : "Inactive"} onChange={(event) => updateField("isActive", event.target.value === "Active")} disabled={saving}><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
              {fieldErrors.form ? <div className="receptionists-error receptionists-form-message">{fieldErrors.form}</div> : null}
              <div className="receptionists-modal-actions"><button type="button" className="receptionists-secondary-button" onClick={closeModal} disabled={saving}>Cancel</button><button type="submit" className="receptionists-save-button" disabled={saving || (editingTech ? !canEdit : !canCreate)}><CheckCircle size={16} />{saving ? "Saving..." : editingTech ? "Update Lab Technician" : "Create Lab Technician"}</button></div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default LabTechnicians;
