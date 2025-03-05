import fs from "fs";

const parseStops = () => {
    let stops = fs.readFileSync("gtfs/stops.txt", "utf8");
    stops = stops.split("\n");
    stops.shift();
    stops = stops.map((stop) => stop.split(","));

    let stop_dict = {};
    stops.forEach((stop) => {
        stop_dict[stop[0]] = {
            "stop_name": stop[1],
            "stop_lat": stop[2],
            "stop_lon": stop[3],
            "location_type": stop[4],
            "parent_station": stop[5]
        }
    })

    fs.writeFileSync("gtfs/stops.json", JSON.stringify(stop_dict)); 
}

parseStops();
