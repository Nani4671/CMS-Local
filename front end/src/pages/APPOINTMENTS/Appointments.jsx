import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ActionsGroup } from "../../components/ActionsGroup";
import "./Appointments.css";

import {
  Eye,
  Search,
  X,
} from "lucide-react";

import AppointmentModal from "./AppointmentModal";
import { apiUrl } from "../../config/api";
import { formatDateMMDDYYYY } from "../../utils/dateFormat";
import {
  buildBranchOptions,
  fetchBranchesForHospital,
  getRecordBranchIds,
  getStoredHospitalId,
} from "../../utils/branchApi";

// ================= API =================

const APPOINTMENT_API =
  apiUrl("Appointment");

// ================= FORMAT =================

const emptyValue = "-";

const getDateKey = (value) => {
  if (!value)
    return "";

  const raw = String(value).trim();
  const isoDateTimeMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoDateTimeMatch) {
    const [, year, month, day, hour, minute, second = "00"] = isoDateTimeMatch;
    if (hour === "00" && minute === "00" && second === "00")
      return `${year}-${month}-${day}`;

    const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const date = new Date(hasTimezone ? raw : `${raw}Z`);
    if (!Number.isNaN(date.getTime())) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
  }

  return raw.split("T")[0];
};

const formatDate = (value) => formatDateMMDDYYYY(value, emptyValue);

const formatTime = (value) => {
  if (!value) return emptyValue;

  const raw = String(value).trim();
  const ampmMatch = raw.match(/\b(am|pm)\b$/i);
  let suffix = "";
  let timePart = raw;

  if (ampmMatch) {
    suffix = ampmMatch[1].toUpperCase();
    timePart = raw.replace(/\b(am|pm)\b$/i, "").trim();
  }

  const [hourValue, minuteValueRaw = "00"] = String(timePart).split(":");
  const hour = Number(hourValue);
  if (Number.isNaN(hour)) return raw || emptyValue;

  if (!suffix) suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  const minuteValue = String(minuteValueRaw).replace(/[^0-9]/g, "");

  return `${String(displayHour).padStart(2, "0")}:${minuteValue.padStart(2, "0")} ${suffix}`;
};

const getAppointmentBranchIds = (appointment = {}) => [
  ...getRecordBranchIds(appointment),
  ...getRecordBranchIds(appointment.patient || {}),
  ...getRecordBranchIds(appointment.doctor || {}),
]
  .map((value) => String(value ?? "").trim())
  .filter(Boolean);

const getAppointmentBranchName = (appointment = {}, branchNameById = {}) => {
  const directName =
    appointment.branchName ||
    appointment.BranchName ||
    appointment.clinicBranchName ||
    appointment.ClinicBranchName ||
    appointment.branch?.name ||
    appointment.branch?.branchName ||
    appointment.Branch?.name ||
    appointment.patient?.branchName ||
    appointment.patient?.BranchName ||
    appointment.patient?.branch?.name ||
    appointment.doctor?.branchName ||
    appointment.doctor?.BranchName ||
    appointment.doctor?.branch?.name ||
    "";

  if (directName) return directName;

  const branchId = getAppointmentBranchIds(appointment)[0];
  return branchId ? branchNameById[String(branchId)] || "-" : "-";
};

const getInitials = (name) => {
  return (
    name
      ?.split(" ")
      ?.filter(Boolean)
      ?.map((part) => part[0])
      ?.join("")
      ?.slice(0, 2)
      ?.toUpperCase() || "P"
  );
};

const normalizeAppointment = (item) => {
  const patientName =
    item.patientName ||
    item.patient?.name ||
    emptyValue;

  const doctorName =
    item.doctorName ||
    item.doctor?.name ||
    emptyValue;

  const date =
    item.date ||
    item.Date ||
    item.appointmentDate ||
    item.AppointmentDate ||
    item.scheduledDate ||
    item.ScheduledDate ||
    item.slotDate ||
    item.SlotDate ||
    "";

  const appointmentId =
    item.appointmentId ||
    item.id ||
    item.tokenNumber;

  return {
    ...item,
    appointmentId,
    date,
    dateKey: getDateKey(date),
    displayDate: formatDate(date),
    displayTime: formatTime(
      item.time ||
      item.Time ||
      item.startTime ||
      item.StartTime ||
      item.slotTime ||
      item.SlotTime ||
      item.timeSlot ||
      item.TimeSlot
    ),
    tokenNumber:
      item.tokenNumber ||
      item.token ||
      (appointmentId ? `APT-${appointmentId}` : emptyValue),
    chiefComplaints:
      item.chiefComplaints ||
      item.complaint ||
      item.reason ||
      emptyValue,
    status:
      item.status ||
      "Scheduled",
    patient: {
      ...item.patient,
      name: patientName,
      code:
        item.patientCode ||
        item.patient?.code ||
        item.patient?.patientCode ||
        emptyValue,
      age:
        item.age ??
        item.patient?.age ??
        emptyValue,
      gender:
        item.gender ||
        item.patient?.gender ||
        emptyValue,
      phone:
        item.phone ||
        item.patient?.phone ||
        emptyValue,
      email:
        item.patient?.email ||
        item.email ||
        emptyValue,
    },
    doctor: {
      ...item.doctor,
      name: doctorName,
      specialization:
        item.doctorSpecialization ||
        item.doctor?.specialization ||
        emptyValue,
    },
    vitals: {
      bloodPressure:
        item.bloodPressure ||
        emptyValue,
      sugarLevel:
        item.sugarLevel ||
        emptyValue,
      temperature:
        item.temperature ||
        emptyValue,
      weight:
        item.weight ||
        emptyValue,
      pulseRate:
        item.pulseRate ||
        emptyValue,
      respiratoryRate:
        item.respiratoryRate ||
        emptyValue,
    },
  };
};

// ================= PARSE =================

const parseAppointments = (data) => {
  const records =
    Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : [];

  return records
    .filter(Boolean)
    .map(normalizeAppointment);
};

function Appointments() {

  const [selected, setSelected] =
    useState(null);
  const [activeActionState, setActiveActionState] = useState(null);

  const [appointments, setAppointments] =
    useState([]);
  const [clinics, setClinics] = useState([]);
  const [branches, setBranches] = useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [dateFilter, setDateFilter] =
    useState("");

  const [doctorFilter, setDoctorFilter] =
    useState("all");
  const [branchFilter, setBranchFilter] =
    useState("all");

  const [search, setSearch] =
    useState("");

  // ================= FETCH =================

  const fetchAppointments =
    useCallback(async () => {

      try {

        setLoading(true);

        setError("");

        const response = await fetch(
          APPOINTMENT_API,
          {
            headers: {
              "ngrok-skip-browser-warning":
                "true",
            },
          }
        );

        if (!response.ok) {
          throw new Error(
            "Unable to load appointments."
          );
        }

        const data =
          await response.json();

        setAppointments(
          parseAppointments(data).filter((appt) => {
            // If clinics list is empty, allow all appointments (fallback)
            if (!clinics || clinics.length === 0) return true;

            const clinicId = String(appt.clinicId || appt.hospitalId || appt.hospital || "").trim();
            const clinicName = String(appt.clinicName || appt.hospitalName || appt.clinic || "").trim().toLowerCase();

            const clinicIds = new Set(clinics.map((c) => String(c.id || c.clinicId || c.hospitalId || "").trim()).filter(Boolean));
            const clinicNames = new Set(clinics.map((c) => String(c.name || c.clinicName || c.hospitalName || "").trim().toLowerCase()).filter(Boolean));

            if (clinicId && clinicIds.has(clinicId)) return true;
            if (clinicName && clinicNames.has(clinicName)) return true;
            return false;
          })
        );

      } catch (error) {

        console.error(error);

        setError(
          error.message ||
          "Unable to load appointments."
        );

      } finally {

        setLoading(false);
      }
    }, [clinics]);

  // ================= LOAD =================

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(apiUrl("Clinics"), { headers: { "ngrok-skip-browser-warning": "true" } });
        if (resp.ok) {
          const body = await resp.json();
          const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
          setClinics(list.map((c) => ({ id: c.id || c.clinicId || c.hospitalId, name: c.name || c.clinicName || c.hospitalName })));
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadBranches = async () => {
      try {
        const list = await fetchBranchesForHospital(getStoredHospitalId());
        if (!cancelled) setBranches(buildBranchOptions(list));
      } catch (error) {
        console.error("Unable to load branches for appointment filter.", error);
      }
    };

    loadBranches();

    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // ================= DOCTOR OPTIONS =================

  const doctorOptions =
    useMemo(() => {

      return [
        ...new Set(
          appointments.map(
            (item) =>
              item.doctor?.name
          )
            .filter(
              (name) =>
                name &&
                name !== emptyValue
            )
        ),
      ].sort();

    }, [appointments]);

  const branchNameById = useMemo(
    () => Object.fromEntries(branches.map((branch) => [String(branch.id), branch.name])),
    [branches]
  );

  // ================= FILTER =================

  const filteredAppointments =
  useMemo(() => {
    const selectedBranch = branches.find((branch) => String(branch.id) === String(branchFilter));
    const selectedBranchName = selectedBranch?.name?.trim().toLowerCase() || "";

    return appointments.filter(
      (item) => {
        const query =
          search
            .trim()
            .toLowerCase();

        const searchableText = [
          item.tokenNumber,
          item.patient?.name,
          item.patient?.code,
          item.patient?.phone,
          item.doctor?.name,
          item.chiefComplaints,
          item.status,
          getAppointmentBranchName(item, branchNameById),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const matchesDate =
          !dateFilter ||
          item.dateKey === dateFilter;

        const matchesDoctor =
          doctorFilter === "all" ||
          item.doctor?.name ===
          doctorFilter;

        const branchIds = getAppointmentBranchIds(item);
        const branchName = getAppointmentBranchName(item, branchNameById).trim().toLowerCase();

        const matchesBranch =
          branchFilter === "all" ||
          branchIds.some((id) => String(id) === String(branchFilter)) ||
          (selectedBranchName && branchName === selectedBranchName);

        const matchesSearch =
          !query ||
          searchableText.includes(query);

        return (
          matchesDate &&
          matchesDoctor &&
          matchesBranch &&
          matchesSearch
        );
      }
    );

  }, [
    appointments,
    branchNameById,
    branches,
    branchFilter,
    dateFilter,
    doctorFilter,
    search,
  ]);
  // ================= STATUS =================

  const getStatusClass =
    (status) => {

      if (
        status === "Completed"
      )
        return "is-completed";

      if (
        status === "Cancelled"
      )
        return "is-cancelled";

      return "is-scheduled";
    };

  const hasFilters =
    Boolean(dateFilter) ||
    doctorFilter !== "all" ||
    branchFilter !== "all" ||
    Boolean(search.trim());

  return (
    <div className="appointments-page">

      {/* HEADER */}

      <div className="appointments-header">

        <div>

          <h2 className="appointments-title">
            Appointments
          </h2>

          <p className="appointments-subtitle">

            {loading
              ? "Loading..."
              : `${filteredAppointments.length} appointments shown`}

          </p>

        </div>
      </div>

      {/* ERROR */}

      {error ? (
        <div className="appointments-empty">
          {error}
        </div>
      ) : null}

      {/* TABLE CARD */}

      <div className="appointments-table-card">

        {/* FILTERS */}

        <div className="appointments-filters">

          {/* SEARCH */}

          <div className="appointments-filter-group appointments-search-group">

            <label>Search</label>

            <div className="appointments-search-bar">

              <Search size={19} />

              <input
                type="search"
                value={search}
                onChange={(e) =>
                  setSearch(
                    e.target.value
                  )
                }
                placeholder="Patient, token, phone..."
              />

            </div>

          </div>

          {/* DATE */}

          <div className="appointments-filter-group">

            <label>Date</label>

            <input
              type="date"
              value={dateFilter}
              onChange={(e) =>
                setDateFilter(
                  e.target.value
                )
              }
            />

          </div>

          {/* DOCTOR */}

          <div className="appointments-filter-group">

            <label>Doctor</label>

            <select
              value={doctorFilter}
              onChange={(e) =>
                setDoctorFilter(
                  e.target.value
                )
              }
            >

              <option value="all">
                All doctors
              </option>

              {doctorOptions.map(
                (doctor) => (

                  <option
                    value={doctor}
                    key={doctor}
                  >
                    Dr. {doctor}
                  </option>
                )
              )}

            </select>

          </div>

          {/* BRANCH */}

          <div className="appointments-filter-group">

            <label>Branch</label>

            <select
              value={branchFilter}
              onChange={(e) =>
                setBranchFilter(
                  e.target.value
                )
              }
            >

              <option value="all">
                All branches
              </option>

              {branches.map(
                (branch) => (

                  <option
                    value={branch.id}
                    key={branch.id}
                  >
                    {branch.name}
                  </option>
                )
              )}

            </select>

          </div>

          {/* CLEAR */}

          <button
            type="button"
            className="appointments-clear-btn"
            disabled={!hasFilters}
            onClick={() => {
              setSearch("");
              setDateFilter("");
              setDoctorFilter("all");
              setBranchFilter("all");
            }}
          >

            <X size={16} />

            <span>Clear</span>

          </button>

        </div>

        <div className="appointments-table-scroll">

          {/* TABLE HEADER */}

          <div className="appointments-thead">

            <span>S.No.</span>

            <span>Patient</span>

            <span>Doctor</span>

            <span>Schedule</span>

            <span>Branch</span>

            <span>Complaint</span>

            <span>Status</span>

            <span>Actions</span>

          </div>

          {/* EMPTY */}

          {!loading &&
            filteredAppointments.length === 0 ? (

            <div className="appointments-empty">
              No appointments found.
            </div>

          ) : null}

          {/* ROWS */}

          {filteredAppointments.map(
            (item, index) => (

              <div
                className="appointments-row"
                key={item.appointmentId}
              >
                <span>{index + 1}</span>

                {/* PATIENT */}

                <div className="appointments-patient-cell">

                  <div className="appointments-avatar">

                    {getInitials(
                      item.patient?.name
                    )}

                  </div>

                  <div className="appointments-cell-stack">

                    <b>
                      {item.patient?.name}
                    </b>

                    <span>
                      {item.tokenNumber}
                    </span>

                    <span>
                      {item.patient?.code}
                    </span>

                  </div>
                </div>

                {/* DOCTOR */}

                <div className="appointments-cell-stack">

                  <b>
                    Dr. {item.doctor?.name}
                  </b>

                  <span>
                    {item.doctor?.specialization}
                  </span>

                </div>

                {/* SCHEDULE */}

                <div className="appointments-cell-stack">

                  <b>
                    {item.displayDate}
                  </b>

                  <span>
                    {item.displayTime}
                  </span>

                </div>

                <span className="appointments-branch-cell">
                  {getAppointmentBranchName(item, branchNameById)}
                </span>

                

                {/* COMPLAINT */}

                <span className="appointments-complaint">
                  {item.chiefComplaints}
                </span>

                {/* STATUS */}

                <span
                  className={`appointments-status-badge ${getStatusClass(
                    item.status
                  )}`}
                >

                  <span className="appointments-status-dot"></span>

                  {item.status}

                </span>

                <div className="appointments-actions">
                  <ActionsGroup
                    rowId={item.appointmentId}
                    activeActionState={activeActionState}
                    setActiveActionState={setActiveActionState}
                    canView={true}
                    canEdit={false}
                    canStatus={false}
                    canDelete={false}
                    onView={() => setSelected(item)}
                  />
                </div>

              </div>
            )
          )}
        </div>
      </div>

      {/* MODAL */}

      {selected && (

        <AppointmentModal
          data={selected}
          onClose={() =>
            setSelected(null)
          }
        />

      )}
    </div>
  );
}

export default Appointments;

