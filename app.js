"use strict";

const MAPLIBRE_URL = "https://unpkg.com/maplibre-gl@6.7.0/dist/maplibre-gl.mjs";
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const LOCALS_DINER_ZONE = {
  latitude: 42.6725322,
  longitude: -71.3321216,
  enterRadiusMeters: 120,
  exitRadiusMeters: 180
};

const elements = {
  mapFrame: document.querySelector(".map-frame"),
  mapMessageTitle: document.querySelector(".map-message h2"),
  mapMessageDetail: document.querySelector(".map-message p"),
  statusPill: document.getElementById("statusPill"),
  statusShort: document.getElementById("statusShort"),
  statusTitle: document.getElementById("statusTitle"),
  statusDetail: document.getElementById("statusDetail"),
  errorHelp: document.getElementById("errorHelp"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  fullscreenButton: document.getElementById("fullscreenButton"),
  fullscreenEnterIcon: document.querySelector(".fullscreen-enter-icon"),
  fullscreenExitIcon: document.querySelector(".fullscreen-exit-icon"),
  recenterButton: document.getElementById("recenterButton"),
  coordinates: document.getElementById("coordinates"),
  accuracy: document.getElementById("accuracy"),
  speed: document.getElementById("speed"),
  heading: document.getElementById("heading"),
  updated: document.getElementById("updated"),
  zoneScreen: document.getElementById("zoneScreen"),
  continueButton: document.getElementById("continueButton")
};

let maplibregl = null;
let map = null;
let mapLoaded = false;
let locationMarker = null;
let watchId = null;
let lastPosition = null;
let wantsTracking = false;
let followLocation = true;
let zoneScreenOpen = false;
let zoneDismissedWhileInside = false;
let usingFullscreenFallback = false;

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

function showMapError() {
  elements.mapMessageTitle.textContent = "The map could not load";
  elements.mapMessageDetail.textContent = "Check your connection, then reload this page.";
  elements.startButton.disabled = true;
  setStatus(
    "error",
    "Map error",
    "The map could not load",
    "Check your internet connection and reload the page."
  );
}

async function initializeMap() {
  try {
    maplibregl = await import(MAPLIBRE_URL);

    map = new maplibregl.Map({
      container: "map",
      style: MAP_STYLE_URL,
      center: [-71.0589, 42.3601],
      zoom: 11,
      attributionControl: false,
      antialias: true,
      dragRotate: false,
      pitchWithRotate: false
    });

    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    const loadTimeout = window.setTimeout(() => {
      if (!mapLoaded) showMapError();
    }, 20000);

    map.on("load", () => {
      window.clearTimeout(loadTimeout);
      mapLoaded = true;
      elements.startButton.disabled = false;
      addAccuracyLayers();
      if (lastPosition) renderMapPosition(lastPosition, false);
      if (!wantsTracking && !lastPosition) {
        setStatus(
          "idle",
          "Ready",
          "Location is off",
          "Safari will ask for permission after you tap Start live tracking."
        );
      }
    });

    map.on("dragstart", () => {
      if (lastPosition) followLocation = false;
    });

    map.on("zoomstart", (event) => {
      if (lastPosition && event.originalEvent) followLocation = false;
    });

    window.addEventListener("resize", () => {
      window.setTimeout(() => map.resize(), 120);
    });
  } catch (error) {
    showMapError();
  }
}

function emptyFeature() {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function addAccuracyLayers() {
  if (!map || map.getSource("accuracy-area")) return;

  map.addSource("accuracy-area", {
    type: "geojson",
    data: emptyFeature()
  });

  map.addLayer({
    id: "accuracy-fill",
    type: "fill",
    source: "accuracy-area",
    paint: {
      "fill-color": "#1686ff",
      "fill-opacity": 0.14
    }
  });

  map.addLayer({
    id: "accuracy-line",
    type: "line",
    source: "accuracy-area",
    paint: {
      "line-color": "#4da3ff",
      "line-opacity": 0.78,
      "line-width": 1.5
    }
  });
}

function accuracyFeature(longitude, latitude, radiusMeters) {
  const coordinates = [];
  const earthRadius = 6371008.8;
  const angularDistance = Math.max(radiusMeters, 1) / earthRadius;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeRadians = longitude * Math.PI / 180;

  for (let step = 0; step <= 72; step += 1) {
    const bearing = step / 72 * Math.PI * 2;
    const latitudePoint = Math.asin(
      Math.sin(latitudeRadians) * Math.cos(angularDistance) +
      Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const longitudePoint = longitudeRadians + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
      Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(latitudePoint)
    );

    coordinates.push([
      longitudePoint * 180 / Math.PI,
      latitudePoint * 180 / Math.PI
    ]);
  }

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [coordinates]
    }
  };
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

function distanceMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const earthRadius = 6371008.8;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const startLatitude = toRadians(latitudeA);
  const endLatitude = toRadians(latitudeB);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) *
    Math.sin(longitudeDelta / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function showRiddleScreen() {
  exitMapFullscreen();
  zoneScreenOpen = true;
  wantsTracking = false;
  clearLocationWatch();
  document.body.classList.add("zone-active");
  elements.zoneScreen.hidden = false;
  window.setTimeout(() => elements.continueButton.focus({ preventScroll: true }), 0);
}

function checkRiddleZone(position) {
  if (zoneScreenOpen) return;

  const distance = distanceMeters(
    position.coords.latitude,
    position.coords.longitude,
    LOCALS_DINER_ZONE.latitude,
    LOCALS_DINER_ZONE.longitude
  );

  if (zoneDismissedWhileInside) {
    if (distance > LOCALS_DINER_ZONE.exitRadiusMeters) {
      zoneDismissedWhileInside = false;
    }
    return;
  }

  if (distance <= LOCALS_DINER_ZONE.enterRadiusMeters) {
    showRiddleScreen();
  }
}

function continueAfterRiddle() {
  zoneScreenOpen = false;
  zoneDismissedWhileInside = true;
  elements.zoneScreen.hidden = true;
  document.body.classList.remove("zone-active");
  wantsTracking = true;
  followLocation = true;
  setStatus(
    "requesting",
    "Updating",
    "Resuming location tracking",
    "Getting your current position now."
  );
  beginLocationWatch();
}

function renderMapPosition(position, animate = true) {
  if (!mapLoaded) return;

  const { latitude, longitude, accuracy } = position.coords;
  const point = [longitude, latitude];
  const source = map.getSource("accuracy-area");

  if (!locationMarker) {
    const markerElement = document.createElement("div");
    markerElement.className = "user-dot-wrapper";
    markerElement.innerHTML = '<div class="user-dot" aria-hidden="true"></div>';
    markerElement.setAttribute("aria-label", "Your current location");

    locationMarker = new maplibregl.Marker({
      element: markerElement,
      anchor: "center"
    }).setLngLat(point).addTo(map);
  } else {
    locationMarker.setLngLat(point);
  }

  if (source) {
    source.setData(accuracyFeature(longitude, latitude, accuracy));
  }

  if (followLocation) {
    const nextZoom = Math.max(map.getZoom(), accuracy > 250 ? 14 : 17);
    map.easeTo({
      center: point,
      zoom: nextZoom,
      duration: animate ? 650 : 0,
      essential: true
    });
  }
}

function renderPosition(position) {
  const { latitude, longitude, accuracy, speed, heading } = position.coords;

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

  elements.mapFrame.classList.add("has-location");
  elements.recenterButton.disabled = false;
  elements.errorHelp.hidden = true;
  elements.startButton.hidden = true;
  elements.stopButton.hidden = false;

  renderMapPosition(position);

  setStatus(
    "tracking",
    "Live",
    "Tracking your location",
    `Accurate to about ${Math.round(accuracy)} meters. Keep Safari open for continuous updates.`
  );

  checkRiddleZone(position);
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
  if (!mapLoaded || !lastPosition) return;
  followLocation = true;
  const { latitude, longitude, accuracy } = lastPosition.coords;
  map.easeTo({
    center: [longitude, latitude],
    zoom: accuracy > 250 ? 14 : 17,
    duration: 650,
    essential: true
  });
}

function nativeFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function resizeMapAfterFullscreenChange() {
  window.setTimeout(() => {
    if (map) map.resize();
  }, 120);
}

function updateFullscreenButton() {
  const isFullscreen = Boolean(nativeFullscreenElement() || usingFullscreenFallback);
  elements.fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
  elements.fullscreenButton.setAttribute(
    "aria-label",
    isFullscreen ? "Exit fullscreen map" : "Open fullscreen map"
  );
  elements.fullscreenButton.title = isFullscreen ? "Exit full screen" : "Full screen";
  elements.fullscreenEnterIcon.hidden = isFullscreen;
  elements.fullscreenExitIcon.hidden = !isFullscreen;
  resizeMapAfterFullscreenChange();
}

function enterFullscreenFallback() {
  usingFullscreenFallback = true;
  document.body.classList.add("map-fullscreen");
  updateFullscreenButton();
}

async function exitMapFullscreen() {
  if (usingFullscreenFallback) {
    usingFullscreenFallback = false;
    document.body.classList.remove("map-fullscreen");
    updateFullscreenButton();
    return;
  }

  const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
  if (nativeFullscreenElement() && exitFullscreen) {
    try {
      await exitFullscreen.call(document);
    } catch (error) {
      updateFullscreenButton();
    }
  }
}

async function toggleMapFullscreen() {
  if (nativeFullscreenElement() || usingFullscreenFallback) {
    await exitMapFullscreen();
    return;
  }

  const requestFullscreen =
    elements.mapFrame.requestFullscreen || elements.mapFrame.webkitRequestFullscreen;

  if (!requestFullscreen) {
    enterFullscreenFallback();
    return;
  }

  try {
    await requestFullscreen.call(elements.mapFrame);
  } catch (error) {
    enterFullscreenFallback();
  }
}

elements.startButton.addEventListener("click", startTracking);
elements.stopButton.addEventListener("click", stopTracking);
elements.fullscreenButton.addEventListener("click", toggleMapFullscreen);
elements.recenterButton.addEventListener("click", recenterMap);
elements.continueButton.addEventListener("click", continueAfterRiddle);

document.addEventListener("fullscreenchange", updateFullscreenButton);
document.addEventListener("webkitfullscreenchange", updateFullscreenButton);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    clearLocationWatch();
  } else {
    if (map) map.resize();
    if (wantsTracking) {
      setStatus(
        "requesting",
        "Updating",
        "Refreshing your location",
        "Safari paused updates in the background. Reconnecting now."
      );
      beginLocationWatch();
    }
  }
});

window.addEventListener("pagehide", clearLocationWatch);

initializeMap();
