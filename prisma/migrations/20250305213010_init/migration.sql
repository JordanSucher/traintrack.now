-- CreateTable
CREATE TABLE "GtfsFetch" (
    "id" SERIAL NOT NULL,
    "feedName" TEXT NOT NULL,
    "fetchTime" TIMESTAMP(3) NOT NULL,
    "feedTimestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GtfsFetch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehiclePosition" (
    "id" SERIAL NOT NULL,
    "fetchId" INTEGER NOT NULL,
    "entityId" TEXT NOT NULL,
    "tripId" TEXT,
    "routeId" TEXT,
    "startTime" TEXT,
    "startDate" TEXT,
    "scheduleRelationship" INTEGER,
    "vehicleId" TEXT,
    "label" TEXT,
    "licensePlate" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "bearing" DOUBLE PRECISION,
    "odometer" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "stopId" TEXT,
    "currentStatus" INTEGER,
    "timestamp" TIMESTAMP(3),
    "congestionLevel" INTEGER,
    "occupancyStatus" INTEGER,
    "occupancyPercentage" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehiclePosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehiclePosition_fetchId_idx" ON "VehiclePosition"("fetchId");

-- CreateIndex
CREATE INDEX "VehiclePosition_tripId_idx" ON "VehiclePosition"("tripId");

-- CreateIndex
CREATE INDEX "VehiclePosition_routeId_idx" ON "VehiclePosition"("routeId");

-- CreateIndex
CREATE INDEX "VehiclePosition_vehicleId_idx" ON "VehiclePosition"("vehicleId");

-- CreateIndex
CREATE INDEX "VehiclePosition_stopId_idx" ON "VehiclePosition"("stopId");

-- AddForeignKey
ALTER TABLE "VehiclePosition" ADD CONSTRAINT "VehiclePosition_fetchId_fkey" FOREIGN KEY ("fetchId") REFERENCES "GtfsFetch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
