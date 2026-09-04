import React, { useEffect, useMemo, useState } from "react";
import { Eye, FileUp, ImagePlus, RotateCw, Save, Settings2, Trash2 } from "lucide-react";
import { apiUrl, assetUrl } from "../../../config/api";
import { getRoleProfile } from "../../../profile/sessionProfile";
import { getClinicDisplayName } from "../../../utils/clinicDisplay";
import {
  getClinicBrandingScope,
  getDefaultClinicLogo,
  getPublicClinicLogoUrl,
  readClinicBrandingMap,
  saveClinicBranding,
  useClinicInvoiceBranding,
} from "../../../utils/clinicBranding";
import "./AdminSettings.css";

const BUILT_IN_TEMPLATES = [
  { value: "op", label: "OP Invoice" },
  { value: "diagnostic", label: "Diagnostic Invoice" },
];

const normalizeTemplateValue = (value = "") =>
  String(value || "professional").trim().toLowerCase() === "diagnotic" ? "diagnostic" : value || "professional";

const normalizeTemplateKey = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const normalizeHexColor = (value = "", fallback = "#0f9d9d") => {
  const raw = String(value || "").trim();
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  if (/^#[0-9a-f]{6}$/i.test(withHash)) return withHash.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(withHash)) {
    return `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`.toLowerCase();
  }
  return fallback;
};

const parseInvoiceTemplate = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return { selected: "op", templates: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      selected: normalizeTemplateValue(parsed.selected || parsed.template || "op"),
      templates: parsed.templates && typeof parsed.templates === "object" ? parsed.templates : {},
    };
  } catch {
    return { selected: normalizeTemplateValue(raw), templates: {} };
  }
};

const stringifyInvoiceTemplate = (settings = {}) =>
  JSON.stringify({
    selected: normalizeTemplateValue(settings.template || "op"),
    templates: {
      op: settings.opTemplate || null,
      diagnostic: settings.diagnosticTemplate || null,
    },
  });

const INVOICE_SETTINGS_PATH = "InvoiceSettings";
const INVOICE_LOGO_PATH = "InvoiceSettings/logo";

const withCacheBust = (url = "") => {
  const raw = String(url || "").trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return raw;
  const separator = raw.includes("?") ? "&" : "?";
  return `${raw}${separator}v=${Date.now()}`;
};

const isGeneratedClinicLogoDataUrl = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw.startsWith("data:image/svg+xml")) return false;
  try {
    return decodeURIComponent(raw).includes('viewBox="0 0 480 560"');
  } catch {
    return raw.includes("480%20560") || raw.includes("480 560");
  }
};

const resolveAssetUrl = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (isGeneratedClinicLogoDataUrl(raw)) return "";
  return assetUrl(raw);
};

const getAuthHeaders = (contentType = "application/json") => {
  const token =
    localStorage.getItem("token") ||
    localStorage.getItem("adminToken") ||
    localStorage.getItem("receptionistToken") ||
    "";
  return {
    "ngrok-skip-browser-warning": "true",
    ...(contentType ? { "Content-Type": contentType } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const parseApiPayload = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const unwrapApiData = (data) => {
  if (typeof data === "string") return { url: data };
  if (Array.isArray(data)) return data[0] || {};
  if (Array.isArray(data?.data)) return data.data[0] || {};
  if (typeof data?.data === "string") return { url: data.data };
  if (typeof data?.logo === "string") return { logo: data.logo };
  return data?.data && typeof data.data === "object" ? data.data : data || {};
};

const normalizeApiSettings = (data = {}) => {
  const source = unwrapApiData(data);
  const templateSettings = parseInvoiceTemplate(source.invoiceTemplate || source.InvoiceTemplate || source.template || source.Template || "op");
  const logoValue =
    source.logoDataUrl ||
    source.LogoDataUrl ||
    source.logoUrl ||
    source.LogoUrl ||
    source.logoPath ||
    source.LogoPath ||
    source.logoFilePath ||
    source.LogoFilePath ||
    source.logoFileName ||
    source.LogoFileName ||
    source.logo ||
    source.Logo ||
    source.fileUrl ||
    source.FileUrl ||
    source.url ||
    source.Url ||
    "";
  return {
    id: source.id || source.Id || source.invoiceSettingsId || source.InvoiceSettingsId || "",
    template: templateSettings.selected,
    opTemplate: templateSettings.templates.op || null,
    diagnosticTemplate: templateSettings.templates.diagnostic || null,
    headerTitle: source.headerTitle || source.HeaderTitle || "",
    headerSubtitle: source.headerSubtitle || source.HeaderSubtitle || "",
    clinicAddress: source.clinicAddress || source.ClinicAddress || "",
    clinicPhone: source.clinicPhone || source.ClinicPhone || "",
    clinicEmail: source.clinicEmail || source.ClinicEmail || "",
    gstNumber: source.gstNumber || source.GstNumber || "",
    registrationNumber: source.registrationNumber || source.RegistrationNumber || "",
    footerNote: source.footerNote || source.FooterNote || "",
    accentColor: normalizeHexColor(source.accentColor || source.AccentColor || "#0f9d9d"),
    logoDataUrl: resolveAssetUrl(logoValue),
  };
};

const buildInvoiceSettingsPayload = (settings = {}) => ({
  clinicId: settings.clinicId || settings.hospitalId || "",
  hospitalId: settings.hospitalId || settings.clinicId || "",
  invoiceTemplate: stringifyInvoiceTemplate(settings),
  headerTitle: settings.headerTitle,
  headerSubtitle: settings.headerSubtitle,
  clinicAddress: settings.clinicAddress,
  clinicPhone: settings.clinicPhone,
  clinicEmail: settings.clinicEmail,
  gstNumber: settings.gstNumber,
  registrationNumber: settings.registrationNumber,
  footerNote: settings.footerNote,
  accentColor: normalizeHexColor(settings.accentColor),
});

const withClinicQuery = (path, clinicId = "") => {
  const id = String(clinicId || "").trim();
  if (!id) return apiUrl(path);
  const separator = String(path).includes("?") ? "&" : "?";
  return apiUrl(`${path}${separator}clinicId=${encodeURIComponent(id)}&hospitalId=${encodeURIComponent(id)}`);
};

const requestInvoiceSettings = async (method = "GET", body, clinicId = "") => {
  const response = await fetch(withClinicQuery(INVOICE_SETTINGS_PATH, clinicId || body?.clinicId || body?.hospitalId), {
    method,
    headers: getAuthHeaders(body ? "application/json" : ""),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await parseApiPayload(response);
  if (!response.ok) {
    throw new Error(data?.message || data?.title || (typeof data === "string" ? data : "") || `Invoice settings ${method} failed.`);
  }
  return data;
};

const isImageResponseUrl = async (url = "") => {
  const raw = String(url || "").trim();
  if (!raw) return false;
  const response = await fetch(raw, {
    method: "GET",
    headers: {
      "ngrok-skip-browser-warning": "true",
    },
  }).catch(() => null);
  if (!response?.ok) return false;
  return String(response.headers.get("content-type") || "").toLowerCase().startsWith("image/");
};

const requestInvoiceLogoUpload = async (file, clinicId = "") => {
  const id = String(clinicId || "").trim();
  const formData = new FormData();
  formData.append("logo", file);
  formData.append("file", file);
  formData.append("logoFile", file);
  formData.append("LogoFile", file);
  if (id) {
    formData.append("clinicId", id);
    formData.append("hospitalId", id);
    formData.append("ClinicId", id);
    formData.append("HospitalId", id);
  }
  const response = await fetch(apiUrl(INVOICE_LOGO_PATH), {
    method: "POST",
    headers: getAuthHeaders(""),
    body: formData,
  });
  const data = await parseApiPayload(response);
  if (!response.ok) {
    throw new Error(data?.message || data?.title || (typeof data === "string" ? data : "") || "Logo upload failed.");
  }
  return data;
};

const isInvoiceSettingsMissingError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("invoice settings") && (message.includes("not found") || message.includes("create"));
};

const requestInvoiceLogoDelete = async (clinicId = "") => {
  const response = await fetch(withClinicQuery(INVOICE_LOGO_PATH, clinicId), {
    method: "DELETE",
    headers: getAuthHeaders(""),
  });
  const data = await parseApiPayload(response);
  if (!response.ok) {
    throw new Error(data?.message || data?.title || (typeof data === "string" ? data : "") || "Logo delete failed.");
  }
  return data;
};

const clearLocalInvoiceSettings = () => {
  localStorage.removeItem("clinicInvoiceBrandingSettings");
  window.dispatchEvent(new CustomEvent("clinic-branding-updated"));
};

const readStoredBranding = (scope) => readClinicBrandingMap()[getClinicBrandingScope(scope)] || {};

const getProfileClinicId = (profile = {}) =>
  profile.clinicId ||
  profile.hospitalId ||
  profile.assignedClinicId ||
  localStorage.getItem("hospitalId") ||
  localStorage.getItem("clinicId") ||
  "";

function AdminSettings() {
  const canCreate = true;
  const canEdit = true;
  const canDelete = true;
  const profile = getRoleProfile("admin");
  const clinicName = getClinicDisplayName(profile, localStorage.getItem("clinicName") || "Clinic");
  const clinicId = getProfileClinicId(profile);
  const scope = useMemo(() => ({ clinicId, clinicName }), [clinicId, clinicName]);
  const liveBranding = useClinicInvoiceBranding(scope);
  const publicLogoUrl = getPublicClinicLogoUrl(clinicId);
  const defaultLogoUrl = getDefaultClinicLogo(clinicName, clinicId);
  const storedBranding = readStoredBranding(scope);
  const storedLogoDataUrl = resolveAssetUrl(storedBranding.logoDataUrl);
  const initialForm = {
    settingsId: "",
    template: normalizeTemplateValue(storedBranding.template || "op"),
    headerTitle: storedBranding.headerTitle || clinicName,
    headerSubtitle: storedBranding.headerSubtitle || "Consultation and Patient Care Centre",
    footerNote: storedBranding.footerNote || "Thank you for choosing our clinic. Please retain this invoice for your records.",
    clinicAddress: storedBranding.clinicAddress || localStorage.getItem("clinicAddress") || localStorage.getItem("hospitalAddress") || "",
    clinicPhone: storedBranding.clinicPhone || localStorage.getItem("clinicPhone") || localStorage.getItem("hospitalPhone") || localStorage.getItem("contactNumber") || "",
    clinicEmail: storedBranding.clinicEmail || localStorage.getItem("clinicEmail") || localStorage.getItem("hospitalEmail") || "",
    gstNumber: storedBranding.gstNumber || localStorage.getItem("clinicGst") || localStorage.getItem("gstNumber") || "",
    registrationNumber: storedBranding.registrationNumber || localStorage.getItem("clinicRegistration") || "",
    accentColor: normalizeHexColor(storedBranding.accentColor || "#0f9d9d"),
    logoDataUrl: storedLogoDataUrl || "",
    opTemplate: storedBranding.opTemplate || null,
    diagnosticTemplate: storedBranding.diagnosticTemplate || null,
  };
  const [form, setForm] = useState({
    ...initialForm,
  });
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState("success");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasRemoteSettings, setHasRemoteSettings] = useState(false);

  const showStatus = (message, type = "success") => {
    setStatus(message);
    setStatusType(type);
  };

  const applyRemoteSettings = (settings = {}) => {
    setForm((prev) => ({
      ...prev,
      settingsId: settings.id || prev.settingsId,
      template: normalizeTemplateValue(settings.template || prev.template),
      headerTitle: settings.headerTitle || prev.headerTitle,
      headerSubtitle: settings.headerSubtitle || prev.headerSubtitle,
      clinicAddress: settings.clinicAddress || prev.clinicAddress,
      clinicPhone: settings.clinicPhone || prev.clinicPhone,
      clinicEmail: settings.clinicEmail || prev.clinicEmail,
      gstNumber: settings.gstNumber || prev.gstNumber,
      registrationNumber: settings.registrationNumber || prev.registrationNumber,
      footerNote: settings.footerNote || prev.footerNote,
      accentColor: normalizeHexColor(settings.accentColor || prev.accentColor),
      logoDataUrl: settings.logoDataUrl || prev.logoDataUrl,
      opTemplate: settings.opTemplate || prev.opTemplate,
      diagnosticTemplate: settings.diagnosticTemplate || prev.diagnosticTemplate,
    }));
  };

  const syncBrandingCache = (settings = form) =>
    saveClinicBranding(
      {
        ...settings,
        settingsId: settings.settingsId || settings.id || "",
        template: settings.template,
        logoDataUrl: settings.logoDataUrl || "",
        opTemplate: settings.opTemplate || null,
        diagnosticTemplate: settings.diagnosticTemplate || null,
      },
      scope
    );

  const loadInvoiceSettings = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    if (!quiet) showStatus("Loading invoice settings...", "info");
    try {
      const data = await requestInvoiceSettings("GET", undefined, clinicId);
      const remoteSettings = normalizeApiSettings(data);
      const hasSettings = Object.values(remoteSettings).some(Boolean);
      if (hasSettings) {
        const mergedRemote = {
          ...remoteSettings,
          logoDataUrl: remoteSettings.logoDataUrl || form.logoDataUrl || storedBranding.logoDataUrl || "",
          opTemplate: remoteSettings.opTemplate || storedBranding.opTemplate || form.opTemplate,
          diagnosticTemplate: remoteSettings.diagnosticTemplate || storedBranding.diagnosticTemplate || form.diagnosticTemplate,
        };
        applyRemoteSettings(mergedRemote);
        setHasRemoteSettings(true);
        syncBrandingCache({ ...form, ...mergedRemote, settingsId: remoteSettings.id || form.settingsId });
      } else {
        setForm(initialForm);
        setHasRemoteSettings(false);
      }
      if (!quiet) showStatus(hasSettings ? "Invoice settings loaded." : "No invoice settings found yet.", "success");
    } catch (error) {
      if (!quiet) showStatus(error.message || "Unable to load invoice settings.", "error");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoiceSettings({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!liveBranding.logoUrl || liveBranding.logoUrl === defaultLogoUrl) return;
    setForm((prev) => {
      const currentLogo = resolveAssetUrl(prev.logoDataUrl);
      if (currentLogo && currentLogo === liveBranding.logoUrl) return prev;
      return { ...prev, logoDataUrl: liveBranding.logoUrl };
    });
  }, [defaultLogoUrl, liveBranding.logoUrl]);

  const previewBranding = {
    ...initialForm,
    ...form,
    accentColor: normalizeHexColor(form.accentColor),
    logoUrl: resolveAssetUrl(form.logoDataUrl) || liveBranding.logoUrl || defaultLogoUrl,
    watermarkUrl: resolveAssetUrl(form.logoDataUrl) || liveBranding.logoUrl || defaultLogoUrl,
  };
  const effectiveTemplateValue = form.template;
  const builtInTemplate = BUILT_IN_TEMPLATES.find((template) => template.value === form.template);
  const templatePreview = builtInTemplate;
  const selectedTemplateKey = normalizeTemplateKey(templatePreview?.name || effectiveTemplateValue);
  const invoiceKind = selectedTemplateKey.includes("diagnostic") || selectedTemplateKey.includes("lab") || selectedTemplateKey.includes("test")
    ? "diagnostic"
    : "op";
  const activeUploadedTemplate = invoiceKind === "diagnostic" ? form.diagnosticTemplate : form.opTemplate;
  const invoiceTitle = invoiceKind === "diagnostic" ? "Diagnostic GST Invoice" : "OP Billing Invoice";
  const invoiceRows = invoiceKind === "diagnostic"
    ? [
        { name: "Complete Blood Count", amount: 450 },
        { name: "Thyroid Profile", amount: 850 },
      ]
    : [
        { name: "Consultation Fee", amount: 500 },
        { name: "Registration Charges", amount: 100 },
      ];
  const invoiceSubtotal = invoiceRows.reduce((sum, row) => sum + row.amount, 0);
  const invoiceCgst = Math.round(invoiceSubtotal * 0.09 * 100) / 100;
  const invoiceSgst = Math.round(invoiceSubtotal * 0.09 * 100) / 100;
  const invoiceTotal = invoiceSubtotal + invoiceCgst + invoiceSgst;
  const invoiceDiscount = invoiceKind === "diagnostic" ? 120 : 0;
  const invoiceNetAmount = invoiceTotal - invoiceDiscount;

  const updateField = (name, value) => {
    setStatus("");
    setForm((prev) => ({ ...prev, [name]: name === "accentColor" ? normalizeHexColor(value, prev.accentColor) : value }));
  };

  const readTemplateFile = (file, type) => {
    const reader = new FileReader();
    reader.onload = () => {
      const nextTemplate = {
        type,
        name: file.name.replace(/\.[^.]+$/, "") || file.name,
        fileName: file.name,
        dataUrl: String(reader.result || ""),
        updatedAt: new Date().toISOString(),
      };
      setForm((prev) => ({ ...prev, [`${type}Template`]: nextTemplate, template: type }));
      showStatus(`${type === "op" ? "OP" : "Diagnostic"} template ready. Click Save beside the template.`, "info");
    };
    reader.readAsDataURL(file);
  };

  const handleTemplateUpload = (type, event) => {
    if (!canCreate) {
      showStatus("You do not have permission to upload templates.", "error");
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (file) readTemplateFile(file, type);
    event.target.value = "";
  };

  const openTemplatePreview = (template) => {
    if (!template?.dataUrl) return;
    const win = window.open("", "_blank", "width=900,height=760");
    if (!win) return;
    const isImage = String(template.dataUrl).startsWith("data:image/");
    win.document.write(`<!doctype html><html><head><title>${template.fileName || template.name}</title><style>body{margin:0;background:#f8fafc;display:grid;place-items:center;min-height:100vh}img,iframe{width:96vw;height:94vh;object-fit:contain;border:0;background:white}</style></head><body>${isImage ? `<img src="${template.dataUrl}" alt="">` : `<iframe src="${template.dataUrl}" title="Template preview"></iframe>`}</body></html>`);
    win.document.close();
  };

  const saveBillingTemplate = async (type) => {
    if (!canEdit) {
      showStatus("You do not have permission to save templates.", "error");
      return;
    }
    const template = form[`${type}Template`];
    if (!template?.dataUrl) {
      showStatus(`Upload a ${type === "op" ? "OP" : "Diagnostic"} template first.`, "error");
      return;
    }

    const nextForm = {
      ...form,
      template: type,
      [`${type}Template`]: {
        ...template,
        savedAt: new Date().toISOString(),
      },
    };

    setSaving(true);
    showStatus(`Saving ${type === "op" ? "OP" : "Diagnostic"} template...`, "info");
    try {
      const data = await requestInvoiceSettings(
        hasRemoteSettings ? "PUT" : "POST",
        buildInvoiceSettingsPayload({ ...nextForm, clinicId, hospitalId: clinicId }),
        clinicId
      );
      const remoteSettings = normalizeApiSettings(data);
      const mergedSettings = {
        ...nextForm,
        ...remoteSettings,
        logoDataUrl: remoteSettings.logoDataUrl || nextForm.logoDataUrl,
        opTemplate: remoteSettings.opTemplate || nextForm.opTemplate,
        diagnosticTemplate: remoteSettings.diagnosticTemplate || nextForm.diagnosticTemplate,
        settingsId: remoteSettings.id || nextForm.settingsId,
      };
      setForm((prev) => ({ ...prev, ...mergedSettings }));
      setHasRemoteSettings(true);
      syncBrandingCache(mergedSettings);
      showStatus(`${type === "op" ? "OP" : "Diagnostic"} template saved in backend.`);
    } catch (error) {
      showStatus(error.message || `Unable to save ${type === "op" ? "OP" : "Diagnostic"} template.`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoChange = (event) => {
    if (!canCreate && !canEdit) {
      showStatus("You do not have permission to upload logo.", "error");
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const localLogo = String(reader.result || "");
      updateField("logoDataUrl", localLogo);
      setSaving(true);
      showStatus(hasRemoteSettings ? "Uploading logo..." : "Creating invoice settings before logo upload...", "info");
      try {
        let nextForm = { ...form, logoDataUrl: localLogo };
        if (!hasRemoteSettings) {
          const settingsData = await requestInvoiceSettings(
            "POST",
            buildInvoiceSettingsPayload({ ...nextForm, clinicId, hospitalId: clinicId }),
            clinicId
          );
          const remoteSettings = normalizeApiSettings(settingsData);
          nextForm = {
            ...nextForm,
            ...remoteSettings,
            logoDataUrl: remoteSettings.logoDataUrl || nextForm.logoDataUrl,
            settingsId: remoteSettings.id || nextForm.settingsId,
          };
          setHasRemoteSettings(true);
        }
        let data = null;
        try {
          data = await requestInvoiceLogoUpload(file, clinicId);
        } catch (logoError) {
          if (!isInvoiceSettingsMissingError(logoError)) throw logoError;
          showStatus("Creating invoice settings before retrying logo upload...", "info");
          const settingsData = await requestInvoiceSettings(
            "POST",
            buildInvoiceSettingsPayload({ ...nextForm, clinicId, hospitalId: clinicId }),
            clinicId
          );
          const remoteSettings = normalizeApiSettings(settingsData);
          nextForm = {
            ...nextForm,
            ...remoteSettings,
            logoDataUrl: remoteSettings.logoDataUrl || nextForm.logoDataUrl,
            settingsId: remoteSettings.id || nextForm.settingsId,
          };
          setHasRemoteSettings(true);
          data = await requestInvoiceLogoUpload(file, clinicId);
        }
        const uploadedLogo = normalizeApiSettings(data).logoDataUrl;
        const refreshedSettings = await requestInvoiceSettings("GET", undefined, clinicId)
          .then(normalizeApiSettings)
          .catch(() => ({}));
        const refreshedLogo = refreshedSettings.logoDataUrl;
        const publicLogo = withCacheBust(publicLogoUrl);
        const publicLogoReady = await isImageResponseUrl(publicLogo);
        const remoteLogo = withCacheBust(refreshedLogo || uploadedLogo) || localLogo;
        const syncedSettings = {
          ...nextForm,
          ...refreshedSettings,
          logoDataUrl: remoteLogo,
          settingsId: refreshedSettings.id || nextForm.settingsId,
        };
        setForm((prev) => ({ ...prev, ...syncedSettings }));
        syncBrandingCache(syncedSettings);
        showStatus(publicLogoReady || refreshedLogo ? "Logo uploaded and saved." : "Logo uploaded locally, but GET logo API is not returning it yet.", publicLogoReady || refreshedLogo ? "success" : "info");
      } catch (error) {
        setForm((prev) => ({ ...prev, logoDataUrl: "" }));
        showStatus(error.message || "Unable to upload logo.", "error");
      } finally {
        setSaving(false);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const selectTemplate = (value) => {
    const nextValue = normalizeTemplateValue(value);
    setStatus("");
    setForm((prev) => ({
      ...prev,
      template: nextValue,
    }));
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    if (hasRemoteSettings ? !canEdit : !canCreate) {
      showStatus(`You do not have permission to ${hasRemoteSettings ? "update" : "create"} settings.`, "error");
      return;
    }
    const nextForm = {
      ...form,
      template: effectiveTemplateValue,
    };
    setSaving(true);
    showStatus(hasRemoteSettings ? "Updating invoice settings..." : "Creating invoice settings...", "info");
    try {
      const data = await requestInvoiceSettings(
        hasRemoteSettings ? "PUT" : "POST",
        buildInvoiceSettingsPayload({ ...nextForm, clinicId, hospitalId: clinicId }),
        clinicId
      );
      const remoteSettings = normalizeApiSettings(data);
      const mergedSettings = {
        ...nextForm,
        ...remoteSettings,
        logoDataUrl: remoteSettings.logoDataUrl || nextForm.logoDataUrl,
        settingsId: remoteSettings.id || nextForm.settingsId,
      };
      setForm((prev) => ({ ...prev, ...mergedSettings }));
      setHasRemoteSettings(true);
      syncBrandingCache(mergedSettings);
      showStatus("Clinic invoice settings saved.");
    } catch (error) {
      showStatus(error.message || "Unable to save invoice settings.", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteSettings = async () => {
    if (!canDelete) {
      showStatus("You do not have permission to delete settings.", "error");
      return;
    }
    setSaving(true);
    showStatus("Deleting invoice settings...", "info");
    try {
      await requestInvoiceSettings("DELETE", undefined, clinicId);
      setForm(initialForm);
      setHasRemoteSettings(false);
      clearLocalInvoiceSettings();
      showStatus("Invoice settings deleted.");
    } catch (error) {
      showStatus(error.message || "Unable to delete invoice settings.", "error");
    } finally {
      setSaving(false);
    }
  };

  const deleteLogo = async () => {
    if (!canDelete) {
      showStatus("You do not have permission to delete logo.", "error");
      return;
    }
    setSaving(true);
    showStatus("Deleting logo...", "info");
    try {
      await requestInvoiceLogoDelete(clinicId);
      setForm((prev) => ({ ...prev, logoDataUrl: "" }));
      syncBrandingCache({ ...form, logoDataUrl: "" });
      showStatus("Logo deleted.");
    } catch (error) {
      showStatus(error.message || "Unable to delete logo.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-settings-page">
      <div className="admin-settings-header">
        <div>
          <p>Clinic Settings</p>
          <h1>Invoice Branding</h1>
          <span>These settings apply to every new billing invoice generated under this clinic.</span>
        </div>
        <Settings2 size={34} />
      </div>
      <div className="admin-settings-toolbar">
        <button type="button" onClick={() => loadInvoiceSettings()} disabled={loading || saving}>
          <RotateCw size={17} />
          Refresh
        </button>
        <button className="admin-settings-danger-button" type="button" onClick={deleteSettings} disabled={loading || saving || !canDelete}>
          <Trash2 size={17} />
          Delete Settings
        </button>
      </div>

      <form className="admin-settings-grid" onSubmit={saveSettings}>
        <section className="admin-settings-panel">
          <h2>Template</h2>
          <label>
            Invoice Template
            <select value={effectiveTemplateValue} onChange={(event) => selectTemplate(event.target.value)}>
              {BUILT_IN_TEMPLATES.map((template) => (
                <option key={template.value} value={template.value}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          {builtInTemplate ? (
            <div className="admin-settings-template-preview admin-settings-template-preview--builtin">
              <div>
                <strong>Template Preview</strong>
                <span>{builtInTemplate.label}</span>
              </div>
              <div className="admin-settings-builtin-template">
                <div className="admin-settings-builtin-template-head" style={{ borderColor: previewBranding.accentColor }}>
                  <span>{builtInTemplate.label}</span>
                  <b>INV-0001</b>
                </div>
                <div className="admin-settings-builtin-template-row">
                  <span>{form.template === "diagnostic" ? "Diagnostic Test" : "Consultation Fee"}</span>
                  <b>Rs. 500.00</b>
                </div>
              </div>
            </div>
          ) : null}
          <div className="admin-settings-template-list">
            <strong>Uploaded Billing Templates</strong>
            {[
              { type: "op", label: "OP Billing Template", template: form.opTemplate },
              { type: "diagnostic", label: "Diagnostic Billing Template", template: form.diagnosticTemplate },
            ].map((item) => (
              <article className="admin-settings-template-card" key={item.type}>
                <div className="admin-settings-template-card-preview">
                  {item.template?.dataUrl ? (
                    String(item.template.dataUrl).startsWith("data:image/") ? (
                      <img src={item.template.dataUrl} alt={`${item.label} preview`} />
                    ) : (
                      <iframe title={`${item.label} preview`} src={item.template.dataUrl} />
                    )
                  ) : (
                    <div className="admin-settings-empty-template">No template uploaded</div>
                  )}
                </div>
                <div className="admin-settings-template-card-meta">
                  <div>
                    <button className="admin-settings-template-name" type="button" onClick={() => item.template?.dataUrl && openTemplatePreview(item.template)}>
                      {item.label}
                    </button>
                    <span>{item.template?.fileName || "Upload a template file"}</span>
                  </div>
                  <div className="admin-settings-template-actions">
                    <label className="admin-settings-template-action">
                      <FileUp size={15} />
                      Upload
                      <input type="file" accept=".html,.htm,.pdf,.doc,.docx,image/*" onChange={(event) => handleTemplateUpload(item.type, event)} disabled={!canCreate} />
                    </label>
                    <button
                      className="admin-settings-template-action admin-settings-template-action--save"
                      type="button"
                      onClick={() => saveBillingTemplate(item.type)}
                      disabled={!item.template?.dataUrl || saving || !canEdit}
                      style={{ borderColor: previewBranding.accentColor, color: previewBranding.accentColor }}
                    >
                      <Save size={15} />
                      Save
                    </button>
                    <button className="admin-settings-template-action" type="button" onClick={() => openTemplatePreview(item.template)} disabled={!item.template?.dataUrl}>
                      <Eye size={15} />
                      Preview
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <label>
            Header Title
            <input value={form.headerTitle} onChange={(event) => updateField("headerTitle", event.target.value)} />
          </label>
          <label>
            Header Subtitle
            <input value={form.headerSubtitle} onChange={(event) => updateField("headerSubtitle", event.target.value)} />
          </label>
          <label>
            Clinic Address
            <textarea rows={3} value={form.clinicAddress} onChange={(event) => updateField("clinicAddress", event.target.value)} />
          </label>
          <label>
            Clinic Phone
            <input value={form.clinicPhone} onChange={(event) => updateField("clinicPhone", event.target.value)} />
          </label>
          <label>
            Clinic Email
            <input value={form.clinicEmail} onChange={(event) => updateField("clinicEmail", event.target.value)} />
          </label>
          <label>
            GST Number
            <input value={form.gstNumber} onChange={(event) => updateField("gstNumber", event.target.value)} />
          </label>
          <label>
            Registration Number
            <input value={form.registrationNumber} onChange={(event) => updateField("registrationNumber", event.target.value)} />
          </label>
          <label>
            Footer Note
            <textarea rows={4} value={form.footerNote} onChange={(event) => updateField("footerNote", event.target.value)} />
          </label>
          <label>
            Accent Color
            <span className="admin-settings-color-row">
              <input type="color" value={form.accentColor} onChange={(event) => updateField("accentColor", event.target.value)} />
              <input value={form.accentColor} onChange={(event) => updateField("accentColor", event.target.value)} />
            </span>
          </label>
        </section>

        <section className="admin-settings-panel">
          <h2>Clinic Logo</h2>
          <div className="admin-settings-logo-drop">
            <img
              src={previewBranding.logoUrl}
              alt="Clinic logo preview"
              onError={(event) => {
                event.currentTarget.src = defaultLogoUrl;
              }}
            />
            <label className="admin-settings-upload">
              <ImagePlus size={18} />
              Upload Logo
              <input type="file" accept="image/*" onChange={handleLogoChange} disabled={!(canCreate || canEdit)} />
            </label>
          </div>
          <button className="admin-settings-save" type="submit" disabled={saving || (hasRemoteSettings ? !canEdit : !canCreate)} style={{ background: previewBranding.accentColor }}>
            <Save size={18} />
            <span>{saving ? "Saving..." : hasRemoteSettings ? "Update Settings" : "Save Settings"}</span>
          </button>
          <button className="admin-settings-secondary admin-settings-logo-delete" type="button" onClick={deleteLogo} disabled={loading || saving || !canDelete}>
            <Trash2 size={16} />
            <span>Delete Logo</span>
          </button>
          {status ? <p className={`admin-settings-status admin-settings-status--${statusType}`}>{status}</p> : null}
        </section>

        <section className={`admin-settings-preview admin-settings-preview--${invoiceKind}`}>
          <div className="admin-settings-preview-watermark">
            <img src={previewBranding.watermarkUrl} alt="" />
          </div>
          {activeUploadedTemplate?.dataUrl ? (
            <div className={`admin-settings-mapped-invoice admin-settings-mapped-invoice--${invoiceKind}`}>
              <header style={{ borderColor: previewBranding.accentColor }}>
                <div className="admin-settings-mapped-brand">
                  <img src={previewBranding.logoUrl} alt="" />
                  <div>
                    <span>{invoiceKind === "diagnostic" ? "Diagnostic Invoice" : "OP Invoice"}</span>
                    <h2>{previewBranding.headerTitle}</h2>
                    <p>{previewBranding.headerSubtitle}</p>
                    <p>{[previewBranding.clinicAddress, previewBranding.clinicPhone, previewBranding.clinicEmail].filter(Boolean).join(" | ")}</p>
                  </div>
                </div>
                <div className="admin-settings-mapped-number">
                  <strong>{invoiceKind === "diagnostic" ? "BILL-1" : "INV-0001"}</strong>
                  <small>Created: 11/08/2026, 06:09 PM</small>
                  <small>Print: 11/08/2026, 06:09 PM</small>
                  {invoiceKind === "op" ? <small>Token No: 26</small> : null}
                </div>
              </header>
              <section className="admin-settings-mapped-fields">
                <div><span>Patient Name</span><b>Somi</b></div>
                <div><span>Patient ID</span><b>P-86625</b></div>
                <div><span>Age / Sex</span><b>21Y / Female</b></div>
                <div><span>Phone</span><b>8096555145</b></div>
                <div><span>{invoiceKind === "diagnostic" ? "Diagnostic Bill No" : "OP / Cons No"}</span><b>{invoiceKind === "diagnostic" ? "BILL-1" : "INV-0001"}</b></div>
                <div><span>Token No</span><b>{invoiceKind === "op" ? "26" : "-"}</b></div>
                <div><span>Created Date</span><b>11/08/2026, 06:09 PM</b></div>
                <div><span>Print Date</span><b>11/08/2026, 06:09 PM</b></div>
                <div><span>{invoiceKind === "diagnostic" ? "Ref. Doctor" : "Consultant"}</span><b>Dr. Prasad Pilla</b></div>
                <div><span>Department</span><b>General Medicine & Surgery</b></div>
                <div><span>Visit Type</span><b>Normal</b></div>
                <div><span>Payment Mode</span><b>UPI</b></div>
                <div><span>Generated By</span><b>Durga Pilla</b></div>
                <div><span>GST</span><b>CGST 9% + SGST 9%</b></div>
              </section>
              <section className="admin-settings-mapped-table">
                <div className="admin-settings-mapped-row admin-settings-mapped-row--head">
                  <span>SNo</span>
                  <span>{invoiceKind === "diagnostic" ? "Diagnostic Test" : "Particulars"}</span>
                  <span>Amount</span>
                  <span>CGST</span>
                  <span>SGST</span>
                  <span>Net</span>
                </div>
                {invoiceRows.map((row, index) => {
                  const cgst = Math.round(row.amount * 0.09 * 100) / 100;
                  const sgst = Math.round(row.amount * 0.09 * 100) / 100;
                  return (
                    <div className="admin-settings-mapped-row" key={row.name}>
                      <span>{index + 1}</span>
                      <span>{row.name}</span>
                      <span>Rs. {row.amount.toFixed(2)}</span>
                      <span>Rs. {cgst.toFixed(2)}</span>
                      <span>Rs. {sgst.toFixed(2)}</span>
                      <span>Rs. {(row.amount + cgst + sgst).toFixed(2)}</span>
                    </div>
                  );
                })}
                <div className="admin-settings-mapped-total" style={{ background: `${previewBranding.accentColor}22` }}>
                  <span>Receipt / Net Amount</span>
                  <b>Rs. {invoiceNetAmount.toFixed(2)}</b>
                </div>
              </section>
              <footer>
                <p>{previewBranding.footerNote}</p>
                <strong>Authorized Signature</strong>
              </footer>
            </div>
          ) : invoiceKind === "diagnostic" ? (
            <div className="admin-settings-generated-invoice admin-settings-generated-invoice--diagnostic">
              <div className="admin-settings-diagnostic-head" style={{ borderColor: previewBranding.accentColor }}>
                <div>
                  <img src={previewBranding.logoUrl} alt="" />
                  <div>
                    <h2>{previewBranding.headerTitle} Diagnostics</h2>
                    <p>{previewBranding.headerSubtitle}</p>
                    <p>{[previewBranding.clinicAddress, previewBranding.clinicPhone, previewBranding.clinicEmail].filter(Boolean).join(" | ")}</p>
                  </div>
                </div>
                <div>
                  <span>{invoiceTitle}</span>
                  <strong>BILL-1</strong>
                  <small>Inv. Date: 11/08/2026, 06:09 PM</small>
                </div>
              </div>
              <div className="admin-settings-diagnostic-cards">
                <div>
                  <h3>Patient</h3>
                  <p><span>Name</span><b>Somi</b></p>
                  <p><span>Patient ID</span><b>P-86625</b></p>
                  <p><span>Ref. Doctor</span><b>Dr. Prasad Pilla</b></p>
                </div>
                <div>
                  <h3>Payment</h3>
                  <p><span>Mode</span><b>UPI</b></p>
                  <p><span>Generated By</span><b>Durga Pilla</b></p>
                  <p><span>GST</span><b>CGST 9% + SGST 9%</b></p>
                </div>
              </div>
              <div className="admin-settings-diagnostic-table">
                <div className="admin-settings-diagnostic-row admin-settings-diagnostic-row--head">
                  <span>SNo</span>
                  <span>Diagnostic Test</span>
                  <span>Amount</span>
                  <span>CGST</span>
                  <span>SGST</span>
                  <span>Net Amount</span>
                </div>
                {invoiceRows.map((row, index) => {
                  const cgst = Math.round(row.amount * 0.09 * 100) / 100;
                  const sgst = Math.round(row.amount * 0.09 * 100) / 100;
                  return (
                    <div className="admin-settings-diagnostic-row" key={row.name}>
                      <span>{index + 1}</span>
                      <span>{row.name}</span>
                      <span>Rs. {row.amount.toFixed(2)}</span>
                      <span>Rs. {cgst.toFixed(2)}</span>
                      <span>Rs. {sgst.toFixed(2)}</span>
                      <span>Rs. {(row.amount + cgst + sgst).toFixed(2)}</span>
                    </div>
                  );
                })}
                <div className="admin-settings-diagnostic-summary">
                  <span>Sub Total</span>
                  <b>Rs. {invoiceTotal.toFixed(2)}</b>
                </div>
                <div className="admin-settings-diagnostic-summary">
                  <span>Discount</span>
                  <b>- Rs. {invoiceDiscount.toFixed(2)}</b>
                </div>
                <div className="admin-settings-diagnostic-summary admin-settings-diagnostic-summary--net">
                  <span>Net Amount</span>
                  <b>Rs. {invoiceNetAmount.toFixed(2)}</b>
                </div>
              </div>
              <div className="admin-settings-generated-footer">
                <p>{previewBranding.footerNote}<br />Print on: 11/08/2026, 06:09 PM</p>
                <strong>Authorized Signature</strong>
              </div>
            </div>
          ) : (
            <div className="admin-settings-generated-invoice admin-settings-generated-invoice--op">
              <div className="admin-settings-op-head" style={{ borderColor: previewBranding.accentColor }}>
                <div>
                  <img src={previewBranding.logoUrl} alt="" />
                  <div>
                    <span>OP Invoice</span>
                    <h2>{previewBranding.headerTitle}</h2>
                    <p>{previewBranding.headerSubtitle}</p>
                    <p>{[previewBranding.clinicAddress, previewBranding.clinicPhone, previewBranding.clinicEmail].filter(Boolean).join(" | ")}</p>
                  </div>
                </div>
                <div>
                  <strong>INV-0001</strong>
                  <small>11/08/2026, 06:09 PM</small>
                </div>
              </div>
              <div className="admin-settings-op-details">
                <div><span>Patient Name</span><b>Somi</b></div>
                <div><span>Patient ID</span><b>P-86625</b></div>
                <div><span>Doctor</span><b>Dr. Prasad Pilla</b></div>
                <div><span>Payment</span><b>UPI</b></div>
              </div>
              <div className="admin-settings-op-table">
                {invoiceRows.map((row) => (
                  <div key={row.name}>
                    <span>{row.name}</span>
                    <b>Rs. {row.amount.toFixed(2)}</b>
                  </div>
                ))}
                <div><span>CGST 9%</span><b>Rs. {invoiceCgst.toFixed(2)}</b></div>
                <div><span>SGST 9%</span><b>Rs. {invoiceSgst.toFixed(2)}</b></div>
              <div className="admin-settings-op-total" style={{ background: `${previewBranding.accentColor}22` }}>
                  <span>Total Amount</span>
                  <b>Rs. {invoiceTotal.toFixed(2)}</b>
                </div>
              </div>
              <div className="admin-settings-generated-footer">
                <p>{previewBranding.footerNote}</p>
                <strong>Authorized Signature</strong>
              </div>
            </div>
          )}
          <div className="admin-settings-preview-head" style={{ borderColor: previewBranding.accentColor }}>
            <div>
              <img src={previewBranding.logoUrl} alt="" />
              <div>
                <h2>{previewBranding.headerTitle}</h2>
                <p>{previewBranding.headerSubtitle}</p>
                <p>{[previewBranding.clinicAddress, previewBranding.clinicPhone, previewBranding.clinicEmail].filter(Boolean).join(" | ")}</p>
                <p>{[previewBranding.gstNumber ? `GST: ${previewBranding.gstNumber}` : "", previewBranding.registrationNumber ? `Reg: ${previewBranding.registrationNumber}` : ""].filter(Boolean).join(" | ")}</p>
              </div>
            </div>
            <div className="admin-settings-preview-meta">
              <span>{invoiceTitle}</span>
              <strong>INV-0001</strong>
              <small>11/08/2026, 06:09 PM</small>
            </div>
          </div>
          <div className="admin-settings-preview-info-grid">
            <div>
              <span>Patient</span>
              <b>Somi</b>
              <small>Patient ID: P-86625</small>
              <small>Ref. Doctor: Dr. Prasad Pilla</small>
            </div>
            <div>
              <span>Payment</span>
              <b>UPI</b>
              <small>Generated By: Durga Pilla</small>
              <small>GST: CGST 9% + SGST 9%</small>
            </div>
          </div>
          <div className="admin-settings-preview-table admin-settings-preview-table--legacy">
            <span>Consultation Fee</span>
            <b>₹500.00</b>
          </div>
          <div className="admin-settings-preview-table admin-settings-preview-table--invoice">
            <div className="admin-settings-preview-table-head">
              <span>SNo</span>
              <span>{invoiceKind === "diagnostic" ? "Diagnostic Test" : "Particulars"}</span>
              <span>Amount</span>
              <span>CGST</span>
              <span>SGST</span>
              <span>Net</span>
            </div>
            {invoiceRows.map((row, index) => {
              const cgst = Math.round(row.amount * 0.09 * 100) / 100;
              const sgst = Math.round(row.amount * 0.09 * 100) / 100;
              return (
                <div className="admin-settings-preview-table-row" key={row.name}>
                  <span>{index + 1}</span>
                  <span>{row.name}</span>
                  <span>Rs. {row.amount.toFixed(2)}</span>
                  <span>Rs. {cgst.toFixed(2)}</span>
                  <span>Rs. {sgst.toFixed(2)}</span>
                  <span>Rs. {(row.amount + cgst + sgst).toFixed(2)}</span>
                </div>
              );
            })}
            <div className="admin-settings-preview-total-row">
              <span>Subtotal</span>
              <b>Rs. {invoiceSubtotal.toFixed(2)}</b>
              <span>CGST</span>
              <b>Rs. {invoiceCgst.toFixed(2)}</b>
              <span>SGST</span>
              <b>Rs. {invoiceSgst.toFixed(2)}</b>
            </div>
            <div className="admin-settings-preview-net-row">
              <span>Net Amount</span>
              <b>Rs. {invoiceTotal.toFixed(2)}</b>
            </div>
          </div>
          <div className="admin-settings-preview-footer">
            <p>{previewBranding.footerNote}</p>
            <strong>Authorized Signature</strong>
          </div>
        </section>
      </form>
    </div>
  );
}

export default AdminSettings;
