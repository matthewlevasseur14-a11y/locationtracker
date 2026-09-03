let map;
let marker = null;
let accuracyCircle = null;
let watchId = null;
let lastPosition = null;

const $ = (id) => document.getElementById(id);

function setStatus(text, active = false) {
  $("status").textContent = text;
  $("dot").classList.toggle("active", active);
}

function initMap() {
  map = L.map("map", {
    zoomControl: true,
    attributionControl: true
  }).setView([39.8283, -98.5795], 4);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function formatSpeed(mps) {
  if (mps == null || !Number.isFinite(mps)) return "—";
  return `${(mps * 2.236936).toFixed(1)} mph`;
}

function formatHeading(deg) {
  if (deg == null || !Number.isFinite(deg)) return "—";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${directions[Math.round(deg / 45) % 8]} (${Math.round(deg)}°)`;
}

function updatePosition(position) {
  const { latitude, longitude, accuracy, speed, heading } = position.coords;

  $("lat").textContent = latitude.toFixed(6);
  $("lng").textContent = longitude.toFixed(6);
  $("accuracy").textContent = `${Math.round(accuracy)} m`;
  $("speed").textContent = formatSpeed(speed);
  $("heading").textContent = formatHeading(heading);
  $("updated").textContent = new Date(position.timestamp).toLocaleTimeString();

  const point = [latitude, longitude];

  if (!marker) {
    marker = L.marker(point).addTo(map).bindPopup("Your current location");
  } else {
    marker.setLatLng(point);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle(point, {
      radius: accuracy,
      weight: 1
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(point);
    accuracyCircle.setRadius(accuracy);
  }

  // Keep the map centered on the user while tracking.
  map.setView(point, Math.max(map.getZoom(), 16), { animate: true });
  lastPosition = position;
  setStatus("Tracking location", true);
}

function handleError(error) {
  let message = "Unable to get your location.";

  switch (error.code) {
    case error.PERMISSION_DENIED:
      message = "Location permission was denied. Enable Location Services for Safari in iPhone Settings.";
      break;
    case error.POSITION_UNAVAILABLE:
      message = "Location is currently unavailable. Try moving outside or checking Location Services.";
      break;
    case error.TIMEOUT:
      message = "Location request timed out. Trying again…";
      break;
  }

  setStatus(message, false);
  stopTracking(false);
}

function startTracking() {
  if (!("geolocation" in navigator)) {
    setStatus("This browser does not support geolocation.");
    return;
  }

  if (watchId !== null) return;

  setStatus("Requesting location permission…");

  watchId = navigator.geolocation.watchPosition(
    updatePosition,
    handleError,
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000
    }
  );

  $("startBtn").disabled = true;
  $("stopBtn").disabled = false;
}

function stopTracking(updateUi = true) {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  $("startBtn").disabled = false;
  $("stopBtn").disabled = true;

  if (updateUi) setStatus("Tracking stopped", false);
}

function centerOnMe() {
  if (lastPosition) {
    const { latitude, longitude } = lastPosition.coords;
    map.setView([latitude, longitude], 17, { animate: true });
    return;
  }

  setStatus("Start tracking first so the browser can provide your location.");
}

$("startBtn").addEventListener("click", startTracking);
$("stopBtn").addEventListener("click", () => stopTracking(true));
$("centerBtn").addEventListener("click", centerOnMe);

initMap();
