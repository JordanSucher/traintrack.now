import csv
import math
import os
from gtfs.fetch_reports import fetch_reports
import pytz
from nyct_gtfs import NYCTFeed  # Using NYCTFeed from nyct_gtfs

# Constants
STOP_RADIUS = 200  # meters
MAX_REPORT_AGE_MIN = 60  # Beacon reports older than 60 minutes => not functioning
MATCH_WINDOW_SEC = 240  # ±4 minutes for matching departure time

ANISETTE_SERVER = "https://ani.sidestore.zip"

# Terminus coordinates for G and C trains.
TERMINUS_COORDS_G = {
    "F27": (40.644041, -73.979678),  # Church Av (south terminus)
    "G22": (40.746554, -73.943832)   # Court Sq (north terminus)
}

TERMINUS_COORDS_C = {
    "A09": (40.840719, -73.939561),  # 168 St (north terminus)
    "A55": (40.675377, -73.872106)   # Euclid Av (south terminus)
}

# Stop sequences for G and C trains.
STOP_SEQUENCE_G = [
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

STOP_SEQUENCE_C = [
    "A09",  # 168 St
    "A10",  # 163 St-Amsterdam Av
    "A11",  # 155 St
    "A12",  # 145 St
    "A14",  # 135 St
    "A15",  # 125 St
    "A16",  # 116 St
    "A17",  # Cathedral Pkwy (110 St)
    "A18",  # 103 St
    "A19",  # 96 St
    "A20",  # 86 St
    "A21",  # 81 St-Museum of Natural History
    "A22",  # 72 St
    "A24",  # 59 St-Columbus Circle
    "A25",  # 50 St
    "A27",  # 42 St-Port Authority Bus Terminal
    "A28",  # 34 St-Penn Station
    "A30",  # 23 St
    "A31",  # 14 St
    "A32",  # W 4 St-Wash Sq
    "A33",  # Spring St
    "A34",  # Canal St
    "A36",  # Chambers St
    "A38",  # Fulton St
    "A40",  # High St
    "A41",  # Jay St-MetroTech
    "A42",  # Hoyt-Schermerhorn Sts
    "A43",  # Lafayette Av
    "A44",  # Clinton-Washington Avs
    "A45",  # Franklin Av
    "A46",  # Nostrand Av
    "A47",  # Kingston-Throop Avs
    "A48",  # Utica Av
    "A49",  # Ralph Av
    "A50",  # Rockaway Av
    "A51",  # Broadway Junction
    "A52",  # Liberty Av
    "A53",  # Van Siclen Av
    "A54",  # Shepherd Av
    "A55"   # Euclid Av
]

# Expected terminus mapping for determining the expected destination stop in the GTFS feed.
EXPECTED_TERMINI = {
    "G": {
        "G22": "F27S",  # If departed from Court Sq (north), heading southbound, expected terminus is Church Av.
        "F27": "G22N"   # If departed from Church Av (south), expected terminus is Court Sq.
    },
    "C": {
        "A09": "A55S",  # If departed from 168 St (north), heading southbound, expected terminus is Euclid Av.
        "A55": "A09N"   # If departed from Euclid Av (south), expected terminus is 168 St.
    }
}

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

def load_stops(line="G"):
    """Load stops from the stops file for the specified line (G or C)."""
    filename = f"gtfs/{line.lower()}_stops.csv"
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
        print(f"Error loading stops from {filename}: {e}")
    return stops

def load_shapes(line="G"):
    """Load shape points from shapes.csv. Returns a list of dicts."""
    filename = f"gtfs/{line.lower()}_shapes.csv"
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

def is_on_route(lat, lon, line="G", threshold=200):
    """
    Determine if a given point (lat, lon) is within threshold meters
    of any shape point in the shapes.csv file.
    """
    # Ensure threshold is a number (in case it's passed as a string)
    threshold = float(threshold)
    
    shapes = load_shapes(line)
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

def get_last_terminus_report(reports, line="G"):
    """
    Iterate over beacon reports (sorted most recent first)
    and return the first report where the beacon was within STOP_RADIUS
    of one of the known terminus coordinates for the specified line.
    Returns a tuple (report, terminus_id) if found; otherwise, None.
    """
    print(f"Scanning {len(reports)} beacon reports for a terminus event on {line} line...")
    termini = TERMINUS_COORDS_G if line == "G" else TERMINUS_COORDS_C if line == "C" else None
    if termini is None:
        print(f"Unsupported line: {line}")
        return None
    
    reports = sorted(reports, key=lambda r: r.timestamp, reverse=True)
    for rep in reports:
        for term_id, (term_lat, term_lon) in termini.items():
            distance = haversine_distance(rep.latitude, rep.longitude, term_lat, term_lon)
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

def get_direction_from_terminus(terminus_id, line="G"):
    """
    Determine the direction of travel based on the last terminus.
    For G trains:
      - If the last terminus was G22 (Court Sq, north), then the train left the north and is traveling Southbound.
      - If the last terminus was F27 (Church Av, south), then it is traveling Northbound.
    For C trains:
      - If the last terminus was A09 (168 St, north), then the train is traveling Southbound.
      - If the last terminus was A55 (Euclid Av, south), then the train is traveling Northbound.
    """
    if line == "G":
        if terminus_id == "G22":
            return "Southbound"
        elif terminus_id == "F27":
            return "Northbound"
    elif line == "C":
        if terminus_id == "A09":
            return "Southbound"
        elif terminus_id == "A55":
            return "Northbound"
    return "Unknown"

def get_next_stop(current_stop_id, direction, stops, line="G"):
    """
    Given a current stop id, direction, and a list of stops (ordered by route),
    return the next stop along the route for the specified line.
    """
    if line == "G":
        sequence = STOP_SEQUENCE_G
    elif line == "C":
        sequence = STOP_SEQUENCE_C
    else:
        print(f"Unsupported line: {line}")
        return None
    
    try:
        index = sequence.index(current_stop_id)
    except ValueError:
        return None
    
    if direction == "Southbound" and index < len(sequence) - 1:
        next_stop_id = sequence[index + 1]
    elif direction == "Northbound" and index > 0:
        next_stop_id = sequence[index - 1]
    else:
        return None
    
    for stop in stops:
        if stop["stop_id"] == next_stop_id:
            return stop
    return None

# ----- Beacon & GTFS Matching Functions -----
def match_gtfs_train(reports, line="G"):
    """
    Fetch beacon reports using the provided private key, then scan the history
    to find the most recent time the train was at one of the termini for the specified line.
    Using that terminus event's timestamp (converted to Eastern time),
    look for a train (from the NYCTFeed) whose departure_time is within ±3 minutes.
    Returns the matching train (if found) or None.
    """
    
    if not reports:
        print("No beacon reports available.")
        return None, None
    
    last_term_result = get_last_terminus_report(reports, line)
    if not last_term_result:
        print("No terminus event found in beacon history.")
        return None, None
    
    term_report, term_id = last_term_result
    print(f"Last terminus event on {line} line: {term_id} at {term_report.timestamp}")
    
    # Convert terminus event timestamp to Eastern time and keep it offset-aware.
    eastern = pytz.timezone("US/Eastern")
    term_time_eastern = term_report.timestamp.astimezone(eastern)
    print(f"Terminus event time in Eastern: {term_time_eastern}")
    
    # For comparison with train.departure_time, we assume departure_time is Eastern offset-naive,
    # so we remove tzinfo.
    matching_time = term_time_eastern.replace(tzinfo=None)
    print(f"Using terminus event time (naive Eastern): {matching_time}")
    
    # Load the realtime GTFS feed for the specified line.
    print(f"Loading GTFS feed for {line} trains...")
    feed = NYCTFeed(line)
    
    expected_terminus = EXPECTED_TERMINI.get(line, {}).get(term_id)
    if not expected_terminus:
        print(f"Unexpected terminus id {term_id} for line {line}.")
        return None, term_id
    
    trains = feed.filter_trips(line_id=[line], headed_for_stop_id=expected_terminus, underway=True)
    print(f"GTFS feed loaded; {len(feed.trips)} trips found for line {line}.")
    
    for train in trains:
        diff = abs((train.departure_time - matching_time).total_seconds())
        print(f"Train {train.trip_id} departure_time: {train.departure_time}, diff: {diff} seconds")
        if diff <= MATCH_WINDOW_SEC:
            print(f"Matching GTFS train found: {train.trip_id} (diff: {diff} seconds)")
            return train, term_id
        
    print("No matching GTFS train found within ±3 minutes of the terminus event.")
    return None, term_id
