import { NextResponse } from "next/server";
import { loadStopsData } from '@/gtfs/get_stop_data';


export async function GET() {

    //get stops
    const stops = loadStopsData();

    return NextResponse.json(stops);
}
