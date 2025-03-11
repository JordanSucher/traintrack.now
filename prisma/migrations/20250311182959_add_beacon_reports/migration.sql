-- CreateTable
CREATE TABLE "BeaconReport" (
    "id" SERIAL NOT NULL,
    "fetchId" INTEGER NOT NULL,
    "beaconId" TEXT NOT NULL,
    "hashedAdvKey" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeaconReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeaconTripMapping" (
    "id" SERIAL NOT NULL,
    "fetchId" INTEGER NOT NULL,
    "tripId" TEXT NOT NULL,
    "beaconId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeaconTripMapping_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BeaconReport" ADD CONSTRAINT "BeaconReport_fetchId_fkey" FOREIGN KEY ("fetchId") REFERENCES "GtfsFetch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeaconTripMapping" ADD CONSTRAINT "BeaconTripMapping_fetchId_fkey" FOREIGN KEY ("fetchId") REFERENCES "GtfsFetch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
