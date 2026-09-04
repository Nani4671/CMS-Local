import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CheckCircle,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  ToggleLeft,
  ToggleRight,
  UserCheck,
  X,
} from "lucide-react";
import { ActionsGroup } from "../../components/ActionsGroup";
import "./Receptionists.css";
import AuthImage, { resolveApiImageUrl } from "../../utils/AuthImage";
import { apiUrl } from "../../config/api";
import { useToast } from "../../components/ToastProvider";
import {
  buildBranchOptions,
  fetchBranchesForHospital,
  recordBelongsToClinicScope,
} from "../../utils/branchApi";
import { formatTitleCase } from "../../utils/format";
import {
  onlyAlpha,
  onlyIndianMobileValue,
  validateAlpha,
  validateGmail,
  validateImageFile,
  validateMobile,
} from "../../utils/validation";
import {
  getClinicDisplayName,
  getStoredClinicName,
} from "../../utils/clinicDisplay";
import { validateUniqueMobileNumber } from "../../utils/mobileUniqueness";
import { useAdminModulePermissions } from "../../utils/rolePermissions";
const RECEPTIONIST_API = apiUrl("Receptionist");
const REQUEST_TIMEOUT_MS = 3500;

const getAuthToken = () =>
  localStorage.getItem("adminToken") || localStorage.getItem("token");

const fetchWithTimeout = (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeoutId));
};

const decodeJwtPayload = (token) => {
  try {
    const payload = token?.split(".")?.[1];
    if (!payload || typeof atob !== "function") return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(normalized + padding));
  } catch {
    return null;
  }
};

const getHospitalId = () => {
  const storedHospitalId = localStorage.getItem("hospitalId");
  if (storedHospitalId) return Number(storedHospitalId);

  const claims = decodeJwtPayload(getAuthToken());
  return Number(claims?.HospitalId || claims?.hospitalId || 0);
};

const getEmptyForm = () => ({
  name: "",
  email: "",
  phone: "",
  branchId: "",
});

const getReceptionistImageUrl = (receptionist = {}) => {
  const candidates = [
    receptionist.imageUrl,
    receptionist.image,
    receptionist.Image,
    receptionist.profileImage,
    receptionist.profileImageUrl,
    receptionist.imagePath,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim();
    if (value && value.toLowerCase() !== "string") return value;
  }

  return "";
};

const parseReceptionistsResponse = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

const getReceptionistBranchId = (receptionist = {}) =>
  receptionist.branchId ??
  receptionist.BranchId ??
  receptionist.branchID ??
  receptionist.BranchID ??
  receptionist.branch?.id ??
  receptionist.branch?.branchId ??
  "";

const getReceptionistBranchName = (receptionist = {}, branchNameById = {}) =>
  receptionist.branchName ??
  receptionist.BranchName ??
  receptionist.branch?.name ??
  receptionist.branch?.branchName ??
  branchNameById[String(getReceptionistBranchId(receptionist) || "")] ??
  "";

const formatDate = (value) => {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const getValidationMessages = (data) => {
  if (!data?.errors || typeof data.errors !== "object") return [];

  return Object.entries(data.errors)
    .flatMap(([key, messages]) => {
      const list = Array.isArray(messages) ? messages : [messages];
      return list.filter(Boolean).map((message) => `${key}: ${message}`);
    })
    .filter(Boolean);
};

const parseErrorMessage = async (response, fallback) => {
  try {
    const text = await response.text();
    if (!text) return fallback;

    try {
      const data = JSON.parse(text);
      return (
        data?.message ||
        getValidationMessages(data).join(" ") ||
        data?.title ||
        text
      );
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
};

const buildReceptionistFormData = (payload, { imageFile, removeImage }) => {
  const body = new FormData();
  body.append("Name", payload.name);
  body.append("Email", payload.email);
  body.append("Phone", payload.phone);
  body.append("PhoneNumber", payload.phone);
  body.append("HospitalId", String(payload.hospitalId));
  body.append("BranchId", String(payload.branchId));

  if (imageFile) {
    body.append("Image", imageFile);
  }

  if (removeImage) {
    body.append("RemoveImage", "true");
    body.append("RemoveProfileImage", "true");
    body.append("ImageUrl", "");
  }

  return body;
};

const buildReceptionistJson = (payload, { removeImage } = {}) => ({
  name: payload.name,
  Name: payload.name,
  email: payload.email,
  Email: payload.email,
  phone: payload.phone,
  Phone: payload.phone,
  phoneNumber: payload.phone,
  PhoneNumber: payload.phone,
  hospitalId: payload.hospitalId,
  HospitalId: payload.hospitalId,
  branchId: payload.branchId,
  BranchId: payload.branchId,
  ...(removeImage
    ? {
        imageUrl: "",
        ImageUrl: "",
        removeImage: true,
        RemoveImage: true,
        removeProfileImage: true,
        RemoveProfileImage: true,
      }
    : {}),
});

const submitReceptionistRequest = async ({
  url,
  method,
  payload,
  token,
  imageFile,
  removeImage,
  fallbackMessage,
}) => {
  const hasImageChange = Boolean(imageFile || removeImage);
  const commonHeaders = {
    "ngrok-skip-browser-warning": "true",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const jsonRequest = () =>
    fetch(url, {
      method,
      headers: {
        ...commonHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildReceptionistJson(payload, { removeImage })),
    });

  const formRequest = () =>
    fetch(url, {
      method,
      headers: commonHeaders,
      body: buildReceptionistFormData(payload, { imageFile, removeImage }),
    });

  let response = hasImageChange ? await formRequest() : await jsonRequest();

  if (response.status === 415) {
    response = hasImageChange ? await jsonRequest() : await formRequest();
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, fallbackMessage));
  }

  return response.json().catch(() => ({}));
};

function Receptionists() {
  const toast = useToast();
  const { canCreate, canEdit, canDelete } = useAdminModulePermissions("Receptionists");
  const imageInputRef = useRef(null);
  const [receptionists, setReceptionists] = useState([]);
  const [activeActionState, setActiveActionState] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingReceptionist, setEditingReceptionist] = useState(null);
  const [form, setForm] = useState(getEmptyForm());
  const [fieldErrors, setFieldErrors] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const [branchOptions, setBranchOptions] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);

  useEffect(() => {
    return () => {
      if (imagePreview.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  // Keep the page-level success banner in sync with the transient toast.
  // Without this, a status-change confirmation remains until another action
  // clears the component state.
  useEffect(() => {
    if (!success) return undefined;

    const timeoutId = window.setTimeout(() => setSuccess(""), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [success]);

  const hospitalId = getHospitalId();
  const clinicDisplayName =
    getStoredClinicName() || getClinicDisplayName({ hospitalId }, "Clinic");
  const branchNameById = useMemo(
    () =>
      branchOptions.reduce((lookup, branch) => {
        lookup[String(branch.id)] = branch.name;
        return lookup;
      }, {}),
    [branchOptions]
  );
  const scopedBranchIds = useMemo(
    () => branchOptions.map((branch) => branch.id),
    [branchOptions]
  );

  const filteredReceptionists = useMemo(() => {
    const scopedReceptionists = receptionists.filter((item) =>
      recordBelongsToClinicScope(item, {
        hospitalId,
        clinicName: clinicDisplayName,
        branchIds: scopedBranchIds,
      })
    );
    const value = searchText.trim().toLowerCase();
    if (!value) return scopedReceptionists;

    return scopedReceptionists.filter((item) =>
      [item.name, item.email, item.phone, getReceptionistBranchName(item, branchNameById)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(value))
    );
  }, [branchNameById, receptionists, searchText, hospitalId, clinicDisplayName, scopedBranchIds]);

  const fetchReceptionists = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetchWithTimeout(RECEPTIONIST_API, {
        headers: {
          "ngrok-skip-browser-warning": "true",
        },
      });

      if (!response.ok) {
        throw new Error(
          await parseErrorMessage(response, "Unable to load receptionists.")
        );
      }

      const data = await response.json();
      setReceptionists(parseReceptionistsResponse(data));
    } catch (fetchError) {
      setError(fetchError.message || "Unable to load receptionists.");
      setReceptionists([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReceptionists();
  }, []);

  useEffect(() => {
    let active = true;

    const loadBranches = async () => {
      setLoadingBranches(true);

      try {
        const branches = await fetchBranchesForHospital(hospitalId, clinicDisplayName);
        if (!active) return;

        const options = buildBranchOptions(branches);
        const activeOptions = options.filter((branch) => branch.isActive);
        setBranchOptions(options);

        if (activeOptions.length === 1) {
          setForm((previous) => ({
            ...previous,
            branchId: previous.branchId || activeOptions[0].id,
          }));
        }
      } catch {
        if (active) {
          setBranchOptions([]);
        }
      } finally {
        if (active) setLoadingBranches(false);
      }
    };

    loadBranches();

    return () => {
      active = false;
    };
  }, [hospitalId, clinicDisplayName]);

  const openAddModal = () => {
    if (!canCreate) {
      toast.error("You do not have permission to create receptionists.");
      return;
    }
    if (imagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreview);
    }
    setEditingReceptionist(null);
    setForm(getEmptyForm());
    setImageFile(null);
    setImagePreview("");
    setRemoveImage(false);
    setFieldErrors({});
    setError("");
    setSuccess("");
    setModalOpen(true);
  };

  const openEditModal = (receptionist) => {
    if (!canEdit) {
      toast.error("You do not have permission to edit receptionists.");
      return;
    }
    if (imagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreview);
    }
    setEditingReceptionist(receptionist);
    setForm({
      name: receptionist.name || "",
      email: receptionist.email || "",
      phone: receptionist.phone || "",
      branchId: getReceptionistBranchId(receptionist) || "",
    });
    setImageFile(null);
    setImagePreview(resolveApiImageUrl(getReceptionistImageUrl(receptionist)));
    setRemoveImage(false);
    setFieldErrors({});
    setError("");
    setSuccess("");
    setModalOpen(true);
  };

  const closeModal = ({ force = false } = {}) => {
    if (saving && !force) return;

    setModalOpen(false);
    setEditingReceptionist(null);
    setForm(getEmptyForm());
    setImageFile(null);
    setImagePreview("");
    setRemoveImage(false);
    setFieldErrors({});
  };

  const handleImageChange = (event) => {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;

    const imageError = validateImageFile(nextFile, "Profile image");
    if (imageError) {
      setFieldErrors((previous) => ({ ...previous, image: imageError }));
      toast.error(imageError);
      return;
    }

    if (imagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreview);
    }

    setImageFile(nextFile);
    setImagePreview(URL.createObjectURL(nextFile));
    setRemoveImage(false);
    setFieldErrors((previous) => ({ ...previous, image: "", form: "" }));
  };

  const handleRemoveImage = () => {
    if (imagePreview.startsWith("blob:")) {
      URL.revokeObjectURL(imagePreview);
    }

    setImageFile(null);
    setImagePreview("");
    setRemoveImage(true);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
    setFieldErrors((previous) => ({ ...previous, image: "", form: "" }));
  };

  const updateField = (name, value) => {
    let nextValue = value;

    if (name === "name") {
      nextValue = formatTitleCase(onlyAlpha(value));
    }

    if (name === "phone") {
      nextValue = onlyIndianMobileValue(value);
    }

    setForm((previous) => ({
      ...previous,
      [name]: nextValue,
    }));

    setFieldErrors((previous) => ({
      ...previous,
      [name]: "",
    }));
    setError("");
    setSuccess("");
  };

  const validateForm = () => {
    const nextErrors = {};

    nextErrors.name = validateAlpha(form.name, "Name");
    nextErrors.email = validateGmail(form.email);
    nextErrors.phone = validateMobile(form.phone, "Phone");
    if (!form.branchId) {
      nextErrors.branchId = "Select a branch.";
    }

    if (!hospitalId) {
      nextErrors.form = "Clinic not found. Please login again.";
    }

    if (imageFile) {
      nextErrors.image = validateImageFile(imageFile, "Profile image");
    }

    Object.keys(nextErrors).forEach((key) => {
      if (!nextErrors[key]) delete nextErrors[key];
    });

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const isEditing = Boolean(editingReceptionist?.id);
    if (isEditing ? !canEdit : !canCreate) {
      toast.error(`You do not have permission to ${isEditing ? "edit" : "create"} receptionists.`);
      return;
    }

    if (!validateForm()) {
      setError("Please fix the highlighted fields.");
      toast.error("Please fix the highlighted fields.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    const payload = {
      name: formatTitleCase(form.name).trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      hospitalId: Number(hospitalId),
      branchId: Number(form.branchId) || 0,
    };

    try {
      const duplicateMobileMessage = await validateUniqueMobileNumber(payload.phone, {
        current: isEditing ? { id: editingReceptionist.id, source: "Receptionist" } : {},
        localRecords: receptionists,
        localSource: "Receptionist",
      });
      if (duplicateMobileMessage) {
        setFieldErrors((previous) => ({ ...previous, phone: duplicateMobileMessage }));
        setError(duplicateMobileMessage);
        toast.error(duplicateMobileMessage);
        setSaving(false);
        return;
      }
      const token = getAuthToken();
      const data = await submitReceptionistRequest({
        url: isEditing
          ? `${RECEPTIONIST_API}/${editingReceptionist.id}`
          : RECEPTIONIST_API,
        method: isEditing ? "PUT" : "POST",
        payload,
        token,
        imageFile,
        removeImage,
        fallbackMessage: isEditing
          ? "Unable to update receptionist."
          : "Unable to create receptionist.",
      });
      const message =
        data?.message ||
        (isEditing
          ? "Receptionist updated successfully"
          : "Receptionist created successfully");
      setSuccess(message);
      toast.success(message);
      await fetchReceptionists();
      closeModal({ force: true });
    } catch (submitError) {
      const message = submitError.message || "Unable to save receptionist.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const toggleReceptionistStatus = async (receptionist) => {
    if (!canEdit) {
      toast.error("You do not have permission to edit receptionists.");
      return;
    }
    if (!receptionist?.id || deletingId) return;

    const nextStatus = receptionist.isActive ? "Inactive" : "Active";
    setDeletingId(receptionist.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`${RECEPTIONIST_API}/${receptionist.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({
          ...receptionist,
          isActive: nextStatus === "Active",
          status: nextStatus,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await parseErrorMessage(response, "Unable to update receptionist status.")
        );
      }

      setReceptionists((previous) =>
        previous.map((item) =>
          String(item.id) === String(receptionist.id)
            ? { ...item, isActive: nextStatus === "Active" }
            : item
        )
      );
      setSuccess(
        nextStatus === "Active"
          ? "Receptionist activated successfully"
          : "Receptionist deactivated successfully"
      );
      toast.success(
        nextStatus === "Active"
          ? "Receptionist activated successfully"
          : "Receptionist deactivated successfully"
      );
    } catch (toggleError) {
      const message =
        toggleError.message || "Unable to update receptionist status.";
      setError(message);
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDelete = async (receptionist) => {
    if (!canDelete) {
      toast.error("You do not have permission to delete receptionists.");
      return;
    }
    if (!receptionist?.id || deletingId) return;

    const shouldDelete = window.confirm(
      `Delete receptionist ${receptionist.name || ""}?`
    );
    if (!shouldDelete) return;

    setDeletingId(receptionist.id);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`${RECEPTIONIST_API}/${receptionist.id}`, {
        method: "DELETE",
        headers: {
          "ngrok-skip-browser-warning": "true",
        },
      });

      if (!response.ok) {
        throw new Error(
          await parseErrorMessage(response, "Unable to delete receptionist.")
        );
      }

      setReceptionists((previous) =>
        previous.filter((item) => item.id !== receptionist.id)
      );
      setSuccess("Receptionist deleted successfully");
      toast.success("Receptionist deleted successfully");
    } catch (deleteError) {
      const message =
        deleteError.message || "Unable to delete receptionist.";
      setError(message);
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="receptionists-page">
      <div className="receptionists-header">
        <div>
          <h2>Receptionists</h2>
          <p>
            {loading
              ? "Loading receptionists..."
              : `${filteredReceptionists.length} receptionist records`}
          </p>
        </div>

        <div className="receptionists-header-actions">
          <button
            type="button"
            className="receptionists-icon-button"
            onClick={fetchReceptionists}
            disabled={loading || saving}
            title="Refresh receptionist list"
          >
            <RefreshCw size={16} />
          </button>

          <button
            type="button"
            className="receptionists-primary-button"
            onClick={openAddModal}
            disabled={!canCreate}
            title="Add receptionist"
          >
            <Plus size={16} />
            Add Receptionist
          </button>
        </div>
      </div>

      <div className="receptionists-toolbar">
        <div className="receptionists-search">
          <Search size={16} />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search name, email, phone..."
          />
        </div>
      </div>

      {success ? (
        <div className="receptionists-success" role="status">
          <span>{success}</span>
          <button
            type="button"
            className="receptionists-notification-close"
            aria-label="Dismiss success notification"
            onClick={() => setSuccess("")}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
      {error ? <div className="receptionists-error">{error}</div> : null}

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

        {!loading && filteredReceptionists.length === 0 ? (
          <div className="receptionists-empty">No receptionists found.</div>
        ) : null}

        {filteredReceptionists.map((receptionist, index) => {
          const initials =
            (receptionist.name || "R")
              .split(" ")
              .filter(Boolean)
              .map((part) => part[0])
              .join("")
              .slice(0, 2)
              .toUpperCase() || "R";
          const isDeleting = deletingId === receptionist.id;
          const isActive = receptionist.isActive !== false;

          return (
            <div className="receptionists-row" key={receptionist.id}>
              <span>{index + 1}</span>
              <div className="receptionists-name-cell">
                <div className="receptionists-avatar">
                  <AuthImage
                    src={getReceptionistImageUrl(receptionist)}
                    alt={receptionist.name || "Receptionist"}
                    fallback={<span>{initials}</span>}
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: "50%",
                      objectFit: "cover",
                      display: "flex",
                    }}
                  />
                </div>
                <div>
                  <b>{receptionist.name || "-"}</b>
                </div>
              </div>

              <span className="receptionists-cell">{getReceptionistBranchName(receptionist, branchNameById) || "-"}</span>
              <span className="receptionists-cell receptionists-email">{receptionist.email || "-"}</span>
              <span className="receptionists-cell">{receptionist.phone || "-"}</span>

              <span className="receptionists-cell receptionists-status-cell">
                <span
                  className={`receptionists-status ${isActive
                      ? "receptionists-status-active"
                      : "receptionists-status-inactive"
                    }`}
                >
                  {isActive ? "Active" : "Inactive"}
                </span>
              </span>

              <div className="receptionists-actions">
                <ActionsGroup
                  rowId={receptionist.id}
                  activeActionState={activeActionState}
                  setActiveActionState={setActiveActionState}
                  canView={true}
                  canEdit={canEdit}
                  canStatus={canEdit}
                  canDelete={canDelete}
                  statusChecked={isActive}
                  statusDisabled={isDeleting}
                  statusTitle={isActive ? "Deactivate receptionist" : "Activate receptionist"}
                  onView={() => window.alert(`Receptionist: ${receptionist.name || "-"}\nBranch: ${getReceptionistBranchName(receptionist, branchNameById) || "-"}\nEmail: ${receptionist.email || "-"}\nPhone: ${receptionist.phone || "-"}\nStatus: ${isActive ? "Active" : "Inactive"}`)}
                  onEdit={() => openEditModal(receptionist)}
                  onStatus={() => toggleReceptionistStatus(receptionist)}
                  onDelete={() => handleDelete(receptionist)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen ? (
        <div className="receptionists-modal-overlay" onClick={closeModal}>
          <div
            className="receptionists-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="receptionists-modal-header">
              <div className="receptionists-modal-title">
                <div className="receptionists-modal-icon">
                  <UserCheck size={20} />
                </div>
                <div>
                  <h3>
                    {editingReceptionist ? "Edit Receptionist" : "Add Receptionist"}
                  </h3>
                  <p>{clinicDisplayName}</p>
                </div>
              </div>

              <button
                type="button"
                className="receptionists-modal-close"
                onClick={closeModal}
                disabled={saving}
                aria-label="Close receptionist form"
              >
                <X size={20} />
              </button>
            </div>

            <form className="receptionists-form" onSubmit={handleSubmit} noValidate>
              <div className="receptionists-image-upload">
                <div className="receptionists-image-circle">
                  {imagePreview ? (
                    <AuthImage
                      src={imagePreview}
                      alt="Receptionist profile preview"
                      fallback={<span>{(form.name || "R").slice(0, 1).toUpperCase()}</span>}
                      className="receptionists-image-preview"
                      style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: "50%",
                        objectFit: "cover",
                        display: "flex",
                      }}
                    />
                  ) : (
                    <span>{(form.name || "R").slice(0, 1).toUpperCase()}</span>
                  )}
                  <button
                    type="button"
                    className="receptionists-image-button"
                    onClick={() => imageInputRef.current?.click()}
                    title="Upload profile picture"
                    aria-label="Upload profile picture"
                    disabled={saving}
                  >
                    <Camera size={17} />
                  </button>
                  {imagePreview ? (
                    <button
                      type="button"
                      className="receptionists-image-remove"
                      onClick={handleRemoveImage}
                      title="Remove profile picture"
                      aria-label="Remove profile picture"
                      disabled={saving}
                    >
                      <X size={15} />
                    </button>
                  ) : null}
                  <input
                    ref={imageInputRef}
                    type="file"
                    className="receptionists-image-input"
                    accept="image/*"
                    onChange={handleImageChange}
                  />
                </div>
                {fieldErrors.image ? (
                  <span className="receptionists-field-error">{fieldErrors.image}</span>
                ) : null}
              </div>

              <div className="receptionists-field">
                <label htmlFor="receptionist-name">Name</label>
                <input
                  id="receptionist-name"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  className={fieldErrors.name ? "is-invalid" : ""}
                  disabled={saving}
                  autoFocus
                />
                {fieldErrors.name ? (
                  <span className="receptionists-field-error">
                    {fieldErrors.name}
                  </span>
                ) : null}
              </div>

              <div className="receptionists-field">
                <label htmlFor="receptionist-email">Email</label>
                <input
                  id="receptionist-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  className={fieldErrors.email ? "is-invalid" : ""}
                  disabled={saving}
                />
                {fieldErrors.email ? (
                  <span className="receptionists-field-error">
                    {fieldErrors.email}
                  </span>
                ) : null}
              </div>

              <div className="receptionists-field">
                <label htmlFor="receptionist-phone">Phone</label>
                <input
                  id="receptionist-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  inputMode="numeric"
                  pattern="^(?!([0-9])\\1{9})[6-9][0-9]{9}$"
                  maxLength={10}
                  placeholder="10-digit Indian mobile number"
                  title="Enter a 10-digit Indian mobile number starting with 6-9 and not all identical digits"
                  className={fieldErrors.phone ? "is-invalid" : ""}
                  disabled={saving}
                />
                {fieldErrors.phone ? (
                  <span className="receptionists-field-error">
                    {fieldErrors.phone}
                  </span>
                ) : null}
              </div>

              <div className="receptionists-field">
                <label htmlFor="receptionist-branch">Branch</label>
                <select
                  id="receptionist-branch"
                  value={form.branchId}
                  onChange={(event) => updateField("branchId", event.target.value)}
                  className={fieldErrors.branchId ? "is-invalid" : ""}
                  disabled={loadingBranches || saving}
                >
                  <option value="">
                    {loadingBranches ? "Loading branches..." : "Select branch"}
                  </option>
                  {branchOptions.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.branchId ? (
                  <span className="receptionists-field-error">
                    {fieldErrors.branchId}
                  </span>
                ) : null}
              </div>

              {fieldErrors.form ? (
                <div className="receptionists-error receptionists-form-message">
                  {fieldErrors.form}
                </div>
              ) : null}

              <div className="receptionists-modal-actions">
                <button
                  type="button"
                  className="receptionists-secondary-button"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="receptionists-save-button"
                  disabled={saving || (editingReceptionist ? !canEdit : !canCreate)}
                >
                  <CheckCircle size={16} />
                  {saving
                    ? "Saving..."
                    : editingReceptionist
                      ? "Update Receptionist"
                      : "Create Receptionist"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Receptionists;
