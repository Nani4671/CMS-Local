import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, Download, Edit3, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { apiUrl } from "../../config/api";
import { getApiHeaders } from "../../utils/branchApi";
import { cacheLabMasterTests, getImportedLabFileRows, saveImportedLabFileRows } from "../../utils/labMaster";
import { useToast } from "../../components/ToastProvider";
import { useAdminModulePermissions } from "../../utils/rolePermissions";
import { ActionsGroup } from "../../components/ActionsGroup";
import "../RECEPTIONISTS/Receptionists.css";
import "./LabFiles.css";

const parseList = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.result)) return data.result;
  if (Array.isArray(data?.files)) return data.files;
  if (Array.isArray(data?.tests)) return data.tests;
  return [];
};

const readFirst = (record = {}, keys = [], fallback = "-") => {
  for (const key of keys) {
    const value = String(key).split(".").reduce((current, part) => (current && typeof current === "object" ? current[part] : undefined), record);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
};

const getLabFileId = (record = {}) =>
  readFirst(record, ["id", "Id", "testId", "TestId", "labTestId", "LabTestId"], "");

const getInitialForm = (record = {}) => ({
  testCode: readFirst(record, ["testCode", "TestCode", "code", "Code"], ""),
  testName: readFirst(record, ["testName", "TestName", "name", "Name"], ""),
  category: readFirst(record, ["category", "Category"], ""),
  sampleType: readFirst(record, ["sampleType", "SampleType"], ""),
  unit: readFirst(record, ["unit", "Unit"], ""),
  referenceRange: readFirst(record, ["referenceRange", "ReferenceRange"], ""),
  price: readFirst(record, ["price", "Price", "amount", "Amount"], ""),
  turnaroundHours: readFirst(record, ["turnaroundHours", "TurnaroundHours"], ""),
  instructions: readFirst(record, ["instructions", "Instructions"], ""),
  branchId: readFirst(record, ["branchId", "BranchId"], ""),
  isActive: String(readFirst(record, ["isActive", "IsActive"], true)) === "false" ? "false" : "true",
});

const getErrorMessage = async (response, fallback) => {
  const text = await response.text().catch(() => "");
  if (!text) return fallback;
  try {
    const data = JSON.parse(text);
    return data?.message || data?.title || text;
  } catch {
    return text;
  }
};

const downloadLabExport = async () => {
  const response = await fetch(apiUrl("Lab/master/export"), { headers: getApiHeaders() });
  if (!response.ok) throw new Error(await getErrorMessage(response, "Unable to export lab files."));
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "lab-master-export";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

const LAB_MASTER_QUERY = "pageSize=10000&limit=10000&includeAll=true&all=true";

function LabFiles() {
  const toast = useToast();
  const { permissions, canCreate, canEdit, canDelete } = useAdminModulePermissions("Lab Files");
  const fileInputRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [activeActionState, setActiveActionState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [addingRow, setAddingRow] = useState(false);
  const [form, setForm] = useState(getInitialForm());
  const [search, setSearch] = useState("");

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const savedRows = getImportedLabFileRows();
      if (savedRows.length) setRows(savedRows);
      const response = await fetch(apiUrl(`Lab/master?${LAB_MASTER_QUERY}`), { headers: getApiHeaders() });
      if (!response.ok) throw new Error(await getErrorMessage(response, "Unable to load lab file data."));
      const list = parseList(await response.json().catch(() => null));
      cacheLabMasterTests(list);
      setRows(list);
    } catch (error) {
      const savedRows = getImportedLabFileRows();
      setRows(savedRows);
      if (!savedRows.length) toast.error(error.message || "Unable to load lab file data.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(term));
  }, [rows, search]);

  const handleImport = async (event) => {
    if (!canCreate) {
      toast.error("You do not have permission to import lab files.");
      event.target.value = "";
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    const fileExtension = String(file.name).split(".").pop()?.toLowerCase() || "";
    const allowedExtensions = ["xls", "xlsx", "csv"];
    if (!allowedExtensions.includes(fileExtension)) {
      toast.error("Only Excel or CSV files are allowed for lab import.");
      event.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(apiUrl("Lab/master/import"), {
        method: "POST",
        headers: getApiHeaders(),
        body,
      });
      if (!response.ok) throw new Error(await getErrorMessage(response, "Unable to import lab file."));
      toast.success("Lab file imported successfully.");
      const importedResponse = await fetch(apiUrl(`Lab/master?${LAB_MASTER_QUERY}`), { headers: getApiHeaders() });
      if (!importedResponse.ok) throw new Error(await getErrorMessage(importedResponse, "Imported file saved, but unable to reload lab records."));
      const importedRows = parseList(await importedResponse.json().catch(() => null));
      saveImportedLabFileRows(importedRows);
      setRows(importedRows);
    } catch (error) {
      toast.error(error.message || "Unable to import lab file.");
    } finally {
      event.target.value = "";
      setUploading(false);
    }
  };

  const handleExport = async () => {
    if (!permissions.view) {
      toast.error("You do not have permission to export lab files.");
      return;
    }
    try {
      await downloadLabExport();
      toast.success("Lab export downloaded.");
    } catch (error) {
      toast.error(error.message || "Unable to export lab files.");
    }
  };

  const openAdd = () => {
    if (!canCreate) {
      toast.error("You do not have permission to add lab files.");
      return;
    }
    setEditingRow(null);
    setAddingRow(true);
    setForm(getInitialForm());
  };

  const openEdit = (row) => {
    if (!canEdit) {
      toast.error("You do not have permission to edit lab files.");
      return;
    }
    setAddingRow(false);
    setEditingRow(row);
    setForm(getInitialForm(row));
  };

  const closeForm = () => {
    setEditingRow(null);
    setAddingRow(false);
    setForm(getInitialForm());
  };

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const buildLabMasterPayload = () => ({
    testCode: form.testCode.trim(),
    testName: form.testName.trim(),
    category: form.category.trim(),
    sampleType: form.sampleType.trim(),
    unit: form.unit.trim(),
    referenceRange: form.referenceRange.trim(),
    price: Number(form.price) || 0,
    turnaroundHours: Number(form.turnaroundHours) || 0,
    instructions: form.instructions.trim(),
    branchId: Number(form.branchId) || 0,
    isActive: form.isActive === "true",
  });

  const sendLabMasterPayload = (url, method, payload) => {
    const sendJson = () =>
      fetch(url, {
        method,
        headers: {
          ...getApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

    const sendFormData = () => {
      const formData = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        formData.append(key, value === null || value === undefined ? "" : String(value));
      });
      return fetch(url, {
        method,
        headers: getApiHeaders(),
        body: formData,
      });
    };

    return sendJson().then((response) => (response.status === 415 ? sendFormData() : response));
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!canCreate) {
      toast.error("You do not have permission to add lab files.");
      return;
    }

    setSaving(true);
    try {
      const payload = buildLabMasterPayload();
      const response = await sendLabMasterPayload(apiUrl("Lab/master"), "POST", payload);
      if (!response.ok) throw new Error(await getErrorMessage(response, "Unable to add lab test."));

      toast.success("Lab test added successfully.");
      const createdRow = await response.json().catch(() => null);
      if (createdRow && typeof createdRow === "object") {
        const nextRows = [createdRow, ...rows];
        saveImportedLabFileRows(nextRows);
        setRows(nextRows);
      }
      closeForm();
      await loadRows();
    } catch (error) {
      toast.error(error.message || "Unable to add lab test.");
    } finally {
      setSaving(false);
    }
  };
  const handleUpdate = async (event) => {
    event.preventDefault();
    if (!canEdit) {
      toast.error("You do not have permission to edit lab files.");
      return;
    }
    const id = getLabFileId(editingRow || {});
    if (!id) {
      toast.error("Lab file record id is missing.");
      return;
    }

    setSaving(true);
    try {
      const payload = buildLabMasterPayload();
      const url = apiUrl(`Lab/master/${encodeURIComponent(id)}`);

      let response = await sendLabMasterPayload(url, "PUT", payload);
      if (!response.ok) throw new Error(await getErrorMessage(response, "Unable to update lab file record."));

      toast.success("Lab file record updated successfully.");
      const updatedRows = rows.map((row) =>
        String(getLabFileId(row)) === String(id) ? { ...row, ...payload } : row
      );
      saveImportedLabFileRows(updatedRows);
      setRows(updatedRows);
      closeForm();
      await loadRows();
    } catch (error) {
      toast.error(error.message || "Unable to update lab file record.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!canDelete) {
      toast.error("You do not have permission to delete lab files.");
      return;
    }
    const id = getLabFileId(row);
    if (!id) {
      toast.error("Lab file record id is missing.");
      return;
    }
    if (!window.confirm("Delete this lab file record?")) return;

    try {
      const response = await fetch(apiUrl(`Lab/master/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: getApiHeaders(),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response, "Unable to delete lab file record."));
      toast.success("Lab file record deleted successfully.");
      const nextRows = rows.filter((row) => String(getLabFileId(row)) !== String(id));
      saveImportedLabFileRows(nextRows);
      setRows(nextRows);
      await loadRows();
    } catch (error) {
      toast.error(error.message || "Unable to delete lab file record.");
    }
  };

  return (
    <div className="receptionists-page lab-files-page">
      <div className="receptionists-header">
        <div>
          <h2>Lab Files</h2>
          <p>{loading ? "Loading lab files..." : `${filteredRows.length} lab file records available for lab module`}</p>
        </div>
        <div className="receptionists-header-actions">
          <button type="button" className="receptionists-icon-button" onClick={loadRows} disabled={loading} title="Refresh lab files"><RefreshCw size={16} /></button>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={handleImport} />
          <button type="button" className="receptionists-primary-button" onClick={() => fileInputRef.current?.click()} disabled={uploading || !canCreate}><Upload size={16} /> {uploading ? "Importing..." : "Import File"}</button>
          <button type="button" className="receptionists-primary-button lab-files-export" onClick={handleExport}><Download size={16} /> Export File</button>
          <button type="button" className="receptionists-primary-button lab-files-add" onClick={openAdd} disabled={!canCreate}><Plus size={16} /> Add Test</button>
        </div>
      </div>

      <div className="receptionists-toolbar">
        <label className="receptionists-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lab file data..." /></label>
      </div>

      <div className="lab-files-table">
        <div className="lab-files-head"><span>Test</span><span>Code</span><span>Category</span><span>Sample</span><span>Price</span><span>Status</span><span>Actions</span></div>
        {!loading && filteredRows.length === 0 ? <div className="receptionists-empty">No lab file data found.</div> : null}
        {filteredRows.map((row, index) => (
          <div className="lab-files-row" key={readFirst(row, ["id", "Id", "testId", "TestId", "testCode"], index)}>
            <span>{readFirst(row, ["testName", "TestName", "name", "Name"])}</span>
            <span>{readFirst(row, ["testCode", "TestCode", "code", "Code"])}</span>
            <span>{readFirst(row, ["category", "Category"])}</span>
            <span>{readFirst(row, ["sampleType", "SampleType"])}</span>
            <span>{readFirst(row, ["price", "Price", "amount", "Amount"], "0")}</span>
            <span>{String(readFirst(row, ["isActive", "IsActive"], true)) === "false" ? "Inactive" : "Active"}</span>
            <span className="lab-files-actions">
              <ActionsGroup
                rowId={readFirst(row, ["id", "Id", "testId", "TestId", "testCode"], index)}
                activeActionState={activeActionState}
                setActiveActionState={setActiveActionState}
                canView={true}
                canEdit={canEdit}
                canStatus={false}
                canDelete={canDelete}
                onView={() => openEdit(row)}
                onEdit={() => openEdit(row)}
                onDelete={() => handleDelete(row)}
              />
            </span>
          </div>
        ))}
      </div>

      {editingRow || addingRow ? (
        <div className="receptionists-modal-overlay" onClick={closeForm}>
          <form className="receptionists-modal lab-files-modal" onClick={(event) => event.stopPropagation()} onSubmit={addingRow ? handleCreate : handleUpdate}>
            <div className="receptionists-modal-header">
              <div className="receptionists-modal-title">
                <div className="receptionists-modal-icon"><Edit3 size={20} /></div>
                <div><h3>Edit Lab File Record</h3><p>{form.testName || "Lab master test"}</p></div>
              </div>
              <button type="button" className="receptionists-modal-close" onClick={closeForm} disabled={saving}><X size={22} /></button>
            </div>
            <div className="receptionists-form lab-files-form">
              <div className="receptionists-field"><label>Test Name</label><input value={form.testName} onChange={(e) => setField("testName", e.target.value)} required /></div>
              <div className="receptionists-field"><label>Test Code</label><input value={form.testCode} onChange={(e) => setField("testCode", e.target.value)} required /></div>
              <div className="receptionists-field"><label>Category</label><input value={form.category} onChange={(e) => setField("category", e.target.value)} /></div>
              <div className="receptionists-field"><label>Sample Type</label><input value={form.sampleType} onChange={(e) => setField("sampleType", e.target.value)} /></div>
              <div className="receptionists-field"><label>Unit</label><input value={form.unit} onChange={(e) => setField("unit", e.target.value)} /></div>
              <div className="receptionists-field"><label>Reference Range</label><input value={form.referenceRange} onChange={(e) => setField("referenceRange", e.target.value)} /></div>
              <div className="receptionists-field"><label>Price</label><input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setField("price", e.target.value)} required /></div>
              <div className="receptionists-field"><label>Turnaround Hours</label><input type="number" min="0" value={form.turnaroundHours} onChange={(e) => setField("turnaroundHours", e.target.value)} /></div>
              <div className="receptionists-field"><label>Branch Id</label><input type="number" min="0" value={form.branchId} onChange={(e) => setField("branchId", e.target.value)} /></div>
              <div className="receptionists-field"><label>Status</label><select value={form.isActive} onChange={(e) => setField("isActive", e.target.value)}><option value="true">Active</option><option value="false">Inactive</option></select></div>
              <div className="receptionists-field lab-files-wide-field"><label>Instructions</label><textarea value={form.instructions} onChange={(e) => setField("instructions", e.target.value)} rows={3} /></div>
            </div>
            <div className="receptionists-modal-actions">
              <button type="button" className="receptionists-secondary-button" onClick={closeForm} disabled={saving}>Cancel</button>
              <button type="submit" className="receptionists-save-button" disabled={saving || (addingRow ? !canCreate : !canEdit)}><CheckCircle size={16} />{saving ? "Saving..." : addingRow ? "Add Test" : "Update Record"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default LabFiles;

