from http.server import BaseHTTPRequestHandler
from gtfs.fetch_reports import fetch_reports
import os

class handler(BaseHTTPRequestHandler):
 
    def do_GET(self):

        beaconId = os.environ.get("BEACON_ID")

        reports = fetch_reports(beaconId)
        print(reports)

        self.send_response(200)
        self.send_header('Content-type','text/plain')
        self.end_headers()
        self.wfile.write(str(reports).encode('utf-8'))
        return
