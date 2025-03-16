"use client"

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import geojson from '@/gtfs/g_shapes.json';
import geojsonC from '@/gtfs/c_shapes.json';
import stationsDataLocal from '@/gtfs/stations_data_local.json';
import stationsDataExpress from '@/gtfs/stations_data_express.json';
import mapPinC from '@/app/custom-pin-c.png';
import mapPinG from '@/app/custom-pin-g.png';

// Set your Mapbox access token
mapboxgl.accessToken = "pk.eyJ1Ijoiam9zaHN1Y2hlciIsImEiOiJLQ3NDTXdjIn0.cXfOLf3n6qzEom1Tm1CX_g";

export default function OpenGangwayTrainTracker() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [stops, setStops] = useState({});
  // Now we hold an array of beacon reports (distinct by beaconId)
  const [beaconData, setBeaconData] = useState([]);
  // New state to store info for the selected beacon (when a marker is tapped)
  const [selectedBeacon, setSelectedBeacon] = useState(null);
  // A ref to store markers for each beacon, keyed by beaconId
  const trainMarkers = useRef({});
  const rideIdIntervalRef = useRef(null);
  let tripInfo = null;

  // Fetch stops data once on mount
  useEffect(() => {
    const fetchStops = async () => {
      try {
        const response = await fetch('/api/stops');
        const data = await response.json();
        console.log("Fetched stops:", data);
        setStops(data);
      } catch (error) {
        console.error('Error fetching stops:', error);
      }
    };
    fetchStops();
  }, []);

  // Fetch beacon data every 30 seconds
  useEffect(() => {
    const fetchBeaconData = async () => {
      try {
        const response = await fetch('/api/rideid');
        const data = await response.json();
        console.log("Raw beacon data:", data);
        // Adjust if the response is wrapped in an object
        const beacons = data.beacons || data;
        console.log("Parsed beacon data:", beacons);
        setBeaconData(beacons);
      } catch (error) {
        console.error('Error fetching beacon data:', error);
      }
    };

    fetchBeaconData();
    rideIdIntervalRef.current = setInterval(fetchBeaconData, 30000);

    return () => {
      if (rideIdIntervalRef.current) {
        clearInterval(rideIdIntervalRef.current);
        rideIdIntervalRef.current = null;
      }
    };
  }, []);

useEffect(() => {
  const fetchGTFSUpdates = async () => {
    if (!beaconData || beaconData.length === 0 || Object.keys(stops).length === 0) {
      console.log("Waiting for beaconData and stops to load...");
      return;
    }
    console.log("Processing GTFS updates for beacons:", beaconData);

    try {
      const response = await fetch("https://www.goodservice.io/api/routes/?detailed=1");
      let gtfsData = await response.json();
      gtfsData = gtfsData.routes.G.trips;
      gtfsData = [
        ...gtfsData.north.map(trip => ({ ...trip, direction: "north" })),
        ...gtfsData.south.map(trip => ({ ...trip, direction: "south" }))
      ];

      const currentEpoch = new Date().getTime() / 1000;

      beaconData.forEach(beacon => {
        console.log(`Processing beacon ${beacon.beaconId}: tripId=${beacon.tripId}`);
        if (!beacon.tripId) {
          console.log(`Skipping beacon ${beacon.beaconId} (missing tripId)`);
          return;
        }

        const tripUpdates = gtfsData.filter(trip => trip.id === beacon.tripId);
        console.log(`Beacon ${beacon.beaconId} tripUpdates:`, tripUpdates);
        if (tripUpdates.length === 0) {
          console.log(`No trip update found for beacon ${beacon.beaconId}`);
          return;
        }
        tripInfo = tripUpdates[0];

        let stopTimes = [];
        Object.entries(tripInfo.stops).forEach(([stopId, epoch]) => {
          stopTimes.push({
            stopId,
            stopName: stops[stopId]?.stop_name,
            stopEpoch: epoch,
          });
        });
        stopTimes.sort((a, b) => a.stopEpoch - b.stopEpoch);
        const futureStops = stopTimes.filter(stop => stop.stopEpoch > currentEpoch);
        const currentStop = stopTimes.filter(stop => stop.stopEpoch <= currentEpoch).at(-1);

        console.log(
          `Beacon ${beacon.beaconId} stops - currentStop:`,
          currentStop,
          "futureStops:",
          futureStops
        );

        let currLatLong = null;
        if (currentStop && stops[currentStop.stopId]) {
          currLatLong = {
            lat: parseFloat(stops[currentStop.stopId].stop_lat),
            lon: parseFloat(stops[currentStop.stopId].stop_lon),
          };
        } else if (futureStops.length > 0 && stops[futureStops[0].stopId]) {
          currLatLong = {
            lat: parseFloat(stops[futureStops[0].stopId].stop_lat),
            lon: parseFloat(stops[futureStops[0].stopId].stop_lon),
          };
        }
        console.log(`Beacon ${beacon.beaconId} computed coordinates:`, currLatLong);

        if (currLatLong) {
          // Use tripId for mode letter extraction
          const tripIdStr = beacon.tripId;
          const modeLetter = tripIdStr.split('_')[1].split('..')[0];
          const pinImg = modeLetter === "G" ? mapPinG.src : mapPinC.src;
          const pulseColor = modeLetter === "G" ? "#6CBE45" : "#2850AD";

          const markerContainer = document.createElement('div');
          markerContainer.className = 'relative w-[80px] h-[80px]';

          const pingEl = document.createElement('div');
          pingEl.className =
            'absolute inset-0 animate-ping origin-center rounded-full border-2';
          // Set the border color via inline style
          pingEl.style.borderColor = pulseColor;

          const pinEl = document.createElement('div');
          pinEl.className = 'train-pin relative z-10 w-[80px] h-[80px]';
          pinEl.style.backgroundImage = `url(${pinImg})`;
          pinEl.style.backgroundSize = 'contain';
          pinEl.style.backgroundRepeat = 'no-repeat';
          pinEl.style.backgroundPosition = 'center';

          markerContainer.appendChild(pingEl);
          markerContainer.appendChild(pinEl);

          // Determine the stop name to display (always show the upcoming stop)
          const displayStopName =
            futureStops.length > 0 ? stops[futureStops[0].stopId]?.stop_name : "";
          // Determine the next stop time to display
          const displayStopTime =
            futureStops.length > 0 ? futureStops[0].stopEpoch : "now";

			if (selectedBeacon && selectedBeacon.beaconId === beacon.beaconId) {
			  setSelectedBeacon({
				beaconId: beacon.beaconId,
				direction: tripInfo.direction,
				stopName: displayStopName,
				stopTime: displayStopTime,
				tripId: beacon.tripId,
				latestBeaconReport: beacon.latestBeaconReport,
			  });
			}

          // Add click event listener to update the overlay text
          markerContainer.addEventListener('click', () => {
            setSelectedBeacon({
              beaconId: beacon.beaconId,
              direction: tripInfo.direction,
              stopName: displayStopName,
              stopTime: displayStopTime,
              tripId: beacon.tripId,
              latestBeaconReport: beacon.latestBeaconReport,
            });
				map.current.flyTo({
				  center: [currLatLong.lon, currLatLong.lat],
				  zoom: 14, // Adjust the zoom level as needed
				  essential: true,
				});
          });

          if (trainMarkers.current[beacon.beaconId]) {
            console.log(`Updating marker for beacon ${beacon.beaconId}`);
            trainMarkers.current[beacon.beaconId].marker.setLngLat([
              currLatLong.lon,
              currLatLong.lat,
            ]);
          } else {
            console.log(`Creating marker for beacon ${beacon.beaconId}`);
            const marker = new mapboxgl.Marker({
              element: markerContainer,
              anchor: 'bottom',
              offset: [0, 30],
            })
              .setLngLat([currLatLong.lon, currLatLong.lat])
              .addTo(map.current);
            trainMarkers.current[beacon.beaconId] = {
              marker,
              pingEl, // reference to the ping element
            };
          }
        }
      });
      const bounds = new mapboxgl.LngLatBounds();
Object.values(trainMarkers.current).forEach(markerObj => {
  const { lng, lat } = markerObj.marker.getLngLat();
  bounds.extend([lng, lat]);
});
if (!bounds.isEmpty()) {
  map.current.fitBounds(bounds, { padding: 50, duration: 1000, maxZoom: 12, bearing: 29 });
}
    } catch (error) {
      console.error("Error fetching GTFS updates:", error);
    }
  };

  fetchGTFSUpdates();
  const gtfsInterval = setInterval(fetchGTFSUpdates, 30000);
  return () => clearInterval(gtfsInterval);
}, [beaconData, stops]);

useEffect(() => {
  // When selectedBeacon changes, update the ping element for each marker.
  Object.keys(trainMarkers.current).forEach(beaconId => {
    const markerObj = trainMarkers.current[beaconId];
    if (markerObj && markerObj.pingEl) {
      // Show ping element only if this marker is selected.
      markerObj.pingEl.style.display =
        selectedBeacon && selectedBeacon.beaconId === beaconId
          ? "block"
          : "none";
    }
  });
}, [selectedBeacon]);

  // Initialize Mapbox map and add static sources/layers
  useEffect(() => {
    if (map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/joshsucher/cm863708100bs01qvholb3b30',
      center: [-73.953522, 40.689627],
      zoom: 12,
      antialias: true,
      interactive: true,
      preserveDrawingBuffer: true,
      attributionControl: false,
      bearing: 29,
      pitch: 0
    });

    map.current.addControl(new mapboxgl.NavigationControl());

    map.current.on('load', function() {
      // G train route
      map.current.addSource('g-train-route', {
        type: 'geojson',
        data: geojson
      });
      map.current.addLayer({
        id: 'g-train-route-layer',
        type: 'line',
        source: 'g-train-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#6CBE45', 'line-width': 6 }
      });

      // C train route
      map.current.addSource('c-train-route', {
        type: 'geojson',
        data: geojsonC
      });
      map.current.addLayer({
        id: 'c-train-route-layer',
        type: 'line',
        source: 'c-train-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2850AD', 'line-width': 6 }
      });

      // Station data and labels
      map.current.addSource('stationsLocal', {
        type: 'geojson',
        data: stationsDataLocal
      });
      map.current.addSource('stationsExpress', {
        type: 'geojson',
        data: stationsDataExpress
      });

      map.current.addLayer({
        id: 'stations-local-layer',
        type: 'circle',
        source: 'stationsLocal',
        minzoom: 12,
        paint: {
          'circle-radius': 4,
          'circle-color': '#000',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });

      map.current.addLayer({
        id: 'stations-express-layer',
        type: 'circle',
        source: 'stationsExpress',
        minzoom: 12,
        paint: {
          'circle-radius': 4,
          'circle-color': '#fff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#000'
        }
      });

      map.current.addLayer({
        id: 'station-local-labels',
        type: 'symbol',
        source: 'stationsLocal',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'],
          'text-offset': [1, 1],
          'text-anchor': 'top',
          'text-size': 13,
          'text-font': ['Helvetica Bold']
        },
        paint: {
          'text-color': '#000000',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1
        }
      });

      map.current.addLayer({
        id: 'station-express-labels',
        type: 'symbol',
        source: 'stationsExpress',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'],
          'text-offset': [1, 1],
          'text-anchor': 'top',
          'text-size': 13,
          'text-font': ['Helvetica Bold']
        },
        paint: {
          'text-color': '#000000',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1
        }
      });
    });

    return () => {
      if (map.current) {
        map.current.remove();
      }
    };
  }, []);

  // Resize map on container size changes
  useEffect(() => {
    if (!mapContainer.current) return;
    const resizeObserver = new ResizeObserver(() => {
      if (map.current) map.current.resize();
    });
    resizeObserver.observe(mapContainer.current);
    return () => {
      if (mapContainer.current) resizeObserver.unobserve(mapContainer.current);
      resizeObserver.disconnect();
    };
  }, []);

// Compute mode letter if a beacon is selected
const selectedModeLetter =
  selectedBeacon && selectedBeacon.tripId
    ? selectedBeacon.tripId.split('_')[1].split('..')[0]
    : null;
const selectedBulletColor =
  selectedModeLetter === "G" ? "#6CBE45" : "#2850AD";

const markersExist = document.getElementsByClassName('train-pin').length > 0; 

  return (
    <div className="relative h-dvh w-dvw">
      {/* Map container */}
      <div ref={mapContainer} style={{ height: '100%', width: '100%' }} />

    {/* Overlay text */}
    <div className="absolute top-2 sm:top-4 left-2 sm:left-4 bg-white/75 text-black p-4 w-4/5 sm:w-4/9 rounded mx-auto max-w-2xl border border-gray-300">
      {selectedBeacon ? (
        <>
          <p className="text-2xl sm:text-base sm:text-3xl md:text-4xl lg:text-5xl">
            This <strong>R211T</strong> is heading{' '}
            <strong className="font-bold">{selectedBeacon.direction}</strong> to:
          </p>

          <div className="relative inline-flex items-center bg-black text-white mx-auto max-w-lg px-4 py-2 w-1/1 md:w-5/6 mt-2 mb-2">
            <span className="absolute top-3 sm:top-4 left-0 w-full h-0.25 bg-white"></span>
            <div className="flex justify-between items-center relative w-full">
              <span className="text-left font-bold text-md text-base sm:text-xl md:text-xl lg:text-2xl sm:mt-1">
                {selectedBeacon.stopName}
              </span>
              <span
                className="inline-flex items-center justify-center h-6 w-6 sm:h-6 sm:w-6 md:h-10 md:w-10 lg:h-12 lg:w-12 rounded-full text-white font-bold text-sm sm:text-base sm:text-2xl md:text-2xl lg:text-4xl mt-3 md:mt-4"
                style={{ backgroundColor: selectedBulletColor }}
              >
                {selectedModeLetter}
              </span>
            </div>
          </div>
<p className="text-lg sm:text-base sm:text-lg md:text-1xl lg:text-2xl">as of{" "}
  <strong>
    {selectedBeacon.stopTime !== "now"
      ? new Date(selectedBeacon.stopTime * 1000).toLocaleTimeString()
      : "now"}  </strong>
        </p>
        </>
      ) : (
          <p className="text-2xl sm:text-base sm:text-3xl md:text-4xl lg:text-5xl w-1/1">
        { !markersExist 
      		? <>No <strong>R211T</strong> locations available. Check back soon!</> 
            : <>Tap on an <strong>R211T</strong> for more info.</> }
          </p>
      )}
    </div>

      {/* Footer remains unchanged */}
      <footer className="absolute bottom-4 bg-opacity-50 text-black bg-white/85 rounded right-4 w-1/2 text-right p-4 border border-gray-300">
        <p className="text-xs sm:text-base text-black">
          <strong>What is this all about?</strong> The R211T is the fancy new&nbsp;
          <a href="https://en.wikipedia.org/wiki/R211_(New_York_City_Subway_car)#Open-gangway_trains" className="text-blue-500 hover:text-blue-700 underline">
            open-gangway train
          </a> currently running in a pilot program on the on the <span className="inline-flex items-center justify-center h-4 w-4 sm:h-6 sm:w-6 md:h-4 md:w-4 lg:h-6 lg:w-6 rounded-full bg-[#2850AD] text-white font-bold text-xs xs:text-base sm-text-xs md:text-xs lg:text-sm">
            C
          </span> and <span className="inline-flex items-center justify-center h-4 w-4 sm:h-4 sm:w-4 md:h-4 md:w-4 lg:h-6 lg:w-6 rounded-full bg-[#6CBE45] text-white font-bold text-xs xs:text-base sm-text-xs md:text-xs lg:text-sm">
            G
          </span> lines. For more info, check out our&nbsp;
          <a href="https://github.com/JordanSucher/which-way-gangway" className="text-blue-500 hover:text-blue-700 underline">
            repo
          </a> and&nbsp;
          <a href="https://thingswemake.com/the-open-open-gangway-gang" className="text-blue-500 hover:text-blue-700 underline">
            blog post
          </a>. Made by the <a href="https://thingswemake.com" className="text-blue-500 hover:text-blue-700 underline transition duration-300 ease-in-out">Sucher</a> <a href="https://jordansucher.com" className="text-blue-500 hover:text-blue-700 underline transition duration-300 ease-in-out">Brothers</a> in Brooklyn.
        </p>
      </footer>

      {/* Global styles */}
      <style jsx global>{`
        .mapboxgl-canvas {
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
    </div>
  );
}
