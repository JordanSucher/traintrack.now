import { logger, schedules } from "@trigger.dev/sdk/v3";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { PrismaClient } from "@prisma/client";
import { loadStopsData } from '@/gtfs/get_stop_data';


// Initialize Prisma client
const prisma = new PrismaClient();

// Load stops data
const stops = loadStopsData();


// Define the feeds you want to fetch
const MTA_FEEDS = [
    {
      name: "G",
      url: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
    }
];

export const fetchMtaGtfsData = schedules.task({
    id: "fetch-mta-gtfs-data",
    // Runs at the start of every hour
    cron: "0 * * * *",
    // Set a maximum duration to prevent the task from running indefinitely
    maxDuration: 300, // 5 minutes
    run: async (payload) => {
  
      logger.log("Starting MTA GTFS data fetch", { 
        timestamp: payload.timestamp,
        feeds: MTA_FEEDS.map(feed => feed.name)
      });

  
      for (const feed of MTA_FEEDS) {
        logger.log(`Fetching ${feed.name} data`);
        
        try {
          // Fetch GTFS realtime data
          const response = await fetch(feed.url, {
          });
  
          if (!response.ok) {
            throw new Error(`Failed to fetch data: ${response.statusText}`);
          }
  
          // Get response as array buffer
          const buffer = await response.arrayBuffer();
          
          // Parse the GTFS realtime data
          const feedMessage = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
            new Uint8Array(buffer)
          );
  
          // Process and store the data
          const timestamp = new Date();
          let feedTimestamp = timestamp

          // Handle the timestamp which could be a Long object or a number
          if (feedMessage.header.timestamp) {
              const ts = feedMessage.header.timestamp;
              // Check if it's a Long object (has low and high properties)
              if (typeof ts === 'object' && 'low' in ts) {
              feedTimestamp = new Date(ts.low * 1000);
              } else {
              // It's a regular number
              feedTimestamp = new Date(Number(ts) * 1000);
              }
          }
  
  
          logger.log(`Parsed ${feed.name} feed`, { 
            entityCount: feedMessage.entity.length,
            feedTimestamp
          });
  
          // Create a record of this fetch
          const fetchRecord = await prisma.gtfsFetch.create({
            data: {
              feedName: feed.name,
              fetchTime: timestamp,
              feedTimestamp: feedTimestamp,
            },
          });
  
          const vehiclePositions = [];
  
          // Process all entities in the feed
          for (const entity of feedMessage.entity) {
            if (entity.vehicle) {
              // Prepare vehicle position data
              vehiclePositions.push(prepareVehiclePosition(entity, fetchRecord.id));
            }
          }
  
          // Batch insert data for better performance
          if (vehiclePositions.length > 0) {
            await prisma.vehiclePosition.createMany({
              data: vehiclePositions,
            });
            logger.log(`Stored ${vehiclePositions.length} vehicle positions`);
          }
  
          logger.log(`Completed processing ${feed.name} feed`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Error processing ${feed.name} feed: ${errorMessage}`);
          // Don't throw the error to allow processing of other feeds
        }
      }
  
      return {
        status: "completed",
        message: "MTA GTFS data fetching task completed",
        timestamp: payload.timestamp,
      };
    },
  });
  
  
  function prepareVehiclePosition(entity: GtfsRealtimeBindings.transit_realtime.IFeedEntity, fetchId: number) {
    const vehicle = entity.vehicle;
  
    const stop = vehicle && vehicle.stopId ? stops[vehicle.stopId as string] : null
    const stopLat = stop ? parseFloat(stop.stop_lat) : null
    const stopLon = stop ? parseFloat(stop.stop_lon) : null
    
    return {
      fetchId: fetchId,
      entityId: entity.id,
      tripId: vehicle?.trip?.tripId,
      routeId: vehicle?.trip?.routeId,
      startTime: vehicle?.trip?.startTime,
      startDate: vehicle?.trip?.startDate,
      scheduleRelationship: vehicle?.trip?.scheduleRelationship,
      stopId: vehicle?.stopId,
      stopLat: stopLat,
      stopLon: stopLon,
      currentStatus: vehicle?.currentStatus,
      timestamp: vehicle?.timestamp ? 
        (typeof vehicle?.timestamp === 'object' && 'low' in vehicle?.timestamp ? 
          new Date(vehicle?.timestamp.low * 1000) : 
          new Date(Number(vehicle?.timestamp) * 1000)) : 
        null
    };
  }
  
  