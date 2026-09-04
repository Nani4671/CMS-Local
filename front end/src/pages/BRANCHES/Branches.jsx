import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CheckCircle,
  Eye,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from "lucide-react";
import { ActionsGroup } from "../../components/ActionsGroup";
import "./Branches.css";
import { useToast } from "../../components/ToastProvider";
import { formatTitleCase } from "../../utils/format";
import {
  BRANCH_API_URL,
  branchBelongsToHospital,
  clearBranchCache,
  fetchBranchesForHospital,
  getApiHeaders,
  getBranchId,
  getBranchIsActive,
  getBranchName,
  getJsonHeaders,
  getStoredHospitalId,
  parseErrorMessage,
} from "../../utils/branchApi";
import {
  buildAddress,
  buildAddressPayload,
  emptyAddressParts,
  onlyPincodeValue,
  parseAddress,
  validateAddressParts,
} from "../../utils/address";
import { fetchPincodeLocation } from "../../utils/pincodeLocation";
import {
  onlyAddressText,
  onlyAlpha,
  onlyIndianMobileValue,
  validateGmail,
  validateMobile,
  validateRequired,
  validateText,
} from "../../utils/validation";
import { validateUniqueMobileNumber } from "../../utils/mobileUniqueness";
import {
  getDistrictsForState,
  INDIA_COUNTRY,
  INDIAN_STATES,
} from "../../utils/indianLocations";
import { getStoredClinicName } from "../../utils/clinicDisplay";
import { useAdminModulePermissions } from "../../utils/rolePermissions";
import { getClinicInvoiceBranding } from "../../utils/clinicBranding";

const getEmptyForm = (hospitalId = getStoredHospitalId()) => ({
  name: "",
  hospitalId: hospitalId ? String(hospitalId) : "",
  phone: "",
  email: "",
  address: "",
  city: "",
  district: "",
  state: "",
  country: INDIA_COUNTRY,
  postalCode: "",
  addressParts: emptyAddressParts,
});

const readBranchField = (branch, ...keys) => {
  for (const key of keys) {
    const value = branch?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
};

const getBranchForm = (branch, hospitalId) => {
  const parsedAddress = parseAddress(String(readBranchField(branch, "address", "Address") || ""));

  return {
    name: formatTitleCase(onlyAlpha(String(getBranchName(branch) || ""))),
    hospitalId: String(readBranchField(branch, "hospitalId", "HospitalId") || hospitalId || ""),
    phone: String(readBranchField(branch, "phone", "Phone") || ""),
    email: String(readBranchField(branch, "email", "Email") || ""),
    address: formatTitleCase(onlyAddressText(String(readBranchField(branch, "address", "Address") || ""))),
    city: formatTitleCase(onlyAlpha(String(readBranchField(branch, "city", "City") || parsedAddress.city || ""))),
    district: formatTitleCase(onlyAlpha(String(readBranchField(branch, "district", "District") || ""))),
    state: formatTitleCase(onlyAlpha(String(readBranchField(branch, "state", "State") || parsedAddress.state || ""))),
    country: formatTitleCase(onlyAlpha(String(readBranchField(branch, "country", "Country") || parsedAddress.country || "India"))),
    postalCode: String(readBranchField(branch, "postalCode", "PostalCode", "pincode") || parsedAddress.pincode || ""),
    addressParts: {
      ...emptyAddressParts,
      ...parsedAddress,
      country: formatTitleCase(onlyAlpha(String(readBranchField(branch, "country", "Country") || parsedAddress.country || "India"))),
      city: formatTitleCase(onlyAlpha(String(readBranchField(branch, "city", "City") || parsedAddress.city || ""))),
      state: formatTitleCase(onlyAlpha(String(readBranchField(branch, "state", "State") || parsedAddress.state || ""))),
    },
  };
};

const buildBranchPayload = (form) => {
  const addressPayload = buildAddressPayload(form.addressParts);

  return {
    name: formatTitleCase(onlyAlpha(form.name)).trim(),
    hospitalId: Number(form.hospitalId) || 0,
    phone: form.phone.trim(),
    email: form.email.trim(),
    address: formatTitleCase(onlyAddressText(form.address)).trim(),
    city: formatTitleCase(onlyAlpha(form.addressParts?.city || form.city)).trim(),
    district: formatTitleCase(onlyAlpha(form.addressParts?.city || form.district)).trim(),
    state: formatTitleCase(onlyAlpha(form.addressParts?.state || form.state)).trim(),
    country: formatTitleCase(onlyAlpha(form.addressParts?.country || form.country)).trim(),
    postalCode: String(form.addressParts?.pincode || addressPayload.postalCode || "").trim(),
    ...addressPayload,
  };
};

const formatBranchAddress = (branch) =>
  [
    readBranchField(branch, "address", "Address"),
    readBranchField(branch, "city", "City"),
    readBranchField(branch, "district", "District"),
    readBranchField(branch, "state", "State"),
    readBranchField(branch, "postalCode", "PostalCode"),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ") || "-";

function Branches() {
  const toast = useToast();
  const { canCreate, canEdit, canDelete } = useAdminModulePermissions("Branches");
  const hospitalId = getStoredHospitalId();
  const clinicName = getStoredClinicName() || localStorage.getItem("hospitalName") || "Clinic";
  const clinicBranding = getClinicInvoiceBranding({ clinicId: hospitalId, clinicName });

  const [branches, setBranches] = useState([]);
  const [activeActionState, setActiveActionState] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingBranchId, setDeletingBranchId] = useState(null);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const lastErrorToast = useRef("");

  const showError = (message) => {
    const nextMessage = String(message || "").trim();
    if (!nextMessage || lastErrorToast.current === nextMessage) return;
    lastErrorToast.current = nextMessage;
    setError(nextMessage);
    toast.error(nextMessage);
  };

  const clearMessages = () => {
    setError("");
    setSuccess("");
    lastErrorToast.current = "";
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState(null);
  const [form, setForm] = useState(getEmptyForm(hospitalId));
  const [fieldErrors, setFieldErrors] = useState({});
  const [areaOptions, setAreaOptions] = useState([]);

  const selectedDistricts = useMemo(
    () =>
      Array.from(
        new Set([
          ...getDistrictsForState(form.addressParts?.state),
          form.addressParts?.city,
        ].filter(Boolean))
      ),
    [form.addressParts?.city, form.addressParts?.state]
  );

  const visibleAreaOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [form.addressParts?.area, ...areaOptions]
            .filter(Boolean)
            .map((area) => String(area).trim())
        )
      ),
    [form.addressParts?.area, areaOptions]
  );

  const fetchBranches = async () => {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const data = await fetchBranchesForHospital(hospitalId, clinicName);
      setBranches(data.filter((branch) => branchBelongsToHospital(branch, hospitalId, clinicName)));
    } catch (fetchError) {
      const message = fetchError.message || "Unable to load branches.";
      setBranches([]);
      showError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    const addressParts = form.addressParts || emptyAddressParts;
    const nextAddress = buildAddress(addressParts);

    if (form.address !== nextAddress) {
      setForm((current) => ({
        ...current,
        address: nextAddress,
      }));
    }
  }, [form.addressParts]);

  useEffect(() => {
    const pincode = form.addressParts?.pincode || "";
    if (pincode.length !== 6) {
      setAreaOptions([]);
      return undefined;
    }

    let active = true;
    fetchPincodeLocation(pincode)
      .then((location) => {
        if (!active) return;

        setAreaOptions(location.areaOptions || []);
        setForm((current) => {
          const previousParts = current.addressParts || emptyAddressParts;
          if (previousParts.pincode !== pincode) return current;

          const addressParts = {
            ...previousParts,
            area: previousParts.area || location.area,
            city: location.city || previousParts.city,
            state: location.state || previousParts.state,
            country: location.country || previousParts.country,
            pincode,
          };

          return {
            ...current,
            addressParts,
            address: buildAddress(addressParts),
          };
        });

        setFieldErrors((current) => ({
          ...current,
          "address.pincode": "",
          "address.area": "",
          "address.city": "",
          "address.state": "",
        }));
      })
      .catch((lookupError) => {
        if (!active) return;
        setFieldErrors((current) => ({
          ...current,
          "address.pincode": lookupError.message || "Unable to resolve pincode.",
        }));
      });

    return () => {
      active = false;
    };
  }, [form.addressParts?.pincode]);

  const filteredBranches = useMemo(() => {
    const value = searchText.trim().toLowerCase();
    if (!value) return branches;

    return branches.filter((branch) =>
      [
        getBranchName(branch),
        readBranchField(branch, "phone", "Phone"),
        readBranchField(branch, "email", "Email"),
        readBranchField(branch, "city", "City"),
        readBranchField(branch, "district", "District"),
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(value))
    );
  }, [branches, searchText]);

  const openAddModal = () => {
    if (!canCreate) {
      showError("You do not have permission to create branches.");
      return;
    }
    setEditingBranch(null);
    setForm(getEmptyForm(hospitalId));
    setFieldErrors({});
    setError("");
    setSuccess("");
    setModalOpen(true);
  };

  const openEditModal = (branch) => {
    if (!canEdit) {
      showError("You do not have permission to edit branches.");
      return;
    }
    setEditingBranch(branch);
    setForm(getBranchForm(branch, hospitalId));
    setFieldErrors({});
    setError("");
    setSuccess("");
    setModalOpen(true);
  };

  const closeModal = ({ force = false } = {}) => {
    if (saving && !force) return;

    setModalOpen(false);
    setEditingBranch(null);
    setForm(getEmptyForm(hospitalId));
    setFieldErrors({});
  };

  const updateField = (name, value) => {
    let nextValue = value;

    if (name === "name") {
      nextValue = formatTitleCase(onlyAlpha(value));
    }

    if (["city", "district", "state", "country"].includes(name)) {
      nextValue = formatTitleCase(onlyAlpha(value));
    }

    if (name === "phone") {
      nextValue = onlyIndianMobileValue(value);
    }

    if (name === "postalCode") {
      nextValue = onlyPincodeValue(value);
    }

    setForm((previous) => {
      if (name === "country") {
        return {
          ...previous,
          country: nextValue,
          state: "",
          district: "",
          city: "",
        };
      }

      if (name === "state") {
        return {
          ...previous,
          state: nextValue,
          district: "",
          city: "",
        };
      }

      if (name === "district") {
        return {
          ...previous,
          district: nextValue,
          city: "",
        };
      }

      return { ...previous, [name]: nextValue };
    });

    setFieldErrors((previous) => ({
      ...previous,
      [name]: "",
      form: "",
    }));
    clearMessages();
  };

  const handleAddressChange = (name, value) => {
    let nextValue = value;

    if (name === "pincode") {
      nextValue = onlyPincodeValue(value);
    } else if (["city", "state", "country"].includes(name)) {
      nextValue = onlyAlpha(value).trim();
    } else {
      nextValue = onlyAddressText(value).trim();
    }

    setForm((current) => {
      const previousParts = current.addressParts || emptyAddressParts;
      const addressParts = {
        ...previousParts,
        [name]: nextValue,
        country: INDIA_COUNTRY,
      };

      if (name === "state" && previousParts.state !== nextValue) {
        addressParts.city = "";
        addressParts.area = "";
        addressParts.pincode = "";
      }

      if (name === "city" && previousParts.city !== nextValue) {
        addressParts.area = "";
        addressParts.pincode = "";
      }

      if (name === "pincode" && previousParts.pincode !== nextValue) {
        addressParts.area = "";
      }

      return {
        ...current,
        addressParts,
        address: buildAddress(addressParts),
      };
    });

    setFieldErrors((current) => ({
      ...current,
      address: "",
      [`address.${name}`]: "",
      ...(name === "state" ? { "address.city": "" } : {}),
      ...(name === "city" ? { "address.pincode": "", "address.area": "" } : {}),
    }));
    clearMessages();
  };

  const validateForm = () => {
    const addressParts = form.addressParts || emptyAddressParts;
    const nextErrors = {
      name: validateText(form.name, "Branch name"),
      hospitalId: validateRequired(form.hospitalId, "Hospital"),
      phone: validateMobile(form.phone, "Phone"),
      email: validateGmail(form.email, "Email", { strict: false }),
      ...Object.fromEntries(
        Object.entries(validateAddressParts(addressParts, "Address")).map(
          ([key, value]) => [key === "address" ? "address" : `address.${key}`, value]
        )
      ),
    };

    Object.keys(nextErrors).forEach((key) => {
      if (!nextErrors[key]) delete nextErrors[key];
    });

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validateForm()) {
      showError("Please fix the highlighted fields.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    const branchId = getBranchId(editingBranch);
    const isEditing = Boolean(branchId);
    if (isEditing ? !canEdit : !canCreate) {
      showError(`You do not have permission to ${isEditing ? "edit" : "create"} branches.`);
      return;
    }

    try {
      const duplicateMobileMessage = await validateUniqueMobileNumber(form.phone, {
        current: isEditing ? { id: branchId, source: "Branch" } : {},
        localRecords: branches,
        localSource: "Branch",
      });
      if (duplicateMobileMessage) {
        setFieldErrors((current) => ({ ...current, phone: duplicateMobileMessage }));
        showError(duplicateMobileMessage);
        setSaving(false);
        return;
      }

      const response = await fetch(
        isEditing ? `${BRANCH_API_URL}/${branchId}` : BRANCH_API_URL,
        {
          method: isEditing ? "PUT" : "POST",
          headers: getJsonHeaders(),
          body: JSON.stringify(buildBranchPayload(form)),
        }
      );

      if (!response.ok) {
        throw new Error(
          await parseErrorMessage(
            response,
            isEditing ? "Unable to update branch." : "Unable to create branch."
          )
        );
      }

      const data = await response.json().catch(() => ({}));
      const message =
        data?.message ||
        (isEditing ? "Branch updated successfully" : "Branch created successfully");
      setSuccess(message);
      toast.success(message);
      clearBranchCache(hospitalId);
      await fetchBranches();
      closeModal({ force: true });
    } catch (submitError) {
      const message = submitError.message || "Unable to save branch.";
      showError(message);
    } finally {
      setSaving(false);
    }
  };

  const toggleBranchStatus = async (branch) => {
    if (!canEdit) {
      showError("You do not have permission to edit branches.");
      return;
    }
    const branchId = getBranchId(branch);
    if (!branchId || updatingStatusId) return;

    const nextIsActive = !getBranchIsActive(branch);
    setUpdatingStatusId(branchId);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`${BRANCH_API_URL}/${branchId}/status`, {
        method: "PATCH",
        headers: getApiHeaders(),
      });

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, "Unable to update branch status."));
      }

      clearBranchCache(hospitalId);
      setBranches((previous) =>
        previous.map((item) =>
          String(getBranchId(item)) === String(branchId)
            ? {
                ...item,
                isActive: nextIsActive,
                status: nextIsActive ? "Active" : "Inactive",
              }
            : item
        )
      );
      const message = nextIsActive
        ? "Branch activated successfully"
        : "Branch disabled successfully";
      setSuccess(message);
      toast.success(message);
    } catch (statusError) {
      const message = statusError.message || "Unable to update branch status.";
      showError(message);
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleDeleteBranch = async (branch) => {
    if (!canDelete) {
      showError("You do not have permission to delete branches.");
      return;
    }
    const branchId = getBranchId(branch);
    if (!branchId || saving || deletingBranchId || updatingStatusId) return;

    const shouldDelete = window.confirm(
      `Delete branch ${getBranchName(branch) || ""}?`
    );
    if (!shouldDelete) return;

    setDeletingBranchId(branchId);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`${BRANCH_API_URL}/${branchId}`, {
        method: "DELETE",
        headers: getApiHeaders(),
      });

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, "Unable to delete branch."));
      }

      clearBranchCache(hospitalId);
      setBranches((previous) =>
        previous.filter((item) => String(getBranchId(item)) !== String(branchId))
      );
      const message = "Branch deleted successfully";
      setSuccess(message);
      toast.success(message);
    } catch (deleteError) {
      const message = deleteError.message || "Unable to delete branch.";
      showError(message);
    } finally {
      setDeletingBranchId(null);
    }
  };

  return (
    <div className="branches-page">
      <div className="branches-header">
        <div>
          <h2>Branches</h2>
          <p>
            {loading
              ? "Loading branches..."
              : `${filteredBranches.length} branch records for ${clinicName}`}
          </p>
        </div>

        <div className="branches-header-actions">
          <button
            type="button"
            className="branches-icon-button"
            onClick={fetchBranches}
            disabled={loading || saving}
            title="Refresh branches"
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            className="branches-primary-button"
            onClick={openAddModal}
            disabled={saving || !canCreate}
            title="Add branch"
          >
            <Plus size={16} />
            Add Branch
          </button>
        </div>
      </div>

      <div className="branches-clinic-band">
        <span className="branches-clinic-logo branches-clinic-logo--emerald">
          <img src={clinicBranding.logoUrl} alt="" />
        </span>
        <span>Clinic Name</span>
        <b>{clinicName}</b>
      </div>

      <div className="branches-toolbar">
        <div className="branches-search">
          <Search size={16} />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search branch, city, email, phone..."
          />
        </div>
      </div>

      {success ? <div className="branches-success">{success}</div> : null}
      {error ? <div className="branches-error">{error}</div> : null}

      <div className="branches-table">
        <div className="branches-thead">
          <span>S.No.</span>
          <span>Branch</span>
          <span>Contact</span>
          <span>Location</span>
          <span>Status</span>
          <span className="branches-actions-heading">Actions</span>
        </div>

        {!loading && filteredBranches.length === 0 ? (
          <div className="branches-empty">No branches found.</div>
        ) : null}

        {filteredBranches.map((branch, index) => {
          const branchId = getBranchId(branch);
          const isActive = getBranchIsActive(branch);
          const isUpdating = String(updatingStatusId) === String(branchId);
          const isDeleting = String(deletingBranchId) === String(branchId);

          return (
            <div className="branches-row" key={branchId || `${getBranchName(branch)}-${index}`}>
              <span>{index + 1}</span>
              <div className="branches-name-cell">
                <div className="branches-avatar">
                  <MapPin size={17} />
                </div>
                <div>
                  <b>{getBranchName(branch) || "-"}</b>
                  <span>ID: {branchId || "-"}</span>
                </div>
              </div>
              <div className="branches-cell">
                <b>{readBranchField(branch, "phone", "Phone") || "-"}</b>
                <span>{readBranchField(branch, "email", "Email") || "-"}</span>
              </div>
              <span className="branches-cell">{formatBranchAddress(branch)}</span>
              <span className="branches-cell">
                <span
                  className={`branches-status ${
                    isActive ? "branches-status-active" : "branches-status-inactive"
                  }`}
                >
                  {isUpdating ? "Updating..." : isActive ? "Active" : "Inactive"}
                </span>
              </span>
              <div className="branches-actions">
                <ActionsGroup
                  rowId={branchId}
                  activeActionState={activeActionState}
                  setActiveActionState={setActiveActionState}
                  canView={true}
                  canEdit={canEdit}
                  canStatus={canEdit}
                  canDelete={canDelete}
                  statusChecked={isActive}
                  statusDisabled={saving || isUpdating || isDeleting}
                  statusTitle={isActive ? "Disable branch" : "Activate branch"}
                  onView={() => window.alert(`Branch: ${getBranchName(branch) || "-"}\nID: ${branchId || "-"}\nPhone: ${readBranchField(branch, "phone", "Phone") || "-"}\nEmail: ${readBranchField(branch, "email", "Email") || "-"}\nLocation: ${formatBranchAddress(branch) || "-"}\nStatus: ${isActive ? "Active" : "Inactive"}`)}
                  onEdit={() => openEditModal(branch)}
                  onStatus={() => toggleBranchStatus(branch)}
                  onDelete={() => handleDeleteBranch(branch)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen ? (
        <div className="branches-modal-overlay" onClick={() => closeModal()}>
          <div className="branches-modal" onClick={(event) => event.stopPropagation()}>
            <div className="branches-modal-header">
              <div className="branches-modal-title">
                <div className="branches-modal-icon">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3>{editingBranch ? "Edit Branch" : "Add Branch"}</h3>
                  <p>{clinicName}</p>
                </div>
              </div>
              <button
                type="button"
                className="branches-modal-close"
                onClick={() => closeModal()}
                disabled={saving}
                aria-label="Close branch form"
              >
                <X size={20} />
              </button>
            </div>

            <form className="branches-form" onSubmit={handleSubmit} noValidate>
              <div className="branches-field">
                <label htmlFor="branch-name">Branch Name</label>
                <input
                  id="branch-name"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  className={fieldErrors.name ? "is-invalid" : ""}
                  disabled={saving}
                  autoFocus
                />
                {fieldErrors.name ? (
                  <span className="branches-field-error">{fieldErrors.name}</span>
                ) : null}
              </div>

              <div className="branches-field">
                <label htmlFor="branch-clinic">Clinic Name</label>
                <input
                  id="branch-clinic"
                  value={clinicName}
                  className={fieldErrors.hospitalId ? "is-invalid" : ""}
                  disabled={saving}
                  readOnly
                />
                <input type="hidden" value={form.hospitalId} readOnly />
                {fieldErrors.hospitalId ? (
                  <span className="branches-field-error">{fieldErrors.hospitalId}</span>
                ) : null}
              </div>

              <div className="branches-field">
                <label htmlFor="branch-phone">Phone</label>
                <input
                  id="branch-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  className={fieldErrors.phone ? "is-invalid" : ""}
                  disabled={saving}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit Indian mobile number"
                />
                {fieldErrors.phone ? (
                  <span className="branches-field-error">{fieldErrors.phone}</span>
                ) : null}
              </div>

              <div className="branches-field">
                <label htmlFor="branch-email">Email</label>
                <input
                  id="branch-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  className={fieldErrors.email ? "is-invalid" : ""}
                  disabled={saving}
                />
                {fieldErrors.email ? (
                  <span className="branches-field-error">{fieldErrors.email}</span>
                ) : null}
              </div>

              <div className="branches-field branches-field-full">
                <label>Address</label>
                <div className="branches-form-grid">
                  <div className="branches-field">
                    <label>Pincode</label>
                    <input
                      id="branch-postal"
                      value={form.addressParts?.pincode || ""}
                      onChange={(event) => handleAddressChange("pincode", event.target.value)}
                      className={fieldErrors["address.pincode"] ? "is-invalid" : ""}
                      disabled={saving}
                      inputMode="numeric"
                      maxLength={6}
                    />
                    {fieldErrors["address.pincode"] ? (
                      <span className="branches-field-error">{fieldErrors["address.pincode"]}</span>
                    ) : null}
                  </div>

                  <div className="branches-field">
                    <label>Street/Village Name</label>
                    <input
                      value={form.addressParts?.streetVillage || ""}
                      onChange={(event) => handleAddressChange("streetVillage", event.target.value)}
                      className={fieldErrors["address.streetVillage"] ? "is-invalid" : ""}
                      disabled={saving}
                      autoComplete="off"
                    />
                    {fieldErrors["address.streetVillage"] ? (
                      <span className="branches-field-error">{fieldErrors["address.streetVillage"]}</span>
                    ) : null}
                  </div>

                  <div className="branches-field">
                    <label>Area</label>
                    <select
                      value={form.addressParts?.area || ""}
                      onChange={(event) => handleAddressChange("area", event.target.value)}
                      className={fieldErrors["address.area"] ? "is-invalid" : ""}
                      disabled={saving || !visibleAreaOptions.length}
                    >
                      <option value="">Select Area</option>
                      {visibleAreaOptions.map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                    {fieldErrors["address.area"] ? (
                      <span className="branches-field-error">{fieldErrors["address.area"]}</span>
                    ) : null}
                  </div>

                  <div className="branches-field">
                    <label>City/District</label>
                    <select
                      value={form.addressParts?.city || ""}
                      onChange={(event) => handleAddressChange("city", event.target.value)}
                      className={fieldErrors["address.city"] ? "is-invalid" : ""}
                      disabled={saving || !form.addressParts?.state}
                    >
                      <option value="">Select City/District</option>
                      {selectedDistricts.map((district) => (
                        <option key={district} value={district}>
                          {district}
                        </option>
                      ))}
                    </select>
                    {fieldErrors["address.city"] ? (
                      <span className="branches-field-error">{fieldErrors["address.city"]}</span>
                    ) : null}
                  </div>

                  <div className="branches-field">
                    <label>State</label>
                    <select
                      value={form.addressParts?.state || ""}
                      onChange={(event) => handleAddressChange("state", event.target.value)}
                      className={fieldErrors["address.state"] ? "is-invalid" : ""}
                      disabled={saving}
                    >
                      <option value="">Select State</option>
                      {INDIAN_STATES.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                    {fieldErrors["address.state"] ? (
                      <span className="branches-field-error">{fieldErrors["address.state"]}</span>
                    ) : null}
                  </div>

                  <div className="branches-field">
                    <label>Country</label>
                    <input value={INDIA_COUNTRY} disabled readOnly />
                    {fieldErrors["address.country"] ? (
                      <span className="branches-field-error">{fieldErrors["address.country"]}</span>
                    ) : null}
                  </div>

                  <div className="branches-field branches-field-full">
                    <label>Final Address</label>
                    <textarea value={buildAddress(form.addressParts)} readOnly />
                  </div>
                </div>
                {fieldErrors.address ? (
                  <span className="branches-field-error">{fieldErrors.address}</span>
                ) : null}
              </div>

              {fieldErrors.form ? (
                <div className="branches-error branches-form-message">
                  {fieldErrors.form}
                </div>
              ) : null}

              <div className="branches-modal-actions">
                <button
                  type="button"
                  className="branches-secondary-button"
                  onClick={() => closeModal()}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="branches-save-button" disabled={saving || (editingBranch ? !canEdit : !canCreate)}>
                  <CheckCircle size={16} />
                  {saving ? "Saving..." : editingBranch ? "Update Branch" : "Create Branch"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Branches;
