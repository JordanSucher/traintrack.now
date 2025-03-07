from google.transit.gtfs_realtime_pb2 import FeedMessage
import requests
import psycopg2
import psycopg2.extras
import os
from os.path import join
import json
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):

    def do_GET(self):

        # Get stop data
        with open(join('gtfs', 'stops.json'), "r") as f:
            stops = json.load(f)
            message2 = json.dumps(stops)


        # Fetch GTFS realtime data
        MTA_FEEDS = [
            {
            "name": "G",
            "url": "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
            }
        ];

        # Connect to the database once, outside the loop
        conn = psycopg2.connect(
            host=os.environ.get("PGHOST"),
            database=os.environ.get("PGDATABASE"),
            user=os.environ.get("PGUSER"),
            password=os.environ.get("PGPASSWORD")
        )
        cur = conn.cursor()
        updates = []

        try: 

            #create a fetch record
            cur.execute("INSERT INTO \"GtfsFetch\" (\"feedName\", \"fetchTime\", \"feedTimestamp\") VALUES (%s, %s, %s) RETURNING id", ("G", "now()", "now()"))
            fetch_id = cur.fetchone()[0]

            for feed_info in MTA_FEEDS:
                print(f"Fetching {feed_info['name']} data")

                response = requests.get(feed_info['url'])
                response.raise_for_status()

                feed = FeedMessage()
                feed.ParseFromString(response.content)

                for entity in feed.entity:
                    vehicle = entity.vehicle

                    update = {
                                'fetchId': fetch_id,
                                'entityId': entity.id,
                                'tripId': vehicle.trip.trip_id,
                                'routeId': vehicle.trip.route_id,
                                'startTime': vehicle.trip.start_time,
                                'startDate': vehicle.trip.start_date,
                                'scheduleRelationship': vehicle.trip.schedule_relationship,
                                'stopId': vehicle.stop_id if vehicle.HasField('stop_id') else None,
                                'stopLat': float(stops[vehicle.stop_id]['stop_lat']),
                                'stopLon': float(stops[vehicle.stop_id]['stop_lon']),
                                'currentStatus': vehicle.current_status if vehicle.HasField('current_status') else None,
                                'timestamp': vehicle.timestamp if vehicle.HasField('timestamp') else None
                            }
                    
                    updates.append(update)

                # Insert the data into the database
                if len(updates) > 0:
                    columns = updates[0].keys()
                    values = [[position[column] for column in columns] for position in updates]

                    query = f"INSERT INTO \"VehiclePosition\" (\"fetchId\", \"entityId\", \"tripId\", \"routeId\", \"startTime\", \"startDate\", \"scheduleRelationship\", \"stopId\", \"stopLat\", \"stopLon\", \"currentStatus\", \"timestamp\") VALUES %s"
                    
                    psycopg2.extras.execute_values(cur, query, values)

                    conn.commit()

                    message = f"Stored {len(updates)} vehicle positions"
                    print(message)

                    

                else:
                    message = "No updates found"
                    print(message)


        except Exception as e:
            message = f"Error: {str(e)}"
            print(message)
            conn.rollback()

        finally:
            if cur is not None:
                cur.close()
            if conn is not None:
                conn.close()

        print("Done fetching data")

        self.send_response(200)
        self.send_header('Content-type', 'text/html')
        self.end_headers()

        self.wfile.write(message.encode('utf-8'))
