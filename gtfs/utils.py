import csv
import math
import os
from gtfs.fetch_reports import fetch_reports
import pytz
from nyct_gtfs import NYCTFeed  # Using NYCTFeed from nyct_gtfs

# Constants
STOP_RADIUS = 200  # meters
MAX_REPORT_AGE_MIN = 60  # Beacon reports older than 60 minutes => not functioning
MATCH_WINDOW_SEC = 180  # ±3 minutes for matching departure time

ANISETTE_SERVER = "https://ani.npeg.us"

TERMINUS_COORDS = {
    "F27": (40.644041, -73.979678),  # Church Av (south terminus)
    "G22": (40.746554, -73.943832)   # Court Sq (north terminus)
}

# Known stop sequence for the G train route.
STOP_SEQUENCE = [
    "G22",  # Court Sq (north terminus)
    "G24",  # 21 St
    "G26",  # Greenpoint Av
    "G28",  # Nassau Av
    "G29",  # Metropolitan Av
    "G30",  # Broadway
    "G31",  # Flushing Av
    "G32",  # Myrtle–Willoughby Avs
    "G33",  # Bedford–Nostrand Avs
    "G34",  # Classon Av
    "G35",  # Clinton–Washington Avs
    "G36",  # Fulton St
    "A42",  # Hoyt–Schermerhorn Sts
    "F20",  # Bergen St
    "F21",  # Carroll St
    "F22",  # Smith–9 Sts
    "F23",  # 4 Av
    "F24",  # 7 Av
    "F25",  # 15 St–Prospect Park
    "F26",  # Fort Hamilton Pkwy
    "F27"   # Church Av (south terminus)
]

# File paths
STOPS_FILE = "gtfs/g_stops.csv"
SHAPES_FILE = "gtfs/g_shapes.csv"

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate the great-circle distance (in meters) between two lat/lon points."""
    R = 6371000  # Earth's radius in meters.
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def load_stops(filename=STOPS_FILE):
    """Load stops from stops.txt."""
    stops = []
    try:
        with open(filename, newline="") as csvfile:
            reader = csv.DictReader(csvfile)
            for row in reader:
                stops.append({
                    "stop_id": row["stop_id"],
                    "stop_name": row["stop_name"],
                    "lat": float(row["stop_lat"]),
                    "lon": float(row["stop_lon"])
                })
    except Exception as e:
        print(f"Error loading stops: {e}")
    return stops

def load_g_shapes(filename=SHAPES_FILE):
    """Load shape points from g_shapes.csv. Returns a list of dicts."""
    shapes = []
    try:
        with open(filename, newline="") as csvfile:
            reader = csv.DictReader(csvfile)
            for row in reader:
                shapes.append({
                    "shape_id": row["shape_id"],
                    "shape_pt_sequence": int(row["shape_pt_sequence"]),
                    "lat": float(row["shape_pt_lat"]),
                    "lon": float(row["shape_pt_lon"])
                })
    except Exception as e:
        print(f"Error loading shapes: {e}")
    return shapes

def is_on_route(lat, lon, threshold=200):
    """
    Determine if a given point (lat, lon) is within threshold meters
    of any shape point in g_shapes.csv.
    """
    shapes = load_g_shapes()
    if not shapes:
        print("No shape data available.")
        return False
    min_distance = float('inf')
    for pt in shapes:
        d = haversine_distance(lat, lon, pt["lat"], pt["lon"])
        if d < min_distance:
            min_distance = d
    print(f"Minimum distance from beacon to route: {min_distance} meters")
    return min_distance <= threshold

def get_last_terminus_report(reports):
    """
    Iterate over beacon reports (sorted most recent first)
    and return the first report where the beacon was within STOP_RADIUS
    of one of the known terminus coordinates.
    Returns a tuple (report, terminus_id) if found; otherwise, None.
    """
    print(f"Scanning {len(reports)} beacon reports for a terminus event...")
    reports = sorted(reports, key=lambda r: r.timestamp, reverse=True)
    for rep in reports:
        #print(f"Checking beacon report at {rep.timestamp} (lat: {rep.latitude}, lon: {rep.longitude})")
        for term_id, (term_lat, term_lon) in TERMINUS_COORDS.items():
            distance = haversine_distance(rep.latitude, rep.longitude, term_lat, term_lon)
            #print(f"Distance to terminus {term_id}: {distance} meters")
            if distance <= STOP_RADIUS:
                print(f"Terminus event found: {term_id} at {rep.timestamp}")
                return rep, term_id
    print("No terminus event found in beacon reports.")
    return None

def get_nearest_stop(lat, lon, stops):
    """Given a point and a list of stops, return the nearest stop (and its distance)."""
    nearest = None
    min_dist = float('inf')
    for stop in stops:
        d = haversine_distance(lat, lon, stop["lat"], stop["lon"])
        if d < min_dist:
            min_dist = d
            nearest = stop
    return nearest, min_dist

def get_direction_from_terminus(terminus_id):
    """
    Determine the direction of travel based on the last terminus.
    If the last terminus was G22 (Court Sq, north), then the train left the north and is traveling Southbound.
    If the last terminus was F27 (Church Av, south), then it is traveling Northbound.
    """
    if terminus_id == "G22":
        return "Southbound"
    elif terminus_id == "F27":
        return "Northbound"
    return "Unknown"

def get_next_stop(current_stop_id, direction, stops):
    """
    Given a current stop id, direction, and a list of stops (ordered by route),
    return the next stop along the route.
    """
    try:
        index = STOP_SEQUENCE.index(current_stop_id)
    except ValueError:
        return None
    if direction == "Southbound" and index < len(STOP_SEQUENCE) - 1:
        next_stop_id = STOP_SEQUENCE[index + 1]
    elif direction == "Northbound" and index > 0:
        next_stop_id = STOP_SEQUENCE[index - 1]
    else:
        return None
    for stop in stops:
        if stop["stop_id"] == next_stop_id:
            return stop
    return None

# ----- Beacon & GTFS Matching Functions -----
def match_gtfs_train(reports):
    """
    Fetch beacon reports using the provided private key, then scan the history
    to find the most recent time the train was at one of the termini.
    Using that terminus event's timestamp (converted to Eastern time),
    look for a G train (from the NYCTFeed) whose departure_time is within ±3 minutes.
    Returns the matching train (if found) or None.
    """
    
    if not reports:
        print("No beacon reports available.")
        return None, None
    
    last_term_result = get_last_terminus_report(reports)

    if not last_term_result:
        print("No terminus event found in beacon history.")
        return None, None
    
    term_report, term_id = last_term_result

    print(f"Last terminus event: {term_id} at {term_report.timestamp}")

    # Convert terminus event timestamp to Eastern time and keep it offset-aware
    eastern = pytz.timezone("US/Eastern")
    term_time_eastern = term_report.timestamp.astimezone(eastern)
    print(f"Terminus event time in Eastern: {term_time_eastern}")

    # For comparison with train.departure_time, we assume departure_time is Eastern offset-naive,
    # so we remove tzinfo.
    matching_time = term_time_eastern.replace(tzinfo=None)
    print(f"Using terminus event time (naive Eastern): {matching_time}")

    # Load the realtime GTFS feed for G trains.
    print("Loading GTFS feed for G trains...")
    feed = NYCTFeed("G")
    
    expected_terminus = "F27S" if term_id == "G22" else "G22N"
    trains = feed.filter_trips(line_id=["G"], headed_for_stop_id=expected_terminus, underway=True)

    print(f"GTFS feed loaded; {len(feed.trips)} trips found.")

    for train in trains:
        diff = abs((train.departure_time - matching_time).total_seconds())
        print(f"Train {train.trip_id} departure_time: {train.departure_time}, diff: {diff} seconds",
                     train.trip_id, train.departure_time, diff)
        if diff <= MATCH_WINDOW_SEC:
            print(f"Matching GTFS train found: {train.trip_id} (diff: {diff} seconds)")
            return train, term_id
        
    print("No matching GTFS train found within ±3 minutes of the terminus event.")
    return None, term_id
