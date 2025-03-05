import fs from 'fs';
import path from 'path';

type StopData = {
    stop_name?: string;
    stop_lat: string;
    stop_lon: string;
    // add other properties as needed
  };

let stopsData: Record<string, StopData> = {};

export function loadStopsData(): Record<string, StopData> {
    if (Object.keys(stopsData).length === 0) {
      try {
        const filePath = path.join(process.cwd(), "gtfs/stops.json");
        const rawData = fs.readFileSync(filePath, "utf8");
        stopsData = JSON.parse(rawData);
        console.log(`Loaded stops data from ${filePath}`);
      } catch (error) {
        console.error("Failed to load stops data:", error);
      }
    }
    return stopsData;
  }
  
  