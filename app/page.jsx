'use client'

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import geojson from '@/gtfs/g_shapes.json';
import trainImg from '@/app/r211t.png';
import Image from 'next/image';
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

// Set your Mapbox access token
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_KEY;

export default function OpenGangwayTrainTracker() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [mapInit, setMapInit] = useState(false)
  const [rideId, setRideId] = useState(null);
  const [upcomingStops, setUpcomingStops] = useState([]);
  const [currStop, setCurrStop] = useState(null)
  const [stops, setStops] = useState({});
  const [rideInfo, setRideInfo] = useState(null)
  const animationRef = useRef(null);
  const rideIdIntervalRef = useRef(null);
  const geoIntervalRef = useRef(null);


  useEffect(() => {
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
    // Fetch most recent ride Id and stops

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

  useEffect(() => {
    // get users location and add pin to map, poll for updates
    if (!map.current) return; // Skip if map not initialized
    
    // Source ID for user location
    const userLocationSourceId = 'user-location-source';
    const userLocationLayerId = 'user-location-layer';
    
    // Create references for clearing intervals and tracking state
    const permissionDenied = { current: false };
    const retryCount = { current: 0 };
    const maxRetries = 3;
    
    // Function to get user location and update the pin
    const updateUserLocation = () => {
      // Skip if permission was previously denied
      if (permissionDenied.current) return;
      
      if (!('geolocation' in navigator)) {
        console.warn('Geolocation is not supported by this browser');
        return;
      }
      
      // Try with decreasing accuracy demands based on retry count
      const highAccuracy = retryCount.current < 2;
      
      console.log(`Attempting to get location (retry: ${retryCount.current}, highAccuracy: ${highAccuracy})`);
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Success! Reset retry counter
          retryCount.current = 0;
          
          const { latitude, longitude } = position.coords;
          console.log('Got position:', latitude, longitude);
          
          // Create or update the source for user location
          if (map.current.getSource(userLocationSourceId)) {
            // Update existing source
            map.current.getSource(userLocationSourceId).setData({
              type: 'Feature',
              geometry: {
                type: 'Point',
                coordinates: [longitude, latitude]
              },
              properties: {
                timestamp: new Date().toISOString()
              }
            });
          } else {
            // First time - add source and layer
            try {
              map.current.addSource(userLocationSourceId, {
                type: 'geojson',
                data: {
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [longitude, latitude]
                  },
                  properties: {
                    timestamp: new Date().toISOString()
                  }
                }
              });
              
              // Add a blue dot for the user's location
              map.current.addLayer({
                id: userLocationLayerId,
                type: 'circle',
                source: userLocationSourceId,
                paint: {
                  'circle-radius': 8,
                  'circle-color': '#1E88E5', // Material blue
                  'circle-opacity': 0.8,
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ffffff'
                }
              });
            } catch (e) {
              console.error('Error adding map layers:', e);
            }
          }
          
          console.log('Updated user location:', latitude, longitude);
        },
        (error) => {
          console.error(`Error getting user location (code: ${error.code}):`, error.message);
          
          // Check error type
          if (error.code === 1) { // PERMISSION_DENIED
            console.warn('Geolocation permission denied. Stopping location polling.');
            permissionDenied.current = true;
            
            // Clear the interval since we don't need to keep polling
            if (geoIntervalRef.current) {
              clearInterval(geoIntervalRef.current);
              geoIntervalRef.current = null;
            }
          } else if (error.code === 3 || error.code === 2) { // TIMEOUT or POSITION_UNAVAILABLE
            retryCount.current++;
            
            if (retryCount.current <= maxRetries) {
              console.warn(`Location request failed (retry ${retryCount.current}/${maxRetries}). Trying again immediately with lower accuracy.`);
              // Try again immediately with lower standards
              setTimeout(updateUserLocation, 500);
            } else {
              console.warn(`Exceeded max retries (${maxRetries}). Will try again on next polling cycle.`);
              retryCount.current = 0; // Reset for next polling cycle
            }
          }
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 5000 : 15000,  // Shorter timeout for high accuracy attempts
          maximumAge: 30000 // Accept locations up to 30 seconds old
        }
      );
    };
    
    // Initial location fetch - delay slightly to ensure map is fully initialized
    setTimeout(updateUserLocation, 1000);
    
    // Set up polling (every 30 seconds)
    geoIntervalRef.current = setInterval(updateUserLocation, 30000);
    
    // Clean up on unmount
    return () => {
      if (geoIntervalRef.current) {
        clearInterval(geoIntervalRef.current);
      }
      
      // Remove layers and sources
      if (map.current) {
        try {
          if (map.current.getLayer(userLocationLayerId)) {
            map.current.removeLayer(userLocationLayerId);
          }
          if (map.current.getSource(userLocationSourceId)) {
            map.current.removeSource(userLocationSourceId);
          }
        } catch (e) {
          console.error('Error cleaning up map resources:', e);
        }
      }
    };
  }, [mapInit]); // Depends on mapInit instead of map reference


  useEffect(() => {
    // Fetch mta gtfs data
    const fetchUpdates = async () => {
      const response = await fetch("https://www.goodservice.io/api/routes/?detailed=1")
      let data = await response.json()
      data = data.routes.G.trips
      data = [...data.north.map(trip => ({...trip, direction: "north"})), ...data.south.map(trip => ({...trip, direction: "south"}))]
      
      let actualTripUpdate = data.filter(trip => trip.id == rideId[0].tripId)
      let tempRideInfo = {}

      if (actualTripUpdate.length > 0) {
        tempRideInfo = actualTripUpdate[0]
        setRideInfo(tempRideInfo)
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

        console.log("currStop", currStopTime)
        console.log("futureStopTimes", futureStopTimes)

        setUpcomingStops(futureStopTimes)

      }
    }

    if (rideId && Object.keys(stops).length > 0) fetchUpdates()

  }, [rideId, stops]);

  useEffect(()=> {
    // centers the map on the current station
    if (!map.current) return; // skip if map not initialized
    
    let currLatLong 
    
    console.log("stops length", Object.keys(stops).length)
    console.log("currStop", currStop)
    console.log("upcomingStops[0]", upcomingStops[0])
    
    if (currStop && Object.keys(stops).length > 0) {
      console.log("setting currLatLong 1")
      currLatLong = {
        lat: stops[currStop.stopId].stop_lat,
        lon: stops[currStop.stopId].stop_lon,
      }
    } else if (upcomingStops[0] && Object.keys(stops).length > 0) {
      console.log("setting currLatLong 2")
      currLatLong = {
        lat: stops[upcomingStops[0].stopId].stop_lat,
        lon: stops[upcomingStops[0].stopId].stop_lon,
      }
    }
    
    console.log("currLatLong", currLatLong)
    
    // If we have coordinates, center map and add pulsing effect
    if (currLatLong) {
      // Center the map
      map.current.flyTo({
        center: [currLatLong.lon, currLatLong.lat],
        zoom: 14,
        essential: true
      });
      
      // Remove any existing pulse animation (if it exists)
      if (map.current.getLayer('pulse-outer')) map.current.removeLayer('pulse-outer');
      if (map.current.getLayer('pulse-inner')) map.current.removeLayer('pulse-inner');
      if (map.current.getSource('pulse-point')) map.current.removeSource('pulse-point');
      
      // Add the pulsing dot for current station
      const pulsePointSource = {
        'type': 'geojson',
        'data': {
          'type': 'Feature',
          'geometry': {
            'type': 'Point',
            'coordinates': [currLatLong.lon, currLatLong.lat]
          },
          'properties': {}
        }
      };
      
      map.current.addSource('pulse-point', pulsePointSource);
      
      // Add the outer pulsing circle
      map.current.addLayer({
        'id': 'pulse-outer',
        'type': 'circle',
        'source': 'pulse-point',
        'paint': {
          'circle-radius': ['interpolate', ['linear'], ['get', 'pulse', ['literal', { 'pulse': 0 }]], 0, 15, 1, 25],
          'circle-color': '#6CBE45',
          'circle-opacity': ['interpolate', ['linear'], ['get', 'pulse', ['literal', { 'pulse': 0 }]], 0, 0.6, 1, 0],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff'
        }
      });
      
      // Add the inner circle for the station
      map.current.addLayer({
        'id': 'pulse-inner',
        'type': 'circle',
        'source': 'pulse-point',
        'paint': {
          'circle-radius': 6,
          'circle-color': '#6CBE45',
          'circle-opacity': 0.8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      });
      
      // Create the pulse animation
      let pulseStart = Date.now();
      const animatePulse = () => {
        // Calculate the pulse progress (0 to 1 every 1500ms)
        const pulseProgress = (Date.now() - pulseStart) % 2500 / 2500;
        
        // Update the pulse property that drives the animation
        map.current.setPaintProperty('pulse-outer', 'circle-radius', 
          ['interpolate', ['linear'], pulseProgress, 0, 15, 1, 25]);
        map.current.setPaintProperty('pulse-outer', 'circle-opacity', 
          ['interpolate', ['linear'], pulseProgress, 0, 0.6, 1, 0]);
        
        // Request the next animation frame
        animationRef.current = requestAnimationFrame(animatePulse);
      };
      
      // Start the animation
      animationRef.current = requestAnimationFrame(animatePulse);
      
      // Cleanup function to stop animation when component unmounts or dependencies change
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }
  }, [currStop, upcomingStops, stops]);

  useEffect(() => {
    if (map.current) return; // Skip if map is already initialized

    // Create new map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-73.953522, 40.689627], // Longitude, Latitude for Bedford–Nostrand Av
      zoom: 14,
      antialias: true,
      interactive: false,
      preserveDrawingBuffer: true,
      attributionControl: false,
      bearing: 0,
      pitch: 0
    });

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl());

    // Handle map load event
    map.current.on('load', function() {
      
      // Fetch G train route data
      map.current.addSource('g-train-route', {
        type: 'geojson',
        data: geojson
      });

      // Add the route line layer
      map.current.addLayer({
        id: 'g-train-route-layer',
        type: 'line',
        source: 'g-train-route',
        layout: {
          'line-join': 'round',
          'line-cap': 'round'
        },
        paint: {
          'line-color': '#6CBE45',  // G train green color
          'line-width': 4
        }
      });
      
      // Add station data as a GeoJSON source (converted from the array)
      const stationsData = {
        type: 'FeatureCollection',
        features: [
          { name: "Court Square", coordinates: [-73.943832, 40.746554] },
          { name: "21 St", coordinates: [-73.949724, 40.744065] },
          { name: "Greenpoint Av", coordinates: [-73.954449, 40.731352] },
          { name: "Nassau Av", coordinates: [-73.951277, 40.724635] },
          { name: "Metropolitan Av", coordinates: [-73.951418, 40.712792] },
          { name: "Broadway", coordinates: [-73.950308, 40.706092] },
          { name: "Flushing Av", coordinates: [-73.950234, 40.700377] },
          { name: "Myrtle–Willoughby Avs", coordinates: [-73.949046, 40.694568] },
          { name: "Bedford–Nostrand Avs", coordinates: [-73.953522, 40.689627] },
          { name: "Classon Av", coordinates: [-73.960070, 40.688873] },
          { name: "Clinton–Washington Avs", coordinates: [-73.966839, 40.688089] },
          { name: "Fulton St", coordinates: [-73.975375, 40.687119] },
          { name: "Hoyt–Schermerhorn Sts", coordinates: [-73.985001, 40.688484] },
          { name: "Bergen St", coordinates: [-73.990862, 40.686145] },
          { name: "Carroll St", coordinates: [-73.995048, 40.680303] },
          { name: "Smith–9 Sts", coordinates: [-73.995959, 40.673580] },
          { name: "4 Av-9 St", coordinates: [-73.989779, 40.670272] },
          { name: "7 Av", coordinates: [-73.980305, 40.666271] },
          { name: "15 St–Prospect Park", coordinates: [-73.979493, 40.660365] },
          { name: "Fort Hamilton Pkwy", coordinates: [-73.975776, 40.650782] },
          { name: "Church Av", coordinates: [-73.979678, 40.644041] }
        ].map(station => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: station.coordinates
          },
          properties: {
            name: station.name
          }
        }))
      };
      
      // Add stations source
      map.current.addSource('stations', {
        type: 'geojson',
        data: stationsData
      });
      
      // Add station points as a circle layer (instead of DOM markers)
      map.current.addLayer({
        id: 'stations-layer',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': 6,
          'circle-color': '#6CBE45',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff'
        }
      });
      
      // Add station labels
      map.current.addLayer({
        id: 'station-labels',
        type: 'symbol',
        source: 'stations',
        layout: {
          'text-field': ['get', 'name'],
          'text-offset': [0, 0],
          'text-anchor': 'top',
          'text-size': 12
        },
        paint: {
          'text-color': '#000000',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1
        }
      });
      
      setMapInit(true)

    });


    // Clean up on unmount
    return () => map.current.remove();
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-100 font-helvetica">
      {/* Header */}
      <header className="bg-[#1f2025] text-white p-6 text-center relative">
        <Image src={trainImg} alt="Train" className="absolute left-0 top-0 w-1/4 mx-auto" />
        <h1 className="text-2xl font-bold">Open Gangway Train Tracker</h1>
      </header>

      {/* Main Content */}
        <div className={`absolute top-30 left-10 max-w-7xl mx-auto mt-5 px-4 py-4 h-full w-full text-stone-600 ${rideInfo ? 'hidden' : ''}`}>
          <p>
            Sorry :(
          </p>
        </div>

        <div className={`max-w-7xl mx-auto mt-5 px-4 py-4 h-full w-full text-stone-600 ${rideInfo ? 'z-10' : '-z-10'}`}>
          <p className="text-5xl max-w-2xl font-[1000]">
            {`The R211T is heading ${rideInfo ? rideInfo.direction : ""} 
            ${upcomingStops[0] && (upcomingStops[0].stopName == "Church Av" || upcomingStops[0].stopName == "Court Square") ? 'from' : 'to'} ${upcomingStops[0] ? upcomingStops[0].stopName : ""} `}
          </p>

          {/* Content Row */}
          <div className="relative gap-3 w-full h-8/10 mt-4 rounded">
      

            {/* Times List */}
            <div className="absolute top-3 left-3 w-3/10 h-1/2 rounded p-4 bg-white z-20">
              <h3 className="font-bold text-lg mt-0 mb-2">Upcoming Stops</h3>
              <div className="max-h-8/10 overflow-auto">
                <ul className="list-none p-0">
                  {upcomingStops.map((stop, index) => (
                      <li key={index} className="my-2">
                        {stop.stopName} - {stop.stopTime}
                      </li>
                    ))
                  }
                </ul>
              </div>
            </div>

            {/* Map Container */}
            <div 
              ref={mapContainer} 
              className="absolute inset-0 rounded z-10 max-h-9/10"
            >
            </div>

          </div>
        </div>

      {/* Footer */}
      <footer className="text-center p-4 text-sm text-gray-600">
        <p>
          <a 
            href="https://github.com/r211tracker" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-gray-600 no-underline border-b border-dotted border-gray-600"
          >
            github.com/r211tracker
          </a>
          &nbsp; | &nbsp;
          Unaffiliated with the MTA, though we're going your way too.
        </p>
      </footer>
    </div>
  );
}
