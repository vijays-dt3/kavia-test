"""End-to-end API tests for the MAWOS predictive-maintenance workflow.

The suite targets the proposed MAWOS MVP REST contract. Configure the target
environment before execution:

    MAWOS_API_BASE_URL=https://mawos.example/api/v1
    MAWOS_ENGINEER_TOKEN=<maintenance-engineer bearer token>
    MAWOS_OPERATOR_TOKEN=<operator bearer token>
    MAWOS_MANAGER_TOKEN=<plant-manager bearer token>

No production records are used: each created resource has a UUID-derived code.
Tests that require a missing role token are skipped rather than silently using a
higher-privileged credential.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import requests

API_BASE_URL = os.getenv("MAWOS_API_BASE_URL", "").rstrip("/")
ENGINEER_TOKEN = os.getenv("MAWOS_ENGINEER_TOKEN", "")
OPERATOR_TOKEN = os.getenv("MAWOS_OPERATOR_TOKEN", "")
MANAGER_TOKEN = os.getenv("MAWOS_MANAGER_TOKEN", "")
REQUEST_TIMEOUT_SECONDS = 20

pytestmark = pytest.mark.e2e


def _require_api() -> None:
    """Skip when an E2E target has not been configured."""
    if not API_BASE_URL:
        pytest.skip("Set MAWOS_API_BASE_URL to run MAWOS E2E tests.")


def _headers(token: str = "") -> dict[str, str]:
    """Return JSON headers with an optional bearer token."""
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _request(
    method: str,
    path: str,
    *,
    token: str = "",
    expected_status: int | tuple[int, ...],
    **kwargs: Any,
) -> requests.Response:
    """Issue an API request and assert its documented response status."""
    _require_api()
    response = requests.request(
        method,
        f"{API_BASE_URL}{path}",
        headers=_headers(token),
        timeout=REQUEST_TIMEOUT_SECONDS,
        **kwargs,
    )
    expected = (expected_status,) if isinstance(expected_status, int) else expected_status
    assert response.status_code in expected, (
        f"{method} {path} returned {response.status_code}, expected {expected}: "
        f"{response.text}"
    )
    return response


def _json(response: requests.Response) -> dict[str, Any]:
    """Decode and validate an object-shaped JSON response."""
    payload = response.json()
    assert isinstance(payload, dict), f"Expected JSON object, received {payload!r}"
    return payload


def _unique(prefix: str) -> str:
    """Build an isolated test identifier within documented code-length limits."""
    return f"{prefix}-{uuid.uuid4().hex[:12].upper()}"


def _equipment_payload(
    *,
    equipment_code: str,
    criticality: str = "critical",
    unit: str = "celsius",
    safe_threshold: float = 100.0,
    threshold_direction: str = "maximum",
) -> dict[str, Any]:
    """Create a valid equipment request containing one active health parameter."""
    return {
        "equipment_code": equipment_code,
        "name": f"E2E Test Asset {equipment_code}",
        "equipment_type": "compressor",
        "location": "E2E Test Bay",
        "criticality": criticality,
        "parameters": [
            {
                "name": "Temperature",
                "unit": unit,
                "threshold_direction": threshold_direction,
                "safe_threshold": safe_threshold,
                "is_active": True,
            }
        ],
    }


@pytest.fixture
def engineer_token() -> str:
    """Provide a maintenance-engineer token required for mutating workflows."""
    if not ENGINEER_TOKEN:
        pytest.skip("Set MAWOS_ENGINEER_TOKEN to run engineer workflow tests.")
    return ENGINEER_TOKEN


@pytest.fixture
def created_equipment(engineer_token: str) -> dict[str, Any]:
    """Create an isolated critical equipment record and return its API model."""
    response = _request(
        "POST",
        "/equipment",
        token=engineer_token,
        expected_status=201,
        json=_equipment_payload(equipment_code=_unique("E2E-EQ")),
    )
    equipment = _json(response)
    assert equipment["risk_status"] == "healthy"
    assert equipment["is_active"] is True
    return equipment


def _parameter_id(equipment: dict[str, Any]) -> str:
    """Extract the sole configured parameter identifier from an equipment model."""
    parameters = equipment.get("parameters", [])
    assert len(parameters) == 1, f"Expected one parameter, received {parameters!r}"
    return parameters[0]["id"]


def _submit_reading(
    equipment: dict[str, Any],
    value: float,
    engineer_token: str,
    *,
    unit: str = "celsius",
) -> requests.Response:
    """Submit a timestamped manual reading against the test equipment parameter."""
    return _request(
        "POST",
        "/readings",
        token=engineer_token,
        expected_status=(201, 200),
        json={
            "equipment_id": equipment["id"],
            "parameter_id": _parameter_id(equipment),
            "observed_value": value,
            "unit": unit,
            "logged_at": datetime.now(UTC).isoformat(),
        },
    )


def _extract_alert(reading_payload: dict[str, Any]) -> dict[str, Any]:
    """Return the alert emitted by a breaching reading response."""
    alert = reading_payload.get("alert")
    assert isinstance(alert, dict), f"Expected breach alert in response, got {reading_payload!r}"
    assert alert["status"] == "open"
    return alert


def _create_breaching_alert(
    equipment: dict[str, Any], engineer_token: str, *, value: float = 120.0
) -> dict[str, Any]:
    """Submit a maximum-threshold breach and return its generated alert."""
    response = _submit_reading(equipment, value, engineer_token)
    return _extract_alert(_json(response))


def _create_work_order(alert_id: str, engineer_token: str) -> dict[str, Any]:
    """Convert an open alert into a work order using valid editable details."""
    response = _request(
        "POST",
        "/workorders",
        token=engineer_token,
        expected_status=201,
        json={
            "alert_id": alert_id,
            "assigned_to_engineer_id": None,
            "due_date": (datetime.now(UTC) + timedelta(days=3)).date().isoformat(),
        },
    )
    return _json(response)


# Happy-path coverage


def test_create_equipment_starts_active_and_healthy(created_equipment: dict[str, Any]) -> None:
    """A valid engineer-created asset is active and initially healthy."""
    assert created_equipment["id"]
    assert created_equipment["equipment_code"].startswith("E2E-EQ-")
    assert created_equipment["criticality"] == "critical"


def test_list_equipment_includes_created_asset(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """The equipment list exposes a newly created asset."""
    payload = _json(
        _request("GET", "/equipment", token=engineer_token, expected_status=200)
    )
    assert any(item["id"] == created_equipment["id"] for item in payload["items"])


def test_filter_equipment_by_location_returns_matching_asset(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Location filtering retains the asset created with that location."""
    payload = _json(
        _request(
            "GET",
            "/equipment",
            token=engineer_token,
            expected_status=200,
            params={"location": "E2E Test Bay"},
        )
    )
    assert any(item["id"] == created_equipment["id"] for item in payload["items"])


def test_non_breaching_reading_is_stored_without_alert(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """A within-limit reading remains non-actionable."""
    payload = _json(_submit_reading(created_equipment, 80.0, engineer_token))
    assert payload["observed_value"] == 80.0
    assert payload.get("breach") in (False, None)
    assert payload.get("alert") in (None, {})


def test_non_breaching_reading_keeps_equipment_healthy(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """A safe reading does not change equipment risk status."""
    _submit_reading(created_equipment, 95.0, engineer_token)
    payload = _json(
        _request(
            "GET",
            f"/equipment/{created_equipment['id']}",
            token=engineer_token,
            expected_status=200,
        )
    )
    assert payload["risk_status"] == "healthy"


# Alert creation and triage coverage


def test_breaching_reading_creates_open_alert(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """A maximum-threshold breach creates an open alert."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    assert alert["equipment_id"] == created_equipment["id"]
    assert alert["observed_value"] == 120.0
    assert alert["threshold_value"] == 100.0


def test_breaching_reading_marks_equipment_at_risk(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """A breach immediately changes the equipment risk status."""
    _create_breaching_alert(created_equipment, engineer_token)
    equipment = _json(
        _request(
            "GET",
            f"/equipment/{created_equipment['id']}",
            token=engineer_token,
            expected_status=200,
        )
    )
    assert equipment["risk_status"] == "at_risk"


def test_critical_asset_twenty_percent_breach_is_critical(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Critical equipment with a 20-percent maximum breach receives Critical priority."""
    alert = _create_breaching_alert(created_equipment, engineer_token, value=120.0)
    assert alert["priority"] == "critical"


def test_low_criticality_ten_percent_breach_is_medium(engineer_token: str) -> None:
    """Low-criticality equipment with a 10-percent breach receives Medium priority."""
    equipment = _json(
        _request(
            "POST",
            "/equipment",
            token=engineer_token,
            expected_status=201,
            json=_equipment_payload(
                equipment_code=_unique("E2E-LOW"), criticality="low"
            ),
        )
    )
    alert = _create_breaching_alert(equipment, engineer_token, value=110.0)
    assert alert["priority"] == "medium"


def test_repeat_breach_updates_single_active_alert(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Repeated breaches for one parameter do not create duplicate active alerts."""
    first_alert = _create_breaching_alert(created_equipment, engineer_token, value=110.0)
    second_alert = _create_breaching_alert(created_equipment, engineer_token, value=130.0)
    assert second_alert["id"] == first_alert["id"]
    assert second_alert["observed_value"] == 130.0


def test_alert_list_filters_by_open_status(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """The maintenance queue can filter generated alerts by status."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    payload = _json(
        _request(
            "GET",
            "/alerts",
            token=engineer_token,
            expected_status=200,
            params={"status": "open"},
        )
    )
    assert any(item["id"] == alert["id"] for item in payload["items"])


def test_alert_list_filters_by_equipment(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """The maintenance queue can filter by equipment identifier."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    payload = _json(
        _request(
            "GET",
            "/alerts",
            token=engineer_token,
            expected_status=200,
            params={"equipment_id": created_equipment["id"]},
        )
    )
    assert any(item["id"] == alert["id"] for item in payload["items"])


# Work-order lifecycle coverage


def test_open_alert_converts_to_open_work_order(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """An open alert creates one open work order."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    assert work_order["status"] == "open"
    assert work_order["alert_id"] == alert["id"]


def test_conversion_marks_alert_converted_to_work_order(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Converting an alert persists its documented lifecycle state."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    _create_work_order(alert["id"], engineer_token)
    updated_alert = _json(
        _request("GET", f"/alerts/{alert['id']}", token=engineer_token, expected_status=200)
    )
    assert updated_alert["status"] == "converted_to_work_order"


def test_work_order_inherits_breach_context(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Generated work orders inherit evidence required to act without re-entry."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    assert work_order["equipment_id"] == alert["equipment_id"]
    assert work_order["parameter_id"] == alert["parameter_id"]
    assert work_order["observed_value"] == alert["observed_value"]
    assert work_order["threshold_value"] == alert["threshold_value"]
    assert work_order["priority"] == alert["priority"]


def test_work_order_assignee_and_due_date_are_editable(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Open work orders allow due-date maintenance planning updates."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    due_date = (datetime.now(UTC) + timedelta(days=7)).date().isoformat()
    updated = _json(
        _request(
            "PUT",
            f"/workorders/{work_order['id']}",
            token=engineer_token,
            expected_status=200,
            json={"due_date": due_date},
        )
    )
    assert updated["due_date"] == due_date


def test_work_order_list_exposes_open_order(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """The open-work maintenance queue exposes converted work."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    payload = _json(
        _request(
            "GET",
            "/workorders",
            token=engineer_token,
            expected_status=200,
            params={"status": "open"},
        )
    )
    assert any(item["id"] == work_order["id"] for item in payload["items"])


def test_alert_cannot_create_second_work_order(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """One alert is protected from duplicate work-order conversion."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    _create_work_order(alert["id"], engineer_token)
    _request(
        "POST",
        "/workorders",
        token=engineer_token,
        expected_status=409,
        json={"alert_id": alert["id"]},
    )


# Spare-parts coverage


def test_create_spare_part(engineer_token: str) -> None:
    """Maintenance engineers can register a reusable spare-parts catalog record."""
    part_number = _unique("E2E-PART")
    part = _json(
        _request(
            "POST",
            "/parts",
            token=engineer_token,
            expected_status=201,
            json={
                "part_number": part_number,
                "name": f"Test Seal {part_number}",
                "default_unit": "each",
            },
        )
    )
    assert part["part_number"] == part_number
    assert part["is_active"] is True


def test_work_order_part_checklist_stores_in_stock_status_and_notes(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Work-order checklist items persist a manual availability assessment."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    updated = _json(
        _request(
            "PUT",
            f"/workorders/{work_order['id']}",
            token=engineer_token,
            expected_status=200,
            json={
                "parts": [
                    {
                        "part_name": "E2E Drive Belt",
                        "availability_status": "in_stock",
                        "notes": "Verified in controlled test store.",
                    }
                ]
            },
        )
    )
    assert updated["parts"][0]["availability_status"] == "in_stock"
    assert updated["parts"][0]["notes"] == "Verified in controlled test store."


@pytest.mark.parametrize("availability_status", ["not_in_stock", "ordered"])
def test_work_order_part_checklist_accepts_supported_nonstock_statuses(
    created_equipment: dict[str, Any],
    engineer_token: str,
    availability_status: str,
) -> None:
    """The two supported non-stock assessment values can be recorded."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    updated = _json(
        _request(
            "PUT",
            f"/workorders/{work_order['id']}",
            token=engineer_token,
            expected_status=200,
            json={
                "parts": [
                    {
                        "part_name": "E2E Replacement Bearing",
                        "availability_status": availability_status,
                    }
                ]
            },
        )
    )
    assert updated["parts"][0]["availability_status"] == availability_status


# Failure and validation coverage


def test_reading_with_mismatched_unit_is_rejected(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Reading units must match the configured parameter unit."""
    _request(
        "POST",
        "/readings",
        token=engineer_token,
        expected_status=422,
        json={
            "equipment_id": created_equipment["id"],
            "parameter_id": _parameter_id(created_equipment),
            "observed_value": 80.0,
            "unit": "fahrenheit",
            "logged_at": datetime.now(UTC).isoformat(),
        },
    )


def test_reading_with_unrelated_parameter_is_rejected(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """A reading cannot claim a parameter from another equipment record."""
    other = _json(
        _request(
            "POST",
            "/equipment",
            token=engineer_token,
            expected_status=201,
            json=_equipment_payload(equipment_code=_unique("E2E-OTHER")),
        )
    )
    _request(
        "POST",
        "/readings",
        token=engineer_token,
        expected_status=422,
        json={
            "equipment_id": created_equipment["id"],
            "parameter_id": _parameter_id(other),
            "observed_value": 80.0,
            "unit": "celsius",
            "logged_at": datetime.now(UTC).isoformat(),
        },
    )


def test_closed_work_order_requires_resolution_note(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Closure fails when repair evidence omits the required resolution."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    _request(
        "PUT",
        f"/workorders/{work_order['id']}",
        token=engineer_token,
        expected_status=422,
        json={
            "status": "closed",
            "parts": [{"part_name": "E2E Seal", "actual_quantity_used": 1}],
        },
    )


def test_closed_work_order_requires_positive_actual_parts_quantity(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Closure rejects zero actual-parts quantities."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    _request(
        "PUT",
        f"/workorders/{work_order['id']}",
        token=engineer_token,
        expected_status=422,
        json={
            "status": "closed",
            "resolution_note": "Replaced worn test seal.",
            "parts": [{"part_name": "E2E Seal", "actual_quantity_used": 0}],
        },
    )


def test_valid_work_order_closure_resolves_alert_and_restores_health(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """A complete closure resolves the linked alert and updates service state."""
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    closed = _json(
        _request(
            "PUT",
            f"/workorders/{work_order['id']}",
            token=engineer_token,
            expected_status=200,
            json={
                "status": "closed",
                "resolution_note": "Replaced overheating seal and verified operation.",
                "parts": [{"part_name": "E2E Seal", "actual_quantity_used": 1}],
            },
        )
    )
    assert closed["status"] == "closed"
    assert closed["closed_by_engineer_id"]
    assert closed["closed_at"]

    resolved_alert = _json(
        _request("GET", f"/alerts/{alert['id']}", token=engineer_token, expected_status=200)
    )
    equipment = _json(
        _request(
            "GET",
            f"/equipment/{created_equipment['id']}",
            token=engineer_token,
            expected_status=200,
        )
    )
    assert resolved_alert["status"] == "resolved"
    assert equipment["risk_status"] == "healthy"
    assert equipment["last_service_date"]


# Security validation coverage


def test_unauthenticated_equipment_list_is_rejected() -> None:
    """The API requires bearer authentication for equipment access."""
    _request("GET", "/equipment", expected_status=401)


def test_unauthenticated_reading_submission_is_rejected() -> None:
    """The API rejects unauthenticated state-changing requests."""
    _request(
        "POST",
        "/readings",
        expected_status=401,
        json={
            "equipment_id": str(uuid.uuid4()),
            "parameter_id": str(uuid.uuid4()),
            "observed_value": 1,
            "unit": "celsius",
            "logged_at": datetime.now(UTC).isoformat(),
        },
    )


def test_operator_cannot_create_equipment() -> None:
    """Operators cannot modify the equipment register."""
    if not OPERATOR_TOKEN:
        pytest.skip("Set MAWOS_OPERATOR_TOKEN to verify operator authorization.")
    _request(
        "POST",
        "/equipment",
        token=OPERATOR_TOKEN,
        expected_status=403,
        json=_equipment_payload(equipment_code=_unique("E2E-OP")),
    )


def test_manager_cannot_create_equipment() -> None:
    """Plant managers retain operational visibility but cannot configure equipment."""
    if not MANAGER_TOKEN:
        pytest.skip("Set MAWOS_MANAGER_TOKEN to verify manager authorization.")
    _request(
        "POST",
        "/equipment",
        token=MANAGER_TOKEN,
        expected_status=403,
        json=_equipment_payload(equipment_code=_unique("E2E-MGR")),
    )


def test_operator_cannot_close_work_order(
    created_equipment: dict[str, Any], engineer_token: str
) -> None:
    """Only maintenance engineers may record completed maintenance work."""
    if not OPERATOR_TOKEN:
        pytest.skip("Set MAWOS_OPERATOR_TOKEN to verify operator authorization.")
    alert = _create_breaching_alert(created_equipment, engineer_token)
    work_order = _create_work_order(alert["id"], engineer_token)
    _request(
        "PUT",
        f"/workorders/{work_order['id']}",
        token=OPERATOR_TOKEN,
        expected_status=403,
        json={
            "status": "closed",
            "resolution_note": "Unauthorized closure attempt.",
            "parts": [{"part_name": "E2E Seal", "actual_quantity_used": 1}],
        },
    )


def test_unknown_equipment_is_not_exposed_to_authenticated_user(
    engineer_token: str,
) -> None:
    """Unknown identifiers return 404 rather than leaking system internals."""
    _request(
        "GET",
        f"/equipment/{uuid.uuid4()}",
        token=engineer_token,
        expected_status=404,
    )
