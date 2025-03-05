/*
  Warnings:

  - You are about to drop the column `bearing` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `congestionLevel` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `label` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `latitude` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `licensePlate` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `longitude` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `occupancyPercentage` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `occupancyStatus` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `odometer` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `speed` on the `VehiclePosition` table. All the data in the column will be lost.
  - You are about to drop the column `vehicleId` on the `VehiclePosition` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "VehiclePosition_vehicleId_idx";

-- AlterTable
ALTER TABLE "VehiclePosition" DROP COLUMN "bearing",
DROP COLUMN "congestionLevel",
DROP COLUMN "label",
DROP COLUMN "latitude",
DROP COLUMN "licensePlate",
DROP COLUMN "longitude",
DROP COLUMN "occupancyPercentage",
DROP COLUMN "occupancyStatus",
DROP COLUMN "odometer",
DROP COLUMN "speed",
DROP COLUMN "vehicleId";
