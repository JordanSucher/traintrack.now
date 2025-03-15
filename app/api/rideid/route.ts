import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

// Initialize Prisma client
const prisma = new PrismaClient();

export async function GET() {
  // Get the latest beacon report for every unique beaconId
  const beacons = await prisma.beaconTripMapping.findMany({
    distinct: ['beaconId'],
    orderBy: [
      { beaconId: 'asc' },            // Group by beaconId
      { latestBeaconReport: 'desc' }  // For each group, take the most recent report
    ],
  });

  return NextResponse.json(beacons);
}