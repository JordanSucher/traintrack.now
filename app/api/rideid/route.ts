import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

// Initialize Prisma client
const prisma = new PrismaClient();

export async function GET() {

    //get most recent beacontripmapping

    const beacons = await prisma.beaconTripMapping.findMany({
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      });


    return NextResponse.json(beacons);
}
