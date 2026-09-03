"use strict";

const elements = {
  mapFrame: document.querySelector(".map-frame"),
  statusPill: document.getElementById("statusPill"),
  statusShort: document.getElementById("statusShort"),
  statusTitle: document.getElementById("statusTitle"),
  statusDetail: document.getElementById("statusDetail"),
  errorHelp: document.getElementById("errorHelp"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  recenterButton: document.getElementById("recenterButton"),
  coordinates: document.getElementById("coordinates"),
  accuracy: document.getElementById("accuracy"),
  speed: document.getElementById("speed"),
  heading: document.getElementById("heading"),
  updated: document.getElementById("updated")
};

let map = null;
let locationMarker = null;
let accuracyCircle = null;
let watchId = null;
let lastPosition = null;
let wantsTracking = false;
let followLocation = true;

const locationOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 20000
};

function setStatus(state, shortText, title, detail) {
  elements.statusPill.dataset.state = state;
  elements.statusPill.setAttribute("aria-label", `Location status: ${shortText}`);
  elements.statusShort.textContent = shortText;
  elements.statusTitle.textContent = title;
  elements.statusDetail.textContent = detail;
}

function initializeMap() {
  if (!window.L) {
    setStatus(
      "error",
      "Map error",
      "The map could not load",
      "Check your internet connection and reload the page."
    );
    elements.startButton.disabled = true;
    return;
  }

  map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true
  }).setView([42.3601, -71.0589], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    detectRetina: true,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  map.on("dragstart", () => {
    if (lastPosition) followLocation = false;
  });

  map.on("zoomstart", (event) => {
    if (lastPosition && event.originalEvent) followLocation = false;
  });

  window.addEventListener("resize", () => {
    window.setTimeout(() => map.invalidateSize(false), 120);
  });
}

function formatSpeed(metersPerSecond) {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond < 0) return "—";
  return `${(metersPerSecond * 2.236936).toFixed(1)} mph`;
}

function formatHeading(degrees) {
  if (!Number.isFinite(degrees) || degrees < 0) return "—";
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const direction = points[Math.round(degrees / 45) % points.length];
  return `${direction} · ${Math.round(degrees)}°`;
}

function renderPosition(position) {
  const { latitude, longitude, accuracy, speed, heading } = position.coords;
  const point = [latitude, longitude];

  lastPosition = position;
  elements.coordinates.textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  elements.accuracy.textContent = Number.isFinite(accuracy) ? `±${Math.round(accuracy)} m` : "—";
  elements.speed.textContent = formatSpeed(speed);
  elements.heading.textContent = formatHeading(heading);
  elements.updated.textContent = new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(position.timestamp));

  if (!locationMarker) {
    const icon = L.divIcon({
      className: "user-dot-wrapper",
      html: '<div class="user-dot" aria-hidden="true"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    locationMarker = L.marker(point, { icon, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    accuracyCircle = L.circle(point, {
      radius: accuracy,
      color: "#4da3ff",
      weight: 1,
      opacity: 0.75,
      fillColor: "#1686ff",
      fillOpacity: 0.13,
      interactive: false
    }).addTo(map);
  } else {
    locationMarker.setLatLng(point);
    accuracyCircle.setLatLng(point).setRadius(accuracy);
  }

  elements.mapFrame.classList.add("has-location");
  elements.recenterButton.disabled = false;
  elements.errorHelp.hidden = true;
  elements.startButton.hidden = true;
  elements.stopButton.hidden = false;

  if (followLocation) {
    const nextZoom = Math.max(map.getZoom(), accuracy > 250 ? 14 : 17);
    map.setView(point, nextZoom, { animate: lastPosition !== null });
  }

  setStatus(
    "tracking",
    "Live",
    "Tracking your location",
    `Accurate to about ${Math.round(accuracy)} meters. Keep Safari open for continuous updates.`
  );
}

function messageForError(error) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return {
        short: "Blocked",
        title: "Location access was denied",
        detail: "Allow location access for Safari in Settings, then tap Try again.",
        showHelp: true
      };
    case error.POSITION_UNAVAILABLE:
      return {
        short: "Unavailable",
        title: "Your location is unavailable",
        detail: "Check that Location Services are on and try moving near a window or outdoors.",
        showHelp: false
      };
    case error.TIMEOUT:
      return {
        short: "Timed out",
        title: "The location request took too long",
        detail: "Check your connection and Location Services, then try again.",
        showHelp: false
      };
    default:
      return {
        short: "Error",
        title: "Location could not be read",
        detail: "Try again in a moment.",
        showHelp: false
      };
  }
}

function handleLocationError(error) {
  const message = messageForError(error);
  clearLocationWatch();
  wantsTracking = false;
  elements.errorHelp.hidden = !message.showHelp;
  elements.startButton.disabled = false;
  elements.startButton.querySelector("span").textContent = "Try again";
  elements.startButton.hidden = false;
  elements.stopButton.hidden = true;
  setStatus("error", message.short, message.title, message.detail);
}

function clearLocationWatch() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function beginLocationWatch() {
  if (watchId !== null || !wantsTracking) return;
  watchId = navigator.geolocation.watchPosition(renderPosition, handleLocationError, locationOptions);
}

function startTracking() {
  if (!window.isSecureContext) {
    elements.errorHelp.hidden = true;
    setStatus(
      "error",
      "HTTPS needed",
      "A secure connection is required",
      "Open this app from its HTTPS address. Safari blocks location access on ordinary HTTP pages."
    );
    return;
  }

  if (!("geolocation" in navigator)) {
    setStatus(
      "error",
      "Unsupported",
      "Location is not available",
      "This browser does not provide location access. Open the app in Safari on iPhone."
    );
    return;
  }

  wantsTracking = true;
  followLocation = true;
  elements.errorHelp.hidden = true;
  elements.startButton.disabled = true;
  elements.startButton.querySelector("span").textContent = "Requesting location…";
  setStatus(
    "requesting",
    "Requesting",
    "Waiting for permission",
    "Choose Allow while using this website when Safari asks."
  );
  beginLocationWatch();
}

function stopTracking() {
  wantsTracking = false;
  clearLocationWatch();
  elements.startButton.disabled = false;
  elements.startButton.querySelector("span").textContent = "Resume live tracking";
  elements.startButton.hidden = false;
  elements.stopButton.hidden = true;
  setStatus(
    "idle",
    "Paused",
    "Tracking is paused",
    "Your last position remains on the map. Tap Resume to start updates again."
  );
}

function recenterMap() {
  if (!map || !lastPosition) return;
  followLocation = true;
  const { latitude, longitude, accuracy } = lastPosition.coords;
  map.setView([latitude, longitude], accuracy > 250 ? 14 : 17, { animate: true });
}

elements.startButton.addEventListener("click", startTracking);
elements.stopButton.addEventListener("click", stopTracking);
elements.recenterButton.addEventListener("click", recenterMap);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    clearLocationWatch();
  } else if (wantsTracking) {
    setStatus(
      "requesting",
      "Updating",
      "Refreshing your location",
      "Safari paused updates in the background. Reconnecting now."
    );
    beginLocationWatch();
  }
});

window.addEventListener("pagehide", clearLocationWatch);

initializeMap();
