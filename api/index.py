from http.server import BaseHTTPRequestHandler, HTTPServer
from gtfs.fetch_reports import fetch_reports
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from nyct_gtfs import NYCTFeed  # Using NYCTFeed from nyct_gtfs
from gtfs.utils import load_stops, is_on_route, haversine_distance, match_gtfs_train, get_nearest_stop, get_direction_from_terminus, get_next_stop
import psycopg2
import re 
import json
from findmy import KeyPair
import hashlib

class handler(BaseHTTPRequestHandler):
     
    def get_line_for_beacon(self, beacon_str):
        """
        Compute a hash of the beacon string and compare against known values
        (stored in environment variables) for G and C beacons.
        
        The environment variables G_BEACON_HASHES and C_BEACON_HASHES should be comma‐separated lists 
        of SHA-256 hexdigests.
        """
        digest = hashlib.sha256(beacon_str.encode()).hexdigest()
        g_hashes = {
            "94f3ac69f181ec7a0d0d013ac32561b5f8bb77140de4df1d7206f5594a212865",
            "74490939e7d633b32aaf878ca30825a32caa28e510be8e820d3c16ca33b7811f",
            "ecf02a1da7ccbb631577f16e4c7ee20d93de776f8485c340c6312a68698e0f1a",
            "8a468700c3b580a79fbc5dbda164211c78b2715e4a5e3545e4550a5a43605c16"
        }
        c_hashes = {
            "41943df1738d6a9e3383396a68fd8408ed0e0a94906b1e9942c8465384a21bae"
        }
        
        if digest in g_hashes:
            return "G"
        elif digest in c_hashes:
            return "C"
        else:
            return "unknown" 

    def do_GET(self):
        results = []  # List to collect results from all beacons
        errors = []   # List to collect any errors

        # Constants
        STOP_RADIUS = 200  # meters
        MAX_REPORT_AGE_MIN = 60  # Beacon reports older than 60 minutes => not functioning

        TERMINUS_COORDS = {
            "F27": (40.644041, -73.979678),  # Church Av (G south terminus)
            "G22": (40.746554, -73.943832),   # Court Sq (G north terminus)
            "A09": (40.840719, -73.939561),   # 168 St (C north terminus)
            "A55": (40.675377, -73.872106)   # Euclid Av (C south terminus)
        }

        #Grab beacon IDs
        #beaconId = os.environ.get("BEACON_ID")
        beaconIds = json.loads(os.environ.get("BEACON_IDS", "[]"))

        try:
            #Connect to DB once, outside the loop
            conn = psycopg2.connect(
                host=os.environ.get("PGHOST"),
                database=os.environ.get("PGDATABASE"),
                user=os.environ.get("PGUSER"),
                password=os.environ.get("PGPASSWORD")
            )
            cur = conn.cursor()
            
            # Delete rows older than 24 hours
            delete_query = """
            DELETE FROM \"BeaconReport\"
            WHERE \"timestamp\" < NOW() - INTERVAL '4 hours';
            """
            cur.execute(delete_query)
            conn.commit()
            
            #Create a fetch record
            cur.execute("INSERT INTO \"GtfsFetch\" (\"feedName\", \"fetchTime\", \"feedTimestamp\") VALUES (%s, %s, %s) RETURNING id", ("G", "now()", "now()"))
            fetch_id = cur.fetchone()[0]

            all_reports = fetch_reports(beaconIds)


            # for each beacon, get reports and push to DB
            for beacon_str in beaconIds:
                beacon_result = {}  # Dictionary to store results for this beacon
                beacon_result["beaconId"] = beacon_str
                
                # Determine the line based on the beacon ID.
                line = self.get_line_for_beacon(beacon_str)
                beacon_result["line"] = line  # Optional: include for debugging

                try:
                    # Convert the beacon Base64 string to a KeyPair object
                    key_obj = KeyPair.from_b64(beacon_str)
                    # Use the KeyPair object to index the all_reports dictionary
                    reports = all_reports[key_obj]
                    
                    structured_reports = []
                    
                    for report in reports:
                        if "KeyReport(" in str(report):
                            # Extract data using regex
                            report_str = str(report)
                            hashed_key = re.search(r'hashed_adv_key=([^,]+)', report_str).group(1)
                            timestamp_str = re.search(r'timestamp=([^,]+)', report_str).group(1)
                            lat = float(re.search(r'lat=([^,]+)', report_str).group(1))
                            lon = float(re.search(r'lon=([^,\)]+)', report_str).group(1))
                            
                            # Parse timestamp
                            timestamp = datetime.fromisoformat(timestamp_str)
                            
                            report_dict = {
                                "fetchId": fetch_id,
                                "beaconId": beacon_str,
                                "hashed_adv_key": hashed_key,
                                "timestamp": timestamp,
                                "latitude": lat,
                                "longitude": lon
                            }

                            structured_reports.append(report_dict)

                    cur.executemany("INSERT INTO \"BeaconReport\" (\"fetchId\", \"beaconId\",\"hashedAdvKey\", timestamp, latitude, longitude) VALUES ( %(fetchId)s, %(beaconId)s, %(hashed_adv_key)s, %(timestamp)s, %(latitude)s, %(longitude)s)", structured_reports)

                    conn.commit()

                    # process latest report 
                    if structured_reports:
                        sorted_reports = sorted(structured_reports, key=lambda r: r["timestamp"], reverse=True)

                        latest_report = sorted_reports[0]

                        beacon_result["timestamp"] = latest_report["timestamp"].isoformat()
                        beacon_result["location"] = {
                            "lat": latest_report["latitude"],
                            "lon": latest_report["longitude"]
                        }

                        # process report
                        now = datetime.now(ZoneInfo("US/Eastern"))
                        age = now - latest_report["timestamp"].astimezone(ZoneInfo("US/Eastern"))

                        # If the latest report is older than 60 minutes, report beacon not functioning.
                        if age > timedelta(minutes=MAX_REPORT_AGE_MIN):
                            beacon_result["status"] = "not_functioning"
                            beacon_result["reason"] = f"Last report is older than {MAX_REPORT_AGE_MIN} minutes"

                        # Check if beacon is on the route.
                        elif not is_on_route(latest_report["latitude"], latest_report["longitude"], line):
                            beacon_result["status"] = "not_functioning"
                            beacon_result["reason"] = "Location not along route"
                    
                        else:
                            at_terminus = False

                            # Check if the most recent beacon report is at a terminus.
                            for term_id, (term_lat, term_lon) in TERMINUS_COORDS.items():
                                dist = haversine_distance(latest_report["latitude"], latest_report["longitude"], term_lat, term_lon)
                                if dist <= STOP_RADIUS:
                                    beacon_result["status"] = "at_terminus"
                                    beacon_result["terminus"] = term_id
                                    at_terminus = True
                                    break

                            # Try matching a GTFS train
                            if not at_terminus:
                        
                                # Try matching a GTFS train using the last terminus event.
                                matching_train, last_term_id = match_gtfs_train(reports, line)

                                if matching_train:
                                    beacon_result["status"] = "matched"
                                    beacon_result["trainId"] = matching_train.trip_id
                                    
                                    #save match to db
                                    cur.execute("INSERT INTO \"BeaconTripMapping\" (\"fetchId\", \"tripId\", \"beaconId\", \"latestBeaconReport\") VALUES (%s, %s, %s, %s)", (fetch_id, matching_train.trip_id, beacon_str, latest_report["timestamp"]))

                                    conn.commit()

                                else:
                                    # No matching train found. Report beacon details and determine nearest station & direction.
                                    beacon_result["status"] = "unmatched"
                                    
                                    stops = load_stops(line)
                                    nearest_stop, distance = get_nearest_stop(latest_report["latitude"], latest_report["longitude"], stops)
                                    direction = get_direction_from_terminus(last_term_id) if last_term_id else "Unknown"
                    
                                    if nearest_stop:
                                        beacon_result["nearestStop"] = {
                                            "id": nearest_stop["stop_id"],
                                            "name": nearest_stop["stop_name"],
                                            "distance": distance
                                        }

                                    beacon_result["direction"] = direction
                                    beacon_result["lastTerminus"] = last_term_id

                                    # If recent report, try next-stop matching
                                    if (now - latest_report["timestamp"].astimezone(ZoneInfo("US/Eastern"))) <= timedelta(minutes=3):
                                        # Determine next stop based on the nearest station and direction.
                                        next_stop = get_next_stop(nearest_stop["stop_id"], direction, stops)
                                        if next_stop:
                                            beacon_result["nextStop"] = {
                                                "id": next_stop["stop_id"],
                                                "name": next_stop["stop_name"]
                                            }

                                            # Try to find matching train by next stop
                                            feed = NYCTFeed(line)

                                            for train in feed.trips:
                                                if train.stop_time_updates:
                                                    gtfs_next_stop = train.stop_time_updates[0].stop_id
                                                    gtfs_next_stop_id = gtfs_next_stop.stop_id
                                                    base_gtfs_stop_id = gtfs_next_stop_id[:-1] if gtfs_next_stop_id[-1] in ("N", "S") else gtfs_next_stop_id
                                                                    
                                                    # Here, we simply check if the next stop's id is in our next stop.
                                                    if next_stop["stop_id"] == base_gtfs_stop_id:
                                                        beacon_result["possibleTrain"] = {
                                                            "id": train.trip_id,
                                                            "status": train.location_status
                                                        }
                                                        break
                                      
                    else:
                        beacon_result["status"] = "no_reports"
                        beacon_result["reason"] = "No valid beacon reports found"

                    # Add this beacon's result to the collection
                    results.append(beacon_result)

                except Exception as e:
                    error_info = {
                        "beaconId": beacon_str,
                        "error": str(e)
                    }
                    errors.append(error_info)
                    print(f"Error processing beacon {beacon_str}: {e}")

            # Prepare the final response
            response = {
                "fetchId": fetch_id,
                "timestamp": datetime.now(ZoneInfo("US/Eastern")).isoformat(),
                "beacons": results
            }

            if errors:
                response["errors"] = errors

            # Send the consolidated response
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response, default=str).encode("utf-8"))

        except Exception as e:
            error_msg = f"Server error: {str(e)}"
            print(error_msg)
            self.send_response(500)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": error_msg}).encode("utf-8"))
        
        finally:
            # Always close database connections
            if 'cur' in locals() and cur is not None:
                cur.close()
            if 'conn' in locals() and conn is not None:
                conn.close()

if __name__ == '__main__':
    # Define server address and port
    server_address = ('', 8000)  # '' binds to all available interfaces
    httpd = HTTPServer(server_address, handler)
    print("Server running on port 8000...")
    
    # Run the server until interrupted
    httpd.serve_forever()