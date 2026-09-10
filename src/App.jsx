import { useEffect, useMemo, useState } from "react";
import { mawosApi } from "./api.js";

const navigation = [
  ["dashboard", "Dashboard", "⌂"],
  ["readings", "Log Reading", "◉"],
  ["alerts", "Alerts", "△"],
  ["workorders", "Work Orders", "✓"],
  ["equipment", "Equipment", "▣"]
];

function titleCase(value) {
  return value?.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "—";
}

function formatDate(value, includeTime = false) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(new Date(value));
}

function StatusBadge({ value, type = "status" }) {
  return <span className={`badge ${type} ${value}`}>{titleCase(value)}</span>;
}

function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}

function LoadingState({ label = "Loading maintenance data…" }) {
  return <div className="loading-state" role="status">{label}</div>;
}

function Toast({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      <button type="button" aria-label="Dismiss message" onClick={onDismiss}>×</button>
    </div>
  );
}

function Dashboard({ equipment, alerts, workOrders, onNavigate, loading }) {
  const atRisk = equipment.filter((item) => item.risk_status === "at_risk");
  const activeOrders = workOrders.filter((item) => item.status !== "closed");

  if (loading) return <LoadingState />;

  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operations overview</p>
          <h1>Maintenance command center</h1>
          <p>Prioritize conditions that require action and keep essential maintenance work moving.</p>
        </div>
        <button className="button primary" onClick={() => onNavigate("readings")}>Log a reading</button>
      </div>

      <div className="metric-grid">
        <article className="metric-card risk-card">
          <span>Equipment at risk</span><strong>{atRisk.length}</strong>
          <button onClick={() => onNavigate("equipment")}>Review equipment →</button>
        </article>
        <article className="metric-card alert-card">
          <span>Open alerts</span><strong>{alerts.filter((item) => item.status === "open").length}</strong>
          <button onClick={() => onNavigate("alerts")}>Open alert queue →</button>
        </article>
        <article className="metric-card work-card">
          <span>Active work orders</span><strong>{activeOrders.length}</strong>
          <button onClick={() => onNavigate("workorders")}>Review work orders →</button>
        </article>
      </div>

      <div className="content-grid">
        <article className="panel">
          <div className="panel-heading"><div><h2>At-risk equipment</h2><p>Server-reported equipment risk status.</p></div><button onClick={() => onNavigate("equipment")}>View all</button></div>
          {atRisk.length ? atRisk.map((item) => (
            <div className="list-row" key={item.id}>
              <div className="asset-avatar">{item.equipment_code.slice(-3)}</div>
              <div className="row-main"><strong>{item.equipment_code} · {item.name}</strong><span>{item.location} · {titleCase(item.criticality)}</span></div>
              <StatusBadge value={item.risk_status} />
            </div>
          )) : <EmptyState title="No equipment is currently at risk.">New server evaluations will appear here.</EmptyState>}
        </article>

        <article className="panel">
          <div className="panel-heading"><div><h2>Priority alerts</h2><p>Open alerts ordered by priority.</p></div><button onClick={() => onNavigate("alerts")}>View queue</button></div>
          {alerts.filter((item) => item.status === "open").slice(0, 3).map((item) => (
            <div className="list-row" key={item.id}>
              <div className="row-main"><strong>{item.alert_number} · {item.equipment_name}</strong><span>{item.parameter_name_snapshot}: {item.actual_value} / {item.threshold_value} {item.unit_snapshot}</span></div>
              <StatusBadge value={item.priority} type="priority" />
            </div>
          ))}
        </article>
      </div>
    </section>
  );
}

function ReadingsPage({ equipment, onReadingSubmitted, loading }) {
  const [selectedId, setSelectedId] = useState("");
  const [parameterId, setParameterId] = useState("");
  const [value, setValue] = useState("");
  const [observedAt, setObservedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedEquipment = equipment.find((item) => item.id === selectedId);
  const selectedParameter = selectedEquipment?.parameters.find((item) => item.id === parameterId);

  useEffect(() => setParameterId(""), [selectedId]);

  async function submit(event) {
    event.preventDefault();
    if (!selectedEquipment || !selectedParameter || value === "") {
      setError("Select active equipment and a parameter, then enter a numeric value.");
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const result = await mawosApi.submitReading({
        equipment_id: selectedEquipment.id,
        parameter_id: selectedParameter.id,
        logged_value: Number(value),
        unit: selectedParameter.unit,
        logged_at: new Date(observedAt).toISOString(),
        note: note.trim() || undefined
      });
      onReadingSubmitted(result, selectedEquipment);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading active equipment…" />;

  return (
    <section className="page reading-layout">
      <div className="page-heading">
        <div><p className="eyebrow">Manual condition monitoring</p><h1>Log a condition reading</h1><p>MAWOS saves and evaluates every reading as one committed operation.</p></div>
      </div>
      <form className="form-card" onSubmit={submit} noValidate>
        {error && <div className="form-error" role="alert"><strong>Review the reading details.</strong><span>{error}</span></div>}
        <fieldset disabled={submitting}>
          <label>
            Active equipment <span aria-hidden="true">*</span>
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">Select equipment</option>
              {equipment.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.equipment_code} — {item.name} ({item.location})</option>)}
            </select>
          </label>

          {selectedEquipment && <div className="selection-context">
            <div><span>Selected equipment</span><strong>{selectedEquipment.equipment_code} — {selectedEquipment.name}</strong><small>{selectedEquipment.location} · {titleCase(selectedEquipment.criticality)}</small></div>
            <StatusBadge value={selectedEquipment.risk_status} />
          </div>}

          <div className="form-row">
            <label>
              Parameter <span aria-hidden="true">*</span>
              <select value={parameterId} onChange={(event) => setParameterId(event.target.value)} disabled={!selectedEquipment}>
                <option value="">Select parameter</option>
                {selectedEquipment?.parameters.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.parameter_name} — {item.threshold_direction === "maximum" ? "Maximum" : "Minimum"} {item.threshold_value} {item.unit}</option>)}
              </select>
            </label>
            <label>
              Current value <span aria-hidden="true">*</span>
              <input type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Enter measured value" />
              {selectedParameter && <small>Configured unit: {selectedParameter.unit}</small>}
            </label>
          </div>
          {selectedParameter && <p className="field-help">Configured safe {selectedParameter.threshold_direction}: <strong>{selectedParameter.threshold_value} {selectedParameter.unit}</strong>. Threshold evaluation is performed by MAWOS after saving.</p>}
          <div className="form-row">
            <label>Observed at <span aria-hidden="true">*</span><input type="datetime-local" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} /></label>
            <label>Operator note <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional observation or context" rows="2" /></label>
          </div>
        </fieldset>
        <div className="form-actions"><span>Committed readings cannot be edited or deleted.</span><button className="button primary" type="submit" disabled={submitting}>{submitting ? "Saving and evaluating…" : "Submit and evaluate"}</button></div>
      </form>
    </section>
  );
}

function ReadingResult({ result, equipment, onNavigate, onReset }) {
  const breached = result.reading.evaluation_result === "breached";
  return (
    <section className="page result-page">
      <article className={`result-card ${breached ? "breached" : "within-limit"}`}>
        <p className="eyebrow">{breached ? "Threshold breached" : "Reading recorded"}</p>
        <h1>{breached ? "Maintenance attention is required" : "The reading is within its configured limit"}</h1>
        <p>The reading was committed and evaluated by MAWOS. {breached ? "The server returned the active maintenance alert below." : "No alert was created for this reading."}</p>
        <div className="evidence-grid">
          <div><span>Equipment</span><strong>{equipment.equipment_code} — {equipment.name}</strong></div>
          <div><span>Parameter</span><strong>{result.reading.parameter_id.includes("temperature") ? "Temperature" : "Selected parameter"}</strong></div>
          <div><span>Recorded reading</span><strong>{result.reading.logged_value} {result.reading.unit}</strong></div>
          <div><span>Equipment risk</span><StatusBadge value={result.equipment_risk_status} /></div>
        </div>
        {result.alert && <div className="alert-result"><div><StatusBadge value={result.alert.priority} type="priority" /><strong>{result.alert.alert_number} · {titleCase(result.alert.status)}</strong></div><p>{result.alert.suggested_action}</p></div>}
        <div className="result-actions"><button className="button secondary" onClick={onReset}>Log another reading</button>{result.alert && <button className="button primary" onClick={() => onNavigate("alerts", result.alert.id)}>View alert</button>}</div>
      </article>
    </section>
  );
}

function AlertsPage({ alerts, onCreateWorkOrder, loading }) {
  const [filter, setFilter] = useState("open");
  const displayed = alerts.filter((item) => filter === "all" || item.status === filter);
  if (loading) return <LoadingState label="Loading alert queue…" />;

  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">Triage queue</p><h1>Maintenance alerts</h1><p>Alert priority and lifecycle are evaluated by the server.</p></div></div>
      <div className="filter-bar"><label>Lifecycle status <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="open">Open</option><option value="all">All statuses</option><option value="converted_to_work_order">Converted to work order</option><option value="resolved">Resolved</option></select></label></div>
      <article className="table-card">
        <div className="table-scroll"><table><thead><tr><th>Priority</th><th>Alert</th><th>Equipment</th><th>Breach evidence</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{displayed.map((alert) => <tr key={alert.id}><td><StatusBadge value={alert.priority} type="priority" /></td><td><strong>{alert.alert_number}</strong><small>{formatDate(alert.breach_time, true)}</small></td><td><strong>{alert.equipment_code}</strong><small>{alert.equipment_name} · {alert.location}</small></td><td>{alert.parameter_name_snapshot}<small>{alert.actual_value} / {alert.threshold_value} {alert.unit_snapshot}</small></td><td><StatusBadge value={alert.status} /></td><td>{alert.status === "open" && <button className="button small primary" onClick={() => onCreateWorkOrder(alert)}>Create work order</button>}</td></tr>)}</tbody>
        </table></div>
        {!displayed.length && <EmptyState title="No alerts match these filters.">Change the lifecycle filter to inspect other alert records.</EmptyState>}
      </article>
    </section>
  );
}

function WorkOrdersPage({ workOrders, onUpdate, loading }) {
  const [selectedId, setSelectedId] = useState("");
  const selected = workOrders.find((item) => item.id === selectedId);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(selected ? structuredClone(selected) : null);
    setError("");
  }, [selected]);

  async function save(close = false) {
    if (!draft) return;
    if (close && (!draft.resolution_note?.trim() || !draft.parts.some((part) => Number(part.actual_quantity_used) > 0))) {
      setError("Closure requires a resolution note and at least one part with a positive actual quantity used.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const update = {
        status: close ? "closed" : draft.status,
        resolution_note: draft.resolution_note || undefined,
        parts: draft.parts.map(({ id, ...part }) => part)
      };
      await onUpdate(draft.id, update);
      if (close) setSelectedId("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState label="Loading work-order queue…" />;

  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">Maintenance execution</p><h1>Work orders</h1><p>Select a listed record to update its checklist and closure evidence.</p></div></div>
      <div className="work-order-layout">
        <article className="table-card compact-table"><div className="table-scroll"><table><thead><tr><th>Work order</th><th>Equipment</th><th>Status</th></tr></thead><tbody>{workOrders.map((order) => <tr className={selectedId === order.id ? "selected-row" : ""} key={order.id} onClick={() => setSelectedId(order.id)}><td><strong>{order.work_order_number}</strong><small>Due {formatDate(order.due_date)}</small></td><td>{order.equipment_code}<small>{order.equipment_name}</small></td><td><StatusBadge value={order.status} /></td></tr>)}</tbody></table></div></article>
        {draft ? <article className="editor-card">
          <div className="editor-heading"><div><p className="eyebrow">Selected work order</p><h2>{draft.work_order_number} · {draft.equipment_name}</h2><p>{draft.parameter_name_snapshot}: {draft.actual_value_snapshot} / {draft.threshold_value_snapshot}</p></div><StatusBadge value={draft.status} /></div>
          {error && <div className="form-error" role="alert">{error}</div>}
          {draft.status === "closed" ? <div className="closed-summary"><strong>Closed work orders are read-only.</strong><p>{draft.resolution_note || "Closure evidence was recorded."}</p></div> : <>
            <label>Execution status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="open">Open</option><option value="in_progress">In progress</option></select></label>
            <label>Resolution note<textarea rows="3" value={draft.resolution_note || ""} onChange={(event) => setDraft({ ...draft, resolution_note: event.target.value })} placeholder="Describe the completed maintenance result" /></label>
            <div className="parts-heading"><div><h3>Parts checklist</h3><p>Availability is a recorded assessment, not a live inventory balance.</p></div><button className="button small secondary" onClick={() => setDraft({ ...draft, parts: [...draft.parts, { part_name: "", availability_status: "in_stock", estimated_quantity: "", actual_quantity_used: "", unit: "each", notes: "" }] })}>Add part</button></div>
            {draft.parts.map((part, index) => <div className="part-row" key={part.id || index}><input aria-label={`Part ${index + 1} name`} value={part.part_name} placeholder="Part name" onChange={(event) => { const parts = [...draft.parts]; parts[index] = { ...part, part_name: event.target.value }; setDraft({ ...draft, parts }); }} /><select aria-label={`Part ${index + 1} availability`} value={part.availability_status} onChange={(event) => { const parts = [...draft.parts]; parts[index] = { ...part, availability_status: event.target.value }; setDraft({ ...draft, parts }); }}><option value="in_stock">In stock</option><option value="not_in_stock">Not in stock</option><option value="ordered">Ordered</option></select><input aria-label={`Part ${index + 1} actual quantity`} type="number" min="0" step="any" value={part.actual_quantity_used ?? ""} placeholder="Used" onChange={(event) => { const parts = [...draft.parts]; parts[index] = { ...part, actual_quantity_used: event.target.value }; setDraft({ ...draft, parts }); }} /><span>{part.unit}</span></div>)}
            <div className="editor-actions"><button className="button secondary" disabled={saving} onClick={() => save(false)}>Save changes</button><button className="button primary" disabled={saving} onClick={() => save(true)}>{saving ? "Saving…" : "Close work order"}</button></div>
          </>}
        </article> : <EmptyState title="Select a work order.">The editor uses a selected record from the documented list endpoint; MAWOS does not assume an undocumented work-order detail endpoint.</EmptyState>}
      </div>
    </section>
  );
}

function EquipmentPage({ equipment, loading }) {
  if (loading) return <LoadingState label="Loading equipment register…" />;
  return <section className="page"><div className="page-heading"><div><p className="eyebrow">Asset register</p><h1>Equipment</h1><p>Equipment configuration is server-managed and available to authorized maintenance engineers.</p></div></div><article className="table-card"><div className="table-scroll"><table><thead><tr><th>Equipment</th><th>Location</th><th>Criticality</th><th>Last service</th><th>Risk</th></tr></thead><tbody>{equipment.map((item) => <tr key={item.id}><td><strong>{item.equipment_code}</strong><small>{item.name}</small></td><td>{item.location}</td><td>{titleCase(item.criticality)}</td><td>{formatDate(item.last_service_date)}</td><td><StatusBadge value={item.risk_status} /></td></tr>)}</tbody></table></div></article></section>;
}

function WorkOrderModal({ alert, onClose, onCreated }) {
  const [faultDescription, setFaultDescription] = useState(alert.suggested_action);
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const workOrder = await mawosApi.createWorkOrder({ alert_id: alert.id, due_date: dueDate || null, fault_description: faultDescription });
      onCreated(workOrder);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop" role="presentation"><form className="modal" onSubmit={create} role="dialog" aria-modal="true" aria-labelledby="work-order-title"><div className="modal-heading"><div><p className="eyebrow">Create work order</p><h2 id="work-order-title">From {alert.alert_number}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div><div className="inherited-context"><strong>{alert.equipment_code} — {alert.equipment_name}</strong><span>{alert.parameter_name_snapshot}: {alert.actual_value} / {alert.threshold_value} {alert.unit_snapshot}</span><span>{alert.suggested_action}</span></div>{error && <div className="form-error" role="alert">{error}</div>}<label>Fault description <textarea required rows="3" value={faultDescription} onChange={(event) => setFaultDescription(event.target.value)} /></label><label>Due date <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label><p className="modal-note">Creating this order converts the alert to a work-order lifecycle state.</p><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? "Creating…" : "Create work order"}</button></div></form></div>;
}

// PUBLIC_INTERFACE
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [data, setData] = useState({ equipment: [], alerts: [], workOrders: [] });
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState(null);
  const [modalAlert, setModalAlert] = useState(null);
  const [toast, setToast] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const [equipmentResponse, alertResponse, workOrderResponse] = await Promise.all([mawosApi.listEquipment(), mawosApi.listAlerts(), mawosApi.listWorkOrders()]);
      setData({ equipment: equipmentResponse.items, alerts: alertResponse.items, workOrders: workOrderResponse.items });
    } catch (error) {
      setToast(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const content = useMemo(() => {
    if (result) return <ReadingResult result={result.result} equipment={result.equipment} onNavigate={setPage} onReset={() => { setResult(null); setPage("readings"); }} />;
    if (page === "dashboard") return <Dashboard {...data} loading={loading} onNavigate={setPage} />;
    if (page === "readings") return <ReadingsPage equipment={data.equipment} loading={loading} onReadingSubmitted={(readingResult, equipment) => { setResult({ result: readingResult, equipment }); refresh(); }} />;
    if (page === "alerts") return <AlertsPage alerts={data.alerts} loading={loading} onCreateWorkOrder={setModalAlert} />;
    if (page === "workorders") return <WorkOrdersPage workOrders={data.workOrders} loading={loading} onUpdate={async (id, update) => { const response = await mawosApi.updateWorkOrder(id, update); await refresh(); setToast(`${response.work_order_number || "Work order"} updated successfully.`); }} />;
    return <EquipmentPage equipment={data.equipment} loading={loading} />;
  }, [page, result, data, loading]);

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">M</span><div><strong>MAWOS</strong><small>Maintenance operations</small></div></div><nav aria-label="Primary navigation">{navigation.map(([key, label, icon]) => <button key={key} className={page === key && !result ? "nav-item active" : "nav-item"} onClick={() => { setResult(null); setPage(key); }}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav><div className="sidebar-footer"><span className="live-dot"></span>{mawosApi.isLive ? "Connected to MAWOS API" : "Demonstration workspace"}</div></aside><main className="main-content"><header className="topbar"><div><span className="plant-label">North Plant</span><span className="topbar-separator">/</span><span>Maintenance workspace</span></div><div className="user-chip"><span>ME</span><div><strong>Maintenance Engineer</strong><small>Operational role</small></div></div></header>{content}</main>{modalAlert && <WorkOrderModal alert={modalAlert} onClose={() => setModalAlert(null)} onCreated={(order) => { setModalAlert(null); setToast(`${order.work_order_number || "Work order"} created. The alert is now converted.`); setPage("workorders"); refresh(); }} />}<Toast message={toast} onDismiss={() => setToast("")} /></div>;
}
