-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "teamId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNING',
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- Add sprintId column to Component
ALTER TABLE "Component" ADD COLUMN "sprintId" TEXT;

-- Add new activity types
ALTER TYPE "ActivityType" ADD VALUE 'SPRINT_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'SPRINT_STARTED';
ALTER TYPE "ActivityType" ADD VALUE 'SPRINT_COMPLETED';
ALTER TYPE "ActivityType" ADD VALUE 'COMPONENT_ADDED_TO_SPRINT';
ALTER TYPE "ActivityType" ADD VALUE 'COMPONENT_REMOVED_FROM_SPRINT';

-- CreateIndex
CREATE INDEX "Sprint_teamId_idx" ON "Sprint"("teamId");
CREATE INDEX "Sprint_startDate_endDate_idx" ON "Sprint"("startDate", "endDate");
CREATE INDEX "Sprint_status_idx" ON "Sprint"("status");
CREATE INDEX "Component_sprintId_idx" ON "Component"("sprintId");

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
