# This file is used to set-up the 2hire Simulated environment
#
# Docs:
#   https://developer.2hire.io/docs/end-to-end-test
#   https://developer.2hire.io/reference/auth.md
#   https://developer.2hire.io/reference/putregistervehicle.md

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

REGISTRY_PATH = Path(__file__).with_name("2hire_vehicle_registry.json")

TEST_BASE_URL = "https://test.adapter.2hire.io"
E2E_BASE_URL = "https://e2e.adapter.2hire.io"

AUTH_URL = f"{TEST_BASE_URL}/api/v1/auth"
REGISTER_VEHICLE_URL = f"{TEST_BASE_URL}/api/v1/vehicle/register"
DEREGISTER_VEHICLE_URL = f"{TEST_BASE_URL}/api/v1/vehicle/deregister"
CREATE_DEVICE_URL = f"{E2E_BASE_URL}/devices/"

# Fixed profileId the 2hire docs require for 2HIRE_BOARD vehicles registered
# against the simulator (https://developer.2hire.io/docs/end-to-end-test).
SIMULATOR_PROFILE_ID = "51ba5b28-28da-435a-b42e-a3931288470c"

CLIENT_ID = os.environ.get("2HIRE_CLIENT_ID")
CLIENT_SECRET = os.environ.get("2HIRE_CLIENT_SECRET")


class TwoHireAuthError(RuntimeError):
    pass


class TwoHireApiError(RuntimeError):
    pass


@dataclass
class AccessToken:
    value: str
    token_type: str
    expires_at: float  # unix timestamp

    @property
    def is_expired(self) -> bool:
        # Refresh a bit early so a request doesn't race the real expiry.
        return time.time() >= self.expires_at - 30


_cached_token: Optional[AccessToken] = None


def _request_new_token() -> AccessToken:
    if not CLIENT_ID or not CLIENT_SECRET:
        raise TwoHireAuthError(
            "Missing 2HIRE_CLIENT_ID / 2HIRE_CLIENT_SECRET in .env"
        )

    response = requests.post(
        AUTH_URL,
        json={"clientId": CLIENT_ID, "clientSecret": CLIENT_SECRET},
        headers={"Content-Type": "application/json"},
        timeout=10,
    )

    if not response.ok:
        raise TwoHireAuthError(
            f"2hire auth failed ({response.status_code}): {response.text}"
        )

    body = response.json()
    return AccessToken(
        value=body["access_token"],
        token_type=body.get("token_type", "Bearer"),
        expires_at=time.time() + float(body["expires_in"]),
    )


def get_access_token(force_refresh: bool = False) -> AccessToken:
    """Return a cached 2hire access token, fetching a new one if missing/expired."""
    global _cached_token
    if force_refresh or _cached_token is None or _cached_token.is_expired:
        _cached_token = _request_new_token()
    return _cached_token


def get_auth_headers(user: Optional[str] = None, application: Optional[str] = None) -> dict:
    """Build the headers required to call the 2hire test/e2e APIs."""
    token = get_access_token()
    headers = {"Authorization": f"{token.token_type} {token.value}"}
    if user:
        headers["x-user"] = user
    if application:
        headers["x-application"] = application
    return headers


@dataclass
class SimulatedVehicle:
    identifier: str
    qr_code: str
    vehicle_id: Optional[str] = None


def load_registry() -> list:
    """Load the local registry of all simulated vehicles created so far."""
    if not REGISTRY_PATH.exists():
        return []
    with REGISTRY_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_registry(vehicles: list) -> None:
    with REGISTRY_PATH.open("w", encoding="utf-8") as f:
        json.dump(vehicles, f, indent=2, ensure_ascii=False)
        f.write("\n")


def _upsert_registry_entry(identifier: str, qr_code: str, vehicle_id: Optional[str]) -> None:
    """Create or update a vehicle's entry in the local registry, keyed by identifier."""
    vehicles = load_registry()
    for entry in vehicles:
        if entry["identifier"] == identifier:
            entry["qrCode"] = qr_code
            entry["vehicleId"] = vehicle_id
            break
    else:
        vehicles.append(
            {
                "alias": "",
                "identifier": identifier,
                "qrCode": qr_code,
                "vehicleId": vehicle_id,
            }
        )
    save_registry(vehicles)


def create_device() -> SimulatedVehicle:
    """Create a simulated 2hire-box device in the e2e test environment."""
    response = requests.post(
        CREATE_DEVICE_URL,
        json={"connectivityProvider": "2HIRE_BOARD"},
        headers=get_auth_headers(),
        timeout=10,
    )

    if not response.ok:
        raise TwoHireApiError(
            f"Failed to create simulated device ({response.status_code}): {response.text}"
        )

    devices = response.json()["devices"]
    device = devices[0]
    vehicle = SimulatedVehicle(identifier=device["identifier"], qr_code=device["qrCode"])
    _upsert_registry_entry(vehicle.identifier, vehicle.qr_code, vehicle.vehicle_id)
    return vehicle


def register_vehicle(vehicle: SimulatedVehicle) -> SimulatedVehicle:
    """Register a previously created simulated device as a 2HIRE_BOARD vehicle."""
    response = requests.put(
        REGISTER_VEHICLE_URL,
        json={
            "connectivityProvider": "2HIRE_BOARD",
            "data": {
                "qrCode": vehicle.qr_code,
                "profileId": SIMULATOR_PROFILE_ID,
            },
        },
        headers=get_auth_headers(),
        timeout=10,
    )

    if not response.ok:
        raise TwoHireApiError(
            f"Failed to register vehicle ({response.status_code}): {response.text}"
        )

    vehicle.vehicle_id = response.json()["vehicleId"]
    _upsert_registry_entry(vehicle.identifier, vehicle.qr_code, vehicle.vehicle_id)
    return vehicle


def create_simulated_vehicle() -> SimulatedVehicle:
    """Create and register a single simulated vehicle, ready to use in tests."""
    vehicle = create_device()
    return register_vehicle(vehicle)


def get_vehicle_state(identifier: str) -> dict:
    """Fetch the current simulated state (position, autonomy, online, trunk...) of a device."""
    response = requests.get(
        f"{CREATE_DEVICE_URL}{identifier}/state",
        headers=get_auth_headers(),
        timeout=10,
    )

    if not response.ok:
        raise TwoHireApiError(
            f"Failed to get vehicle state ({response.status_code}): {response.text}"
        )

    return response.json()


def send_command(vehicle_id: str, command: str) -> None:
    """Send a generic command ("start", "stop" or "locate") to a registered vehicle."""
    response = requests.post(
        f"{TEST_BASE_URL}/api/v1/vehicle/{vehicle_id}/command/generic/{command}",
        json={},
        headers=get_auth_headers(),
        timeout=10,
    )

    if not response.ok:
        raise TwoHireApiError(
            f"Failed to send command {command!r} to vehicle {vehicle_id} "
            f"({response.status_code}): {response.text}"
        )

    body = response.json()
    if not body.get("success"):
        raise TwoHireApiError(f"Command {command!r} was rejected: {body}")


def start_trip(identifier: str, positions: list) -> None:
    """Simulate a trip for a device through a list of {"latitude", "longitude"} positions.

    The device must be UNLOCKED first (see send_command(vehicle_id, "start")).
    """
    response = requests.post(
        f"{CREATE_DEVICE_URL}{identifier}/trips",
        json={
            "positions": [
                {"longitude": p["longitude"], "latitude": p["latitude"]} for p in positions
            ]
        },
        headers=get_auth_headers(),
        timeout=10,
    )

    if not response.ok:
        raise TwoHireApiError(
            f"Failed to start trip for {identifier} ({response.status_code}): {response.text}"
        )

    body = response.json()
    if not body.get("success"):
        raise TwoHireApiError(f"Trip was rejected: {body}")


def drive_vehicle_to(identifier: str, vehicle_id: str, latitude: float, longitude: float) -> dict:
    """Unlock a vehicle and simulate a trip from its current position to the given one."""
    current_position = get_vehicle_state(identifier)["position"]["data"]

    send_command(vehicle_id, "start")
    start_trip(
        identifier,
        [
            {"latitude": current_position["latitude"], "longitude": current_position["longitude"]},
            {"latitude": latitude, "longitude": longitude},
        ],
    )
    return get_vehicle_state(identifier)


def deregister_vehicle(vehicle_id: str) -> None:
    """Deregister a vehicle (identified by its registration vehicleId) from the test environment."""
    response = requests.put(
        DEREGISTER_VEHICLE_URL,
        json={"vehicleId": vehicle_id},
        headers=get_auth_headers(),
        timeout=10,
    )

    if not response.ok:
        raise TwoHireApiError(
            f"Failed to deregister vehicle {vehicle_id} ({response.status_code}): {response.text}"
        )

    vehicles = load_registry()
    for entry in vehicles:
        if entry.get("vehicleId") == vehicle_id:
            entry["vehicleId"] = None
    save_registry(vehicles)


def print_registry() -> None:
    """Print the local vehicle registry as a table."""
    vehicles = load_registry()
    columns = ["alias", "identifier", "qrCode", "vehicleId"]
    widths = {
        col: max(len(col), *(len(str(v[col] or "")) for v in vehicles)) if vehicles else len(col)
        for col in columns
    }

    header = "  ".join(col.ljust(widths[col]) for col in columns)
    print(header)
    print("  ".join("-" * widths[col] for col in columns))
    for v in vehicles:
        print("  ".join(str(v[col] or "").ljust(widths[col]) for col in columns))


def print_vehicle_states() -> None:
    """Fetch and print the current state of every vehicle in the local registry, one row each."""
    vehicles = load_registry()
    rows = []
    for v in vehicles:
        state = get_vehicle_state(v["identifier"])
        position = state["position"]["data"]
        rows.append(
            {
                "alias": v["alias"],
                "vehicleID": v["vehicleId"],
                "identifier": v["identifier"],
                "status": state["status"],
                "online": state["online"]["data"]["online"],
                "autonomy%": state["autonomy_percentage"]["data"]["percentage"],
                "distance_m": state["distance_covered"]["data"]["meters"],
                "trunk": state.get("trunk_status", {}).get("data"),
                "lat": position["latitude"],
                "lng": position["longitude"],
            }
        )

    columns = ["alias", "vehicleID", "identifier", "status", "online", "autonomy%", "distance_m", "trunk", "lat", "lng"]
    widths = {
        col: max(len(col), *(len(str(r[col])) for r in rows)) if rows else len(col)
        for col in columns
    }

    print("  ".join(col.ljust(widths[col]) for col in columns))
    print("  ".join("-" * widths[col] for col in columns))
    for r in rows:
        print("  ".join(str(r[col]).ljust(widths[col]) for col in columns))


def list_vehicles() -> list:
    """List all simulated devices registered so far in the e2e test environment."""
    response = requests.get(
        CREATE_DEVICE_URL,
        headers=get_auth_headers(),
        timeout=10,
    )

    if not response.ok:
        raise TwoHireApiError(
            f"Failed to list vehicles ({response.status_code}): {response.text}"
        )

    return response.json()["devices"]


if __name__ == "__main__":
    get_auth_headers()
    print("Authenticated with 2hire test environment.")

    # simulated_vehicle = create_simulated_vehicle()
    # print("Created and registered simulated vehicle:")
    # print(f"  identifier: {simulated_vehicle.identifier}")
    # print(f"  qrCode:     {simulated_vehicle.qr_code}")
    # print(f"  vehicleId:  {simulated_vehicle.vehicle_id}")


    registered = [v for v in load_registry() if v["vehicleId"]]
    trip_vehicle = registered[3]
    vehicleState=get_vehicle_state(trip_vehicle["identifier"])
    print(f"Driving vehicle from ({vehicleState['position']['data']['latitude']},{vehicleState['position']['data']['longitude']}) ...")
    print(f"Driving vehicle to (56.19916054980476, 10.174453982538115)...")
    new_state = drive_vehicle_to(
        trip_vehicle["identifier"],
        trip_vehicle["vehicleId"],
        latitude=56.19916054980476,
        longitude=10.174453982538115,
    )
    
    vehicleState=get_vehicle_state(trip_vehicle["identifier"])
    print(f"Vehicle now at ({vehicleState['position']['data']['latitude']},{vehicleState['position']['data']['longitude']}) ...")

    print("Vehicles:")
    print_vehicle_states()

#    print("New state:")
#    print(new_state)

#    print_registry()