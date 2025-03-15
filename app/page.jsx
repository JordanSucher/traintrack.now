"use client"

import React, { use, useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css'; // Import Mapbox default CSS
import geojson from '@/gtfs/g_shapes.json';
import geojsonC from '@/gtfs/c_shapes.json';
import stationsDataLocal from '@/gtfs/stations_data_local.json';
import stationsDataExpress from '@/gtfs/stations_data_express.json';
import mapPinC from '@/app/custom-pin-c.png';

// Set your Mapbox access token
mapboxgl.accessToken = "pk.eyJ1Ijoiam9zaHN1Y2hlciIsImEiOiJLQ3NDTXdjIn0.cXfOLf3n6qzEom1Tm1CX_g";

export default function OpenGangwayTrainTracker() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [mapInit, setMapInit] = useState(false)
  const [rideId, setRideId] = useState(null);
  const [upcomingStops, setUpcomingStops] = useState([]);
  const [currStop, setCurrStop] = useState(null)
  const [stops, setStops] = useState([]);
  const [rideInfo, setRideInfo] = useState(null)
  const trainMarker = useRef(null);
  const [trainMarkerInitialized, setTrainMarkerInitialized] = useState(false);
  const animationRef = useRef(null);
  const rideIdIntervalRef = useRef(null);
  const geoIntervalRef = useRef(null);


  useEffect(() => {
    // Fetch and set stops data

    const fetchStops = async () => {
      try {
        const response = await fetch('/api/stops');
        const data = await response.json();
        setStops(data);
      } catch (error) {
        console.error('Error fetching stops:', error);
      }
    }
    fetchStops();
  }, [])

  useEffect(() => {
    // Fetch most recent ride Id every 30 seconds

    const fetchRideId = async () => {
      try {
        const response = await fetch('/api/rideid');
        const data = await response.json();
        setRideId(data);
        console.log("rideId mapping:", data);
      } catch (error) {
        console.error('Error fetching ride ID:', error);
      }
    };
  
    // Initial fetch
    fetchRideId();
    
    // Set up polling every 30 seconds
    rideIdIntervalRef.current = setInterval(fetchRideId, 30000);
    
    // Clean up on unmount
    return () => {
      if (rideIdIntervalRef.current) {
        clearInterval(rideIdIntervalRef.current);
        rideIdIntervalRef.current = null;
      }
    };
  }, []);

  // // Fetch updates and update the marker position (logic remains similar)
  // useEffect(() => {
  //   const fetchUpdates = async () => {
  //     const response = await fetch("https://www.goodservice.io/api/routes/?detailed=1");
  //     let data = await response.json();
  //     data = data.routes.G.trips;
  //     data = [...data.north, ...data.south];

  //     let actualTripUpdate = data.filter(trip => trip.id === rideId?.[0]?.tripId);
  //     actualTripUpdate = actualTripUpdate.length > 0 ? actualTripUpdate[0] : null;

  //     if (map.current && trainMarker.current) {
  //       // Update marker's position (for now using fixed Nassau Av coordinates)
  //       trainMarker.current.setLngLat([-73.951277, 40.724635]);
  //     }
  //   };

  //   if (rideId && Object.keys(stops).length > 0) {
  //     fetchUpdates();
  //   }
  // }, [rideId, stops]);

  useEffect(() => {
    // Fetch mta gtfs data
    const fetchUpdates = async () => {
      console.log("fetching gtfs data for rideId:", rideId)

      const response = await fetch("https://www.goodservice.io/api/routes/?detailed=1")
      let data = await response.json()
      data = data.routes.G.trips
      data = [...data.north.map(trip => ({...trip, direction: "north"})), ...data.south.map(trip => ({...trip, direction: "south"}))]
      
      console.log("data:", data)

      let actualTripUpdate = data.filter(trip => trip.id == rideId[0].tripId)
      console.log("actualTripUpdate:", actualTripUpdate)
      let tempRideInfo = {}

      if (actualTripUpdate.length > 0) {
        tempRideInfo = actualTripUpdate[0]
        setRideInfo(tempRideInfo)
      } else {
        //this just picks the first G trip for development purposes
        // tempRideInfo = data[0]
        // setRideInfo(tempRideInfo)
      }


      let stopTimes = []

      function convertTo12Hour(time24) {
        const [hours, minutes] = time24.split(':');
        let period = 'AM';
        let hours12 = parseInt(hours, 10);
      
        if (hours12 >= 12) {
          period = 'PM';
          if (hours12 > 12) {
            hours12 -= 12;
          }
        } else if (hours12 === 0) {
          hours12 = 12;
        }
      
        return `${hours12}:${minutes} ${period}`;
      }

      if (tempRideInfo && Object.entries(tempRideInfo).length > 0) {

          Object.entries(tempRideInfo.stops).forEach(entry => {
          stopTimes.push({
            stopId: entry[0],
            stopName: stops[entry[0]]?.stop_name,
            stopEpoch: entry[1],
            stopTimeRaw: new Date(entry[1] * 1000).toTimeString(),
            stopTime: convertTo12Hour(new Date(entry[1] * 1000).toTimeString().split(' ')[0])
            })
          })
        
        let futureStopTimes = stopTimes.filter(stopTime => stopTime.stopEpoch > (new Date().getTime() / 1000))
        let currStopTime = stopTimes.filter(stopTime => stopTime.stopEpoch <= (new Date().getTime() / 1000)).at(-1)

        setCurrStop(currStopTime)
        setUpcomingStops(futureStopTimes)

      }
    }

    if (rideId && Object.keys(stops).length > 0) fetchUpdates()

  }, [rideId, stops]);

  useEffect(()=> {
    // centers the map on the current station
    if (!map.current) return; // skip if map not initialized
    
    let currLatLong 
    
    console.log("currStop", currStop)
    console.log("upcomingStops[0]", upcomingStops[0])
    
    if (currStop && Object.keys(stops).length > 0) {
      currLatLong = {
        lat: stops[currStop.stopId].stop_lat,
        lon: stops[currStop.stopId].stop_lon,
      }
    } else if (upcomingStops[0] && Object.keys(stops).length > 0) {
      currLatLong = {
        lat: stops[upcomingStops[0].stopId].stop_lat,
        lon: stops[upcomingStops[0].stopId].stop_lon,
      }
    }
    
    console.log("currLatLong", currLatLong)
    
    // If we have coordinates, center map and add pulsing effect
    if (currLatLong) {
      // // Center the map
      // map.current.flyTo({
      //   center: [currLatLong.lon, currLatLong.lat],
      //   zoom: 14,
      //   essential: true
      // });

      // move the custom marker
      if (trainMarker.current) {
        trainMarker.current.setLngLat([currLatLong.lon, currLatLong.lat]);
      }
      

      // // Remove any existing pulse animation (if it exists)
      // if (map.current.getLayer('pulse-outer')) map.current.removeLayer('pulse-outer');
      // if (map.current.getLayer('pulse-inner')) map.current.removeLayer('pulse-inner');
      // if (map.current.getSource('pulse-point')) map.current.removeSource('pulse-point');
      
      // // Add the pulsing dot for current station
      // const pulsePointSource = {
      //   'type': 'geojson',
      //   'data': {
      //     'type': 'Feature',
      //     'geometry': {
      //       'type': 'Point',
      //       'coordinates': [currLatLong.lon, currLatLong.lat]
      //     },
      //     'properties': {}
      //   }
      // };
      
      // map.current.addSource('pulse-point', pulsePointSource);
      
      // // Add the outer pulsing circle
      // map.current.addLayer({
      //   'id': 'pulse-outer',
      //   'type': 'circle',
      //   'source': 'pulse-point',
      //   'paint': {
      //     'circle-radius': ['interpolate', ['linear'], ['get', 'pulse', ['literal', { 'pulse': 0 }]], 0, 15, 1, 25],
      //     'circle-color': '#6CBE45',
      //     'circle-opacity': ['interpolate', ['linear'], ['get', 'pulse', ['literal', { 'pulse': 0 }]], 0, 0.6, 1, 0],
      //     'circle-stroke-width': 1,
      //     'circle-stroke-color': '#fff'
      //   }
      // });
      
      // // Add the inner circle for the station
      // map.current.addLayer({
      //   'id': 'pulse-inner',
      //   'type': 'circle',
      //   'source': 'pulse-point',
      //   'paint': {
      //     'circle-radius': 6,
      //     'circle-color': '#6CBE45',
      //     'circle-opacity': 0.8,
      //     'circle-stroke-width': 2,
      //     'circle-stroke-color': '#fff'
      //   }
      // });
      
      // // Create the pulse animation
      // let pulseStart = Date.now();
      // const animatePulse = () => {
      //   // Calculate the pulse progress (0 to 1 every 1500ms)
      //   const pulseProgress = (Date.now() - pulseStart) % 2500 / 2500;
        
      //   // Update the pulse property that drives the animation
      //   map.current.setPaintProperty('pulse-outer', 'circle-radius', 
      //     ['interpolate', ['linear'], pulseProgress, 0, 15, 1, 25]);
      //   map.current.setPaintProperty('pulse-outer', 'circle-opacity', 
      //     ['interpolate', ['linear'], pulseProgress, 0, 0.6, 1, 0]);
        
      //   // Request the next animation frame
      //   animationRef.current = requestAnimationFrame(animatePulse);
      // };
      
      // // Start the animation
      // animationRef.current = requestAnimationFrame(animatePulse);
      
      // // Cleanup function to stop animation when component unmounts or dependencies change
      // return () => {
      //   if (animationRef.current) {
      //     cancelAnimationFrame(animationRef.current);
      //   }
      // };

    }
  }, [currStop, upcomingStops, stops]);


  // Initialize Mapbox map, add routes and stations, add custom marker
  useEffect(() => {
    if (map.current) return; // Initialize only once

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/joshsucher/cm863708100bs01qvholb3b30',
      center: [-73.953522, 40.689627], // Center on Bedford–Nostrand Av
      zoom: 12,
      antialias: true,
      interactive: true,
      preserveDrawingBuffer: true,
      attributionControl: false,
      bearing: 29,
      pitch: 0
    });

    // Optional navigation control
    map.current.addControl(new mapboxgl.NavigationControl());

    map.current.on('load', function() {

      // Add the G train route
      map.current.addSource('g-train-route', {
        type: 'geojson',
        data: geojson
      });

      map.current.addLayer({
        id: 'g-train-route-layer',
        type: 'line',
        source: 'g-train-route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#6CBE45',
          'line-width': 6
        }
      });

      // Add the C train route
      map.current.addSource('c-train-route', {
        type: 'geojson',
        data: geojsonC
      });

      map.current.addLayer({
        id: 'c-train-route-layer',
        type: 'line',
        source: 'c-train-route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#2850AD',
          'line-width': 6
        }
	    });


      // Add local station data source
      map.current.addSource('stationsLocal', {
        type: 'geojson',
        data: stationsDataLocal
      });

      // Add express station data source
      map.current.addSource('stationsExpress', {
        type: 'geojson',
        data: stationsDataExpress
      });

      // Add local station circles
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

      // Add express station circles
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

      // Add local station labels
      map.current.addLayer({
        id: 'station-labels',
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

      // Add express station labels
      map.current.addLayer({
        id: 'station-labels',
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

  //Initialize custom marker when current station changes, IF it hasn't already been initialized
  useEffect(() => {
    if (!trainMarker.current) {

      let currLatLong

      if (currStop && Object.keys(stops).length > 0) {
        currLatLong = {
          lat: stops[currStop.stopId].stop_lat,
          lon: stops[currStop.stopId].stop_lon,
        }
      } else if (upcomingStops[0] && Object.keys(stops).length > 0) {
        currLatLong = {
          lat: stops[upcomingStops[0].stopId].stop_lat,
          lon: stops[upcomingStops[0].stopId].stop_lon,
        }
      }
      
      if (currLatLong) {
        // Create a container for the marker
        const markerContainer = document.createElement('div');
        markerContainer.className = 'relative w-[80px] h-[80px]';

        // Create the ping element (the animated stroke)
        const pingEl = document.createElement('div');
        pingEl.className =
          'absolute inset-0 animate-ping origin-center rounded-full border-2 border-[#2850AD]';
        // The 'origin-center' class ensures the scaling happens from the center

        // Create the actual pin element
        const pinEl = document.createElement('div');
        pinEl.className = 'relative z-10 w-[80px] h-[80px]';
        pinEl.style.backgroundImage = `url(${mapPinC.src})`;
        pinEl.style.backgroundSize = 'contain';
        pinEl.style.backgroundRepeat = 'no-repeat';
        pinEl.style.backgroundPosition = 'center';

        // Append the ping and pin to the container
        markerContainer.appendChild(pingEl);
        markerContainer.appendChild(pinEl);

        // Use the container as the custom marker element in Mapbox
        trainMarker.current = new mapboxgl.Marker({
          element: markerContainer,
          anchor: 'bottom',
          offset: [0, 30] // Adjust this value as needed
        })
        .setLngLat([currLatLong.lon, currLatLong.lat])
        .addTo(map.current);
      }
    }

  }, [currStop, upcomingStops]);

  // Handle map resize on window resize
  useEffect(() => {
    if (!mapContainer.current) return;
    
    const resizeObserver = new ResizeObserver(() => {
      if (map.current) {
        map.current.resize();
      }
    });
    
    resizeObserver.observe(mapContainer.current);
    
    return () => {
      if (mapContainer.current) {
        resizeObserver.unobserve(mapContainer.current);
      }
      resizeObserver.disconnect();
    };
  }, []);
  

  return (
    <div className="relative h-screen w-screen">
      {/* Map container */}
      <div ref={mapContainer} style={{ height: '100%', width: '100%' }} />

      {/* Overlay text */}
      <div className="absolute top-0 sm:top-4 left-1 sm:left-4 bg-opacity-0 text-black p-4 w-1/2 rounded mx-auto max-w-2xl">
        <p className="text-sm sm:text-base sm-text-3xl md:text-4xl lg:text-6xl">
          An <strong>R211T</strong> is heading <strong className="font-bold">{`${rideInfo ? rideInfo.direction : ""} `}</strong> from:
        </p>
          
      <div className="relative inline-flex items-center bg-black text-white mx-auto max-w-lg px-4 py-2 w-4/5 mt-2 mb-2">
        <span className="absolute top-3 sm:top-4 left-0 w-full h-0.25 bg-white"></span>
        <div className="flex justify-between items-center relative w-full">
          <span className="text-left font-bold text-sm sm:text-base sm-text-3xl md:text-2xl lg:text-3xl">{`${upcomingStops[0] ? upcomingStops[0].stopName : ""}`}</span>
          <span className="inline-flex items-center justify-center h-4 w-4 sm:h-6 sm:w-6 md:h-10 md:w-10 lg:h-12 lg:w-12 rounded-full bg-[#2850AD] text-white font-bold text-sm sm:text-base sm-text-2xl md:text-2xl lg:text-4xl mt-4">
            C
          </span>
        </div>
      </div>
          <p className="text-sm sm:text-base sm:text-lg md:text-1xl lg:text-2xl">as of <strong>{`${rideId ? new Date(rideId[0].latestBeaconReport).toLocaleTimeString() : "now"} `}</strong>
        </p>
      </div>

      {/* Footer */}
      <footer className="absolute bottom-4 bg-opacity-50 text-black bg-white rounded right-4 w-1/2 text-right p-4 border-1 border-gray-300">
        <p className="text-xs sm:text-base sm:text-xs md:text-xs lg:text-sm text-black">
          <strong>What is this all about?</strong> The R211T is the fancy new <a href="https://en.wikipedia.org/wiki/R211_(New_York_City_Subway_car)#Open-gangway_trains" className="text-blue-500 hover:text-blue-700 underline transition duration-300 ease-in-out">open-gangway train</a> currently running in a pilot program on the <span className="inline-flex items-center justify-center h-4 w-4 sm:h-6 sm:w-6 md:h-4 md:w-4 lg:h-6 lg:w-6 rounded-full bg-[#2850AD] text-white font-bold text-xs xs:text-base sm-text-xs md:text-xs lg:text-sm">
            C
          </span> and <span className="inline-flex items-center justify-center h-4 w-4 sm:h-4 sm:w-4 md:h-4 md:w-4 lg:h-6 lg:w-6 rounded-full bg-[#6CBE45] text-white font-bold text-xs xs:text-base sm-text-xs md:text-xs lg:text-sm">
            G
          </span> lines. There are ~3 R211Ts running as of March 2025, not all of which run at all times. For more info, check out our <a href="https://github.com/JordanSucher/which-way-gangway" className="text-blue-500 hover:text-blue-700 underline transition duration-300 ease-in-out">repo</a> and <a href="https://thingswemake.com/the-open-open-gangway-gang" className="text-blue-500 hover:text-blue-700 underline transition duration-300 ease-in-out">blog post</a>. Made by the <a href="https://thingswemake.com" className="text-blue-500 hover:text-blue-700 underline transition duration-300 ease-in-out">Sucher</a> <a href="https://jordansucher.com" className="text-blue-500 hover:text-blue-700 underline transition duration-300 ease-in-out">Brothers</a> in Brooklyn.
        </p>
      </footer>

      {/* Global styles */}
      <style jsx global>{`
        .train-marker {
          display: block;
          border: none;
          cursor: pointer;
          padding: 0;
          background-color: transparent;
          z-index: 2000;
         }
        .mapboxgl-canvas {
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
    </div>
  );
}
