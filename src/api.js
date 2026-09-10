const API_BASE_URL = import.meta.env.VITE_MAWOS_API_BASE_URL?.replace(/\/$/, "");

const equipment = [
  {
    id: "equipment-compressor-4",
    equipment_code: "EQ-204",
    name: "Compressor 4",
    equipment_type: "Centrifugal compressor",
    location: "Utilities Bay",
    criticality: "critical",
    risk_status: "at_risk",
    is_active: true,
    last_service_date: "2026-01-12",
    parameters: [
      {
        id: "parameter-compressor-temperature",
        parameter_name: "Temperature",
        parameter_type: "temperature",
        unit: "°C",
        threshold_direction: "maximum",
        threshold_value: 80,
        is_active: true
      }
    ]
  },
  {
    id: "equipment-conveyor-2",
    equipment_code: "EQ-118",
    name: "Conveyor 2",
    equipment_type: "Belt conveyor",
    location: "Assembly Line A",
    criticality: "high",
    risk_status: "healthy",
    is_active: true,
    last_service_date: "2026-02-01",
    parameters: [
      {
        id: "parameter-conveyor-temperature",
        parameter_name: "Temperature",
        parameter_type: "temperature",
        unit: "°C",
        threshold_direction: "maximum",
        threshold_value: 80,
        is_active: true
      },
      {
        id: "parameter-conveyor-vibration",
        parameter_name: "Vibration",
        parameter_type: "vibration",
        unit: "mm/s",
        threshold_direction: "maximum",
        threshold_value: 10,
        is_active: true
      }
    ]
  },
  {
    id: "equipment-press-2",
    equipment_code: "EQ-087",
    name: "Press 2",
    equipment_type: "Hydraulic press",
    location: "Press Hall",
    criticality: "high",
    risk_status: "at_risk",
    is_active: true,
    last_service_date: "2026-01-28",
    parameters: [
      {
        id: "parameter-press-vibration",
        parameter_name: "Vibration",
        parameter_type: "vibration",
        unit: "mm/s",
        threshold_direction: "maximum",
        threshold_value: 10,
        is_active: true
      }
    ]
  }
];

const alerts = [
  {
    id: "alert-1042",
    alert_number: "AL-1042",
    equipment_id: "equipment-compressor-4",
    equipment_code: "EQ-204",
    equipment_name: "Compressor 4",
    location: "Utilities Bay",
    equipment_criticality: "critical",
    parameter_name_snapshot: "Temperature",
    unit_snapshot: "°C",
    actual_value: 90,
    threshold_value: 80,
    threshold_direction: "maximum",
    priority: "critical",
    status: "open",
    suggested_action: "Inspect Compressor 4 temperature against the configured safe threshold.",
    breach_time: "2026-02-18T10:42:00Z"
  },
  {
    id: "alert-1038",
    alert_number: "AL-1038",
    equipment_id: "equipment-press-2",
    equipment_code: "EQ-087",
    equipment_name: "Press 2",
    location: "Press Hall",
    equipment_criticality: "high",
    parameter_name_snapshot: "Vibration",
    unit_snapshot: "mm/s",
    actual_value: 12,
    threshold_value: 10,
    threshold_direction: "maximum",
    priority: "high",
    status: "open",
    suggested_action: "Inspect Press 2 vibration and mounting components.",
    breach_time: "2026-02-18T09:20:00Z"
  }
];

let workOrders = [
  {
    id: "work-order-208",
    work_order_number: "WO-208",
    alert_id: "alert-1042",
    equipment_id: "equipment-compressor-4",
    equipment_code: "EQ-204",
    equipment_name: "Compressor 4",
    fault_description: "Temperature reading exceeds safe maximum.",
    parameter_name_snapshot: "Temperature",
    actual_value_snapshot: 90,
    threshold_value_snapshot: 80,
    priority_snapshot: "critical",
    suggested_action_snapshot: "Inspect Compressor 4 temperature against the configured safe threshold.",
    due_date: "2026-02-20",
    status: "in_progress",
    resolution_note: "",
    parts: [
      {
        id: "part-1",
        part_name: "Cooling fan belt",
        availability_status: "in_stock",
        estimated_quantity: 1,
        actual_quantity_used: null,
        unit: "each",
        notes: ""
      }
    ]
  }
];

const delay = (result) =>
  new Promise((resolve) => window.setTimeout(() => resolve(result), 250));

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error?.message || "The MAWOS service could not complete this request.");
  }

  return response.status === 204 ? null : response.json();
}

// PUBLIC_INTERFACE
export const mawosApi = {
  /** Indicates whether the application is connected to a configured MAWOS API. */
  isLive: Boolean(API_BASE_URL),

  /** Lists equipment records visible to the current user. */
  listEquipment: async () => {
    if (API_BASE_URL) return request("/equipment?is_active=true&page_size=100");
    return delay({ items: equipment, page: 1, page_size: 100, total: equipment.length });
  },

  /** Lists maintenance alerts ordered by operational priority. */
  listAlerts: async () => {
    if (API_BASE_URL) return request("/alerts?sort=priority&order=desc&page_size=100");
    return delay({ items: alerts, page: 1, page_size: 100, total: alerts.length });
  },

  /** Lists active and historical work-order records. */
  listWorkOrders: async () => {
    if (API_BASE_URL) return request("/workorders?page_size=100");
    return delay({ items: workOrders, page: 1, page_size: 100, total: workOrders.length });
  },

  /** Submits one immutable reading and returns the server evaluation result. */
  submitReading: async (payload) => {
    if (API_BASE_URL) {
      return request("/readings", { method: "POST", body: JSON.stringify(payload) });
    }

    const selectedEquipment = equipment.find((item) => item.id === payload.equipment_id);
    const parameter = selectedEquipment?.parameters.find((item) => item.id === payload.parameter_id);
    const breached =
      parameter.threshold_direction === "maximum"
        ? payload.logged_value > parameter.threshold_value
        : payload.logged_value < parameter.threshold_value;

    const alert = breached
      ? {
          id: `alert-${Date.now()}`,
          alert_number: `AL-${Math.floor(1000 + Math.random() * 9000)}`,
          equipment_id: selectedEquipment.id,
          equipment_code: selectedEquipment.equipment_code,
          equipment_name: selectedEquipment.name,
          location: selectedEquipment.location,
          equipment_criticality: selectedEquipment.criticality,
          parameter_name_snapshot: parameter.parameter_name,
          unit_snapshot: parameter.unit,
          actual_value: payload.logged_value,
          threshold_value: parameter.threshold_value,
          threshold_direction: parameter.threshold_direction,
          priority: selectedEquipment.criticality === "critical" ? "critical" : "high",
          status: "open",
          suggested_action: `Inspect ${selectedEquipment.name} ${parameter.parameter_name.toLowerCase()} against the configured safe threshold.`,
          breach_time: payload.logged_at
        }
      : null;

    if (alert) {
      alerts.unshift(alert);
      selectedEquipment.risk_status = "at_risk";
    }

    return delay({
      reading: {
        id: `reading-${Date.now()}`,
        ...payload,
        evaluation_result: breached ? "breached" : "within_limit"
      },
      alert,
      equipment_risk_status: selectedEquipment.risk_status
    });
  },

  /** Creates a work order from an open alert. */
  createWorkOrder: async (payload) => {
    if (API_BASE_URL) {
      return request("/workorders", { method: "POST", body: JSON.stringify(payload) });
    }

    const alert = alerts.find((item) => item.id === payload.alert_id);
    if (!alert || alert.status !== "open") {
      throw new Error("This alert is no longer available for work-order creation.");
    }

    const created = {
      id: `work-order-${Date.now()}`,
      work_order_number: `WO-${Math.floor(200 + Math.random() * 700)}`,
      alert_id: alert.id,
      equipment_id: alert.equipment_id,
      equipment_code: alert.equipment_code,
      equipment_name: alert.equipment_name,
      fault_description: payload.fault_description || alert.suggested_action,
      parameter_name_snapshot: alert.parameter_name_snapshot,
      actual_value_snapshot: alert.actual_value,
      threshold_value_snapshot: alert.threshold_value,
      priority_snapshot: alert.priority,
      suggested_action_snapshot: alert.suggested_action,
      due_date: payload.due_date || null,
      status: "open",
      resolution_note: "",
      parts: payload.parts || []
    };

    alert.status = "converted_to_work_order";
    workOrders = [created, ...workOrders];
    return delay(created);
  },

  /** Updates a selected active work order, including its parts checklist or closure evidence. */
  updateWorkOrder: async (id, payload) => {
    if (API_BASE_URL) {
      return request(`/workorders/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    }

    const record = workOrders.find((item) => item.id === id);
    if (!record || record.status === "closed") {
      throw new Error("This work order is no longer available for updates.");
    }

    Object.assign(record, payload);
    return delay(record);
  }
};
