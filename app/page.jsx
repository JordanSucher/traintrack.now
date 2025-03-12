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
  const [rideId, setRideId] = useState(null);
  const [upcomingStops, setUpcomingStops] = useState([]);
  const [stops, setStops] = useState([]);

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
    }

    const fetchStops = async () => {
      try {
        const response = await fetch('/api/stops');
        const data = await response.json();
        setStops(data);
      } catch (error) {
        console.error('Error fetching stops:', error);
      }
    }

    fetchRideId();
    fetchStops();
  
  }, []);

  useEffect(() => {
    // Fetch mta gtfs data
    const fetchUpdates = async () => {
      const response = await fetch("https://www.goodservice.io/api/routes/?detailed=1")
      let data = await response.json()
      data = data.routes.G.trips
      data = [...data.north, ...data.south]
      
      let actualTripUpdate = data.filter(trip => trip.id == rideId[0].tripId)
      actualTripUpdate = actualTripUpdate.length > 0 ? actualTripUpdate[0] : null
      let randomTripUpdate = data[0]

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

      Object.entries(randomTripUpdate.stops).forEach(entry => {
        stopTimes.push({
          stopId: entry[0],
          stopName: stops[entry[0]]?.stop_name,
          stopEpoch: entry[1],
          stopTime: convertTo12Hour(new Date(entry[1]).toTimeString().split(' ')[0])
        })
      })
      
      let futureStopTimes = stopTimes.filter(stopTime => stopTime.stopEpoch > (new Date().getTime() / 1000))

      console.log("futureStopTimes", futureStopTimes)

      setUpcomingStops(futureStopTimes)

    }

    if (rideId && Object.keys(stops).length > 0) fetchUpdates()

  }, [rideId, stops]);

  useEffect(() => {
    if (map.current) return; // Skip if map is already initialized

    // Create new map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-73.953522, 40.689627], // Longitude, Latitude for Bedford–Nostrand Av
      zoom: 13,
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
      <div className="max-w-7xl mx-auto mt-5 px-4 py-4 h-full w-full text-stone-600">
        <p className="text-4xl w-2xl font-extrabold mb-4">
          The R211T is heading south from Bedford-Nostrand Av <strong>G</strong>
        </p>

        {/* Content Row */}
        <div className="relative gap-3 w-full h-8/10 mt-4 rounded">
     

          {/* Times List */}
          <div className="absolute top-3 left-3 w-3/10 h-1/2 rounded p-4 bg-white z-20">
            <h3 className="font-bold text-lg mt-0 mb-2">Upcoming Stops</h3>
            <div className="h-9/10 overflow-y-auto">
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
            className="absolute inset-0 rounded z-10"
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
