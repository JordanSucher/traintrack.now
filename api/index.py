from http.server import BaseHTTPRequestHandler
from gtfs.fetch_reports import fetch_reports
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from nyct_gtfs import NYCTFeed  # Using NYCTFeed from nyct_gtfs
from gtfs.utils import load_stops, is_on_route, haversine_distance, match_gtfs_train, get_nearest_stop, get_direction_from_terminus, get_last_terminus_report, get_next_stop
import psycopg2

class handler(BaseHTTPRequestHandler):
 
    def do_GET(self):

        # Constants
        STOP_RADIUS = 200  # meters
        MAX_REPORT_AGE_MIN = 60  # Beacon reports older than 60 minutes => not functioning

        TERMINUS_COORDS = {
            "F27": (40.644041, -73.979678),  # Church Av (south terminus)
            "G22": (40.746554, -73.943832)   # Court Sq (north terminus)
        }

        #Grab reports
        beaconId = os.environ.get("BEACON_ID")
        reports = fetch_reports(beaconId)

        #Connect to DB
        # Connect to the database once, outside the loop

        try:
            conn = psycopg2.connect(
                host=os.environ.get("PGHOST"),
                database=os.environ.get("PGDATABASE"),
                user=os.environ.get("PGUSER"),
                password=os.environ.get("PGPASSWORD")
            )
            cur = conn.cursor()
        except Exception as e:
            print(f"Error connecting to database: {e}")
            msg = f"Error connecting to database: {e}"
            self.send_response(500)
            self.send_header("Content-type", "text/plain")
            self.end_headers()
            self.wfile.write(msg.encode("utf-8"))
            return

         #Create a fetch record
        
        try: 
            cur.execute("INSERT INTO \"GtfsFetch\" (\"feedName\", \"fetchTime\", \"feedTimestamp\") VALUES (%s, %s, %s) RETURNING id", ("G", "now()", "now()"))
            fetch_id = cur.fetchone()[0]
        except Exception as e:
            print(f"Error creating fetch record: {e}")
            msg = f"Error creating fetch record: {e}"
            self.send_response(500)
            self.send_header("Content-type", "text/plain")
            self.end_headers()
            self.wfile.write(msg.encode("utf-8"))
            return

        try:
            structured_reports = []
            for report in reports:
                if hasattr(report, "hashed_adv_key"):
                    structured_reports.append({
                        "fetchId": fetch_id,
                        "beaconId": beaconId,
                        "hashed_adv_key": report.hashed_adv_key,
                        "timestamp": report.timestamp,
                        "latitude": report.lat,
                        "longitude": report.lon
                    })
        except Exception as e:
            print(f"Error structuring beacon reports: {e}")
            msg = f"Error structuring beacon reports: {e}"
            msg += f"\nReport Type: {type(reports[0])}"
            msg += f"\nReport Keys: {reports[0].__dict__}"
            msg += f"\nBeacon reports: {reports}"

            self.send_response(500)
            self.send_header("Content-type", "text/plain")
            self.end_headers()
            self.wfile.write(msg.encode("utf-8"))
            return

        try: 
            cur.executemany("INSERT INTO \"BeaconReport\" (\"fetchId\", \"beaconId\",\"hashedAdvKey\", timestamp, latitude, longitude) VALUES ( %(fetchId)s, %(beaconId)s, %(hashed_adv_key)s, %(timestamp)s, %(latitude)s, %(longitude)s)", structured_reports)

            conn.commit()
        except Exception as e:
            print(f"Error inserting beacon reports: {e}")
            msg = f"Error inserting beacon reports: {e}"
            self.send_response(500)
            self.send_header("Content-type", "text/plain")
            self.end_headers()
            self.wfile.write(msg.encode("utf-8"))
            return

        try:
            latest_report = structured_reports[0]
            now = datetime.now(ZoneInfo("US/Eastern"))
            age = now - latest_report.timestamp.astimezone(ZoneInfo("US/Eastern"))

            # If the latest report is older than 60 minutes, report beacon not functioning.
            if age > timedelta(minutes=MAX_REPORT_AGE_MIN):
                msg = (f"Beacon not functioning: last report is older than {MAX_REPORT_AGE_MIN} minutes. "
                    f"Last report at {latest_report.timestamp} (lat: {latest_report.latitude}, lon: {latest_report.longitude}).")
                print(msg)
                return

            # Check if beacon is on the route.
            if not is_on_route(latest_report.latitude, latest_report.longitude):
                msg = (f"Beacon not functioning: location not along route. "
                    f"Latest report at {latest_report.timestamp} (lat: {latest_report.latitude}, lon: {latest_report.longitude}).")
                print(msg)
                return
            
            # Check if the most recent beacon report is at a terminus.
            for term_id, (term_lat, term_lon) in TERMINUS_COORDS.items():
                dist = haversine_distance(latest_report.latitude, latest_report.longitude, term_lat, term_lon)
                if dist <= STOP_RADIUS:
                    msg = f"Beacon is at terminus {term_id} as of {latest_report.timestamp}."
                    print(msg)
                    return
                
            # Try matching a GTFS train using the last terminus event.
            matching_train, last_term_id = match_gtfs_train(reports)


            if matching_train:
                # Convert train.trip_id: e.g. "111350_G..N14R" -> "111350_G-N14R"
                converted_train_id = matching_train.trip_id.replace("..", "-")
                url = f"https://www.theweekendest.com/trains/G/{converted_train_id}"
                print("Train details: ", url)

                #stub - save match to db
                cur.execute("INSERT INTO \"BeaconTripMapping\" (\"fetchId\", \"tripId\", \"beaconId\") VALUES (%s, %s, %s)", (fetch_id, matching_train.trip_id, beaconId))

                return

            # No matching train found. Report beacon details and determine nearest station & direction.
            stops = load_stops()
            nearest_stop, distance = get_nearest_stop(latest_report.latitude, latest_report.longitude, stops)
            direction = get_direction_from_terminus(last_term_id) if last_term_id else "Unknown"
            msg = (f"No matching GTFS train found.\n"
                f"Latest beacon report: {latest_report.timestamp} at (lat: {latest_report.latitude}, lon: {latest_report.longitude}).\n")
            if nearest_stop:
                msg += f"Nearest station: {nearest_stop['stop_name']} (ID: {nearest_stop['stop_id']}).\n"
            msg += f"Direction inferred from last terminus ({last_term_id}): {direction}.\n"

            # If the beacon has reported a location within the last 3 minutes, try to map it further via next-stop matching.
            if (now - latest_report.timestamp.astimezone(ZoneInfo("US/Eastern"))) <= timedelta(minutes=3):
                # Determine next stop based on the nearest station and direction.
                next_stop = get_next_stop(nearest_stop["stop_id"], direction, stops)
                if next_stop:
                    # Attempt to filter GTFS trips whose next stop (assumed from the first stop_time_update) matches.
                    feed = NYCTFeed("G")
                    print(f"Attempting next-stop mapping for direction {direction} and next stop {next_stop['stop_name']}.")
                    for train in feed.trips:
                        if train.stop_time_updates:
                            # Assume the first update corresponds to the next stop.
                            gtfs_next_stop = train.stop_time_updates[0].stop_id
                            gtfs_next_stop_id = gtfs_next_stop.stop_id
                            base_gtfs_stop_id = gtfs_next_stop_id[:-1] if gtfs_next_stop_id[-1] in ("N", "S") else gtfs_next_stop_id
                            # Here, we simply check if the next stop's id is in our next stop.
                            if next_stop["stop_id"] == base_gtfs_stop_id:
                                msg += (f"Additional mapping: GTFS train {train.trip_id} (status: {train.location_status}) "
                                        f"appears to be heading to a next stop matching {next_stop['stop_name']}.\n")
                                break
                else:
                    msg += "Next stop could not be determined based on current beacon location.\n"
            else:
                msg += "Beacon has not reported a location in the last 3 minutes; cannot refine mapping.\n"




            self.send_response(200)
            self.send_header('Content-type','text/plain')
            self.end_headers()
            self.wfile.write(msg.encode('utf-8'))
            return

        except Exception as e:
            msg = f"Error: {e}"
            print(msg)
            self.send_response(500)
            self.send_header('Content-type','text/plain')
            self.end_headers()
            self.wfile.write(msg.encode('utf-8'))
            return
